import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexView, GameView } from "@wyrd/core";
import { FakeProvider, type FakeReply, type FakeRule, RoleRouter } from "@wyrd/llm";
import { LoreCache } from "@wyrd/storage";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

async function setup(
  rules: FakeRule[],
  plan?: FakeProvider,
  loreClient?: Parameters<typeof createApp>[0]["loreClient"],
) {
  const home = mkdtempSync(join(tmpdir(), "wyrd-gm-turns-"));
  homes.push(home);
  const fake = new FakeProvider(rules, "fake");
  const providers: Record<string, FakeProvider> = { fake };
  if (plan) providers.plan = plan;
  const router = new RoleRouter({
    providers,
    routing: {
      gm: plan
        ? { provider: "plan", model: "sol", fallbacks: [{ provider: "fake", model: "flash" }] }
        : { provider: "fake", model: "flash", fallbacks: [] },
      ...(rules.some((r) => r.role === "check")
        ? { check: { provider: "fake", model: "flash", fallbacks: [] } }
        : {}),
    },
  });
  const server = createApp({ home, offline: false, router, seed: "gm", loreClient });
  servers.push(server);
  const request = (
    path: string,
    body?: unknown,
    cookie?: string,
    method = body === undefined ? "GET" : "POST",
  ) =>
    server.app.request(`http://localhost/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Wyrd": "1", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const auth = await request("/auth/setup", { passcode: "a long gm turn passcode" });
  const cookie = auth.headers.get("set-cookie")!.split(";")[0]!;
  const made = await request(
    "/campaigns/quick-start",
    { name: "Ford GM", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  expect(made.status).toBe(201);
  const { id } = (await made.json()) as { id: string };
  const view = async () =>
    GameView.parse(await (await request(`/campaigns/${id}/view`, undefined, cookie)).json());
  const turn = async (input: string, clientTurnId: string) => {
    const submitted = await request(`/campaigns/${id}/turns`, { input, clientTurnId }, cookie);
    expect(submitted.status).toBe(202);
    const { turnId } = (await submitted.json()) as { turnId: string };
    const stream = await (await request(`/campaigns/${id}/turns/${turnId}/stream`, undefined, cookie)).text();
    return { turnId, stream };
  };
  return { home, server, fake, plan, id, cookie, request, view, turn };
}

const toolResults = (req: { messages: { role: string }[] }) =>
  req.messages.filter((m) => m.role === "tool").length;
const call = (name: string, args: unknown): FakeReply => ({ toolCall: { name, args } });

const cardsAndChoices = (): FakeRule[] => [
  {
    role: "gm",
    match: (req) => toolResults(req) === 0,
    reply: call("show_card", {
      cards: [
        { type: "chapter", title: "The Ford", subtitle: "Evening" },
        { type: "report", title: "Ledger", body: "One ferry, one debt." },
      ],
    }),
  },
  {
    role: "gm",
    match: (req) => toolResults(req) === 1,
    reply: call("offer_choices", {
      choices: [{ label: "Cross the ford" }, { label: "Ask Wenna" }],
    }),
  },
  { role: "gm", reply: { text: "The ford waits." } },
];

test("gm turn streams deltas and completes", async () => {
  const s = await setup(cardsAndChoices());
  const { stream } = await s.turn("I look at the ford.", "gm-1");
  expect(stream).toContain("event: narration.delta");
  expect(stream).toContain("event: card");
  expect(stream).toContain("event: choices");
  expect(stream).toContain("event: turn.completed");

  const view = await s.view();
  const last = view.turns.at(-1)!;
  expect(last.cards).toEqual([
    { type: "chapter", title: "The Ford", subtitle: "Evening" },
    { type: "report", title: "Ledger", body: "One ferry, one debt." },
  ]);
  expect(last.choices).toEqual([
    { label: "Cross the ford", description: "" },
    { label: "Ask Wenna", description: "" },
  ]);
  expect(last.backup).toBe(false);
  expect(last.checkFlags).toEqual([]);
  expect(last.guard).toBeUndefined();
});

test("choices become suggestions", async () => {
  const s = await setup(cardsAndChoices());
  await s.turn("I look at the ford.", "gm-1");
  const view = await s.view();
  expect(view.suggestions).toEqual(["Cross the ford", "Ask Wenna"]);
});

test("undo restores state", async () => {
  const s = await setup([
    {
      role: "gm",
      match: (req) => toolResults(req) === 0,
      reply: call("retcon", {
        summary: "Wren already owns the lantern ring",
        changes: [
          { kind: "item.define", name: "Yellow lantern ring", description: "Brass, scratched." },
          { kind: "item.give", actorId: "pc", itemId: "campaign:yellow-lantern-ring" },
        ],
      }),
    },
    { role: "gm", reply: { text: "It has always been yours." } },
  ]);
  await s.turn("/gm I have the lantern ring.", "gm-1");
  let view = await s.view();
  const retcon = view.turns.at(-1)!.retcon!;
  expect(retcon.summary).toContain("lantern");
  expect(retcon.undone).toBe(false);
  expect(retcon.undoable).toBe(true);
  expect(view.inventory.items.map((i) => i.name)).toContain("Yellow lantern ring");

  const undone = await s.request(`/campaigns/${s.id}/retcons/${retcon.retconId}/undo`, {}, s.cookie);
  expect(undone.status).toBe(200);
  view = GameView.parse(await undone.json());
  expect(view.inventory.items.map((i) => i.name)).not.toContain("Yellow lantern ring");
  expect(view.turns.at(-1)!.retcon!.undone).toBe(true);
  expect(view.turns.at(-1)!.retcon!.undoable).toBe(false);
});

test("undo refuses after the next turn", async () => {
  const s = await setup([
    {
      role: "gm",
      match: (req) => toolResults(req) === 0,
      reply: call("retcon", {
        summary: "Wren owns a ring",
        changes: [
          { kind: "item.define", name: "Copper ring" },
          { kind: "item.give", actorId: "pc", itemId: "campaign:copper-ring" },
        ],
      }),
    },
    { role: "gm", reply: { text: "Done." } },
  ]);
  await s.turn("/gm I have a copper ring.", "gm-1");
  const retcon = (await s.view()).turns.at(-1)!.retcon!;
  await s.turn("I wait.", "gm-2");
  const refused = await s.request(`/campaigns/${s.id}/retcons/${retcon.retconId}/undo`, {}, s.cookie);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({ error: "Undo is only available until your next turn" });
  const view = await s.view();
  expect(view.inventory.items.map((i) => i.name)).toContain("Copper ring");
});

test("fix queues a reconcile turn", async () => {
  const s = await setup([
    { role: "gm", reply: { text: "You pocket the ring." } },
    {
      role: "check",
      reply: call("report_unrecorded", {
        claims: [{ quote: "You pocket the ring.", claim: "The ring was never recorded." }],
      }),
    },
    { role: "gm", reply: { text: "The ring stays where it was." } },
  ]);
  const { turnId } = await s.turn("I take the ring.", "gm-1");
  // The check runs in the background; wait for its report to reach the view.
  let flags: { quote: string; claim: string }[] = [];
  for (let i = 0; i < 100 && !flags.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    flags = (await s.view()).turns.at(-1)!.checkFlags;
  }
  expect(flags).toEqual([{ quote: "You pocket the ring.", claim: "The ring was never recorded." }]);

  const fixed = await s.request(`/campaigns/${s.id}/turns/${turnId}/fix`, {}, s.cookie);
  expect(fixed.status).toBe(202);
  const { turnId: fixJob } = (await fixed.json()) as { turnId: string };
  await (await s.request(`/campaigns/${s.id}/turns/${fixJob}/stream`, undefined, s.cookie)).text();
  const view = await s.view();
  expect(view.turns.at(-1)!.input.startsWith("Reconcile the story")).toBe(true);
  expect(view.turns.at(-1)!.input).toContain("The ring was never recorded.");
});

test("backup flag reaches the view", async () => {
  const plan = new FakeProvider(
    [{ role: "gm", reply: { error: { code: "usage_limit", retryable: false } } }],
    "plan",
  );
  const s = await setup([{ role: "gm", reply: { text: "The backup speaks." } }], plan);
  const { stream } = await s.turn("Hello.", "gm-1");
  expect(stream).toContain("event: model.backup");
  const view = await s.view();
  expect(view.turns.at(-1)!.backup).toBe(true);
});

test("server lookup uses global summaries offline and makes correctable lore visible in Codex", async () => {
  let requests = 0;
  const s = await setup(
    [
      {
        role: "gm",
        match: (req) => toolResults(req) < 2,
        reply: call("lookup_lore", { query: "Marsh light", wiki: "dc.fandom.com" }),
      },
      { role: "gm", reply: { text: "The marsh lights lure walkers from the path." } },
    ],
    undefined,
    {
      fetchPage: async () => {
        requests++;
        throw new Error("Tests must not access wikis");
      },
      search: async () => {
        requests++;
        throw new Error("Tests must not access wikis");
      },
    },
  );
  new LoreCache(s.home).put("dc.fandom.com", "Marsh light", {
    title: "Marsh light",
    url: "https://dc.fandom.com/wiki/Marsh_light",
    fetchedAt: "2026-10-29T00:00:00.000Z",
    text: "Marsh lights lure walkers off safe paths.",
  });
  const { stream } = await s.turn("What are marsh lights?", "lore-1");
  expect(stream).toContain('"phase":"researching"');
  expect(requests).toBe(0);
  const results = s.fake
    .calls("gm")
    .at(-1)!
    .messages.filter((m) => m.role === "tool");
  expect(results).toHaveLength(2);
  expect(results.every((m) => m.content.includes("Marsh lights lure walkers off safe paths."))).toBe(true);
  const codex = CodexView.parse(
    await (await s.request(`/campaigns/${s.id}/codex`, undefined, s.cookie)).json(),
  );
  const entries = codex.entries.filter((e) => e.name === "Marsh light");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.facts[0]!.value).toContain("Marsh lights lure walkers off safe paths.");
  expect(entries[0]!.facts[0]!.editable).toBe(true);
});

test("milestone cards require acceptance, reject double acceptance, and update the sheet", async () => {
  const s = await setup([
    {
      role: "gm",
      match: (req) => toolResults(req) === 0,
      reply: call("propose_level_up", { level: 2, reason: "The first journey" }),
    },
    { role: "gm", reply: { text: "You are ready to advance." } },
  ]);
  await s.turn("I complete the journey.", "level-1");
  let view = await s.view();
  expect(view.pc.level).toBe(1);
  const card = view.turns.at(-1)!.cards.find((c) => c.type === "levelUp");
  expect(card?.type).toBe("levelUp");
  if (card?.type !== "levelUp") throw new Error("Missing proposal card");
  expect(view.levelProposals.find((p) => p.id === card.proposalId)?.status).toBe("pending");
  s.server.store.startJob({
    id: "busy-level",
    campaign_id: s.id,
    client_id: "busy-level",
    input: "wait",
    status: "running",
    target_id: null,
  });
  const conflict = await s.request(`/campaigns/${s.id}/levels/${card.proposalId}/accept`, {}, s.cookie);
  expect(conflict.status).toBe(409);
  s.server.store.finish("busy-level");
  const accepted = await s.request(`/campaigns/${s.id}/levels/${card.proposalId}/accept`, {}, s.cookie);
  expect(accepted.status).toBe(200);
  view = GameView.parse(await accepted.json());
  expect(view.pc.level).toBe(2);
  expect(view.powerRating).toBe(8);
  const duplicate = await s.request(`/campaigns/${s.id}/levels/${card.proposalId}/accept`, {}, s.cookie);
  expect(duplicate.status).toBe(409);
});

test("GM level corrections have an Undo and XP awards advance Levels through the real tool loop", async () => {
  const gm = await setup([
    {
      role: "gm",
      match: (req) => toolResults(req) === 0,
      reply: call("set_level", { level: "infinite", reason: "Player correction" }),
    },
    { role: "gm", reply: { text: "Your sovereignty is restored." } },
  ]);
  await gm.turn("/gm My level is infinite.", "gm-level-1");
  let view = await gm.view();
  expect(view.pc.level).toBe("infinite");
  expect(view.powerRating).toBe("∞");
  const retcon = view.turns.at(-1)!.retcon!;
  const undone = await gm.request(`/campaigns/${gm.id}/retcons/${retcon.retconId}/undo`, {}, gm.cookie);
  expect(undone.status).toBe(200);
  expect(GameView.parse(await undone.json()).pc.level).toBe(1);
  const xp = await setup([
    {
      role: "gm",
      match: (req) => toolResults(req) === 0,
      reply: call("change_state", { changes: [{ kind: "xp", actorId: "pc", amount: 100 }] }),
    },
    { role: "gm", reply: { text: "The journey taught you much." } },
  ]);
  await xp.turn("Award the quest XP.", "xp-level-1");
  view = await xp.view();
  expect(view.pc.level).toBe(4);
  expect(view.pc.progression.xpEarned).toBe(100);
});

test("late check results remain on the stream without blocking the next turn", async () => {
  const s = await setup([
    { role: "gm", reply: { text: "The ring changes hands." } },
    {
      role: "check",
      reply: call("report_unrecorded", {
        claims: [{ quote: "The ring changes hands.", claim: "The ring was not moved." }],
      }),
    },
  ]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const generate = s.fake.generate.bind(s.fake);
  s.fake.generate = async function* (req) {
    if (req.role === "check") await gate;
    yield* generate(req);
  };
  const started = await s.request(
    `/campaigns/${s.id}/turns`,
    { input: "I take the ring.", clientTurnId: "late-check-1" },
    s.cookie,
  );
  const { turnId } = (await started.json()) as { turnId: string };
  for (let i = 0; i < 100 && s.server.store.job(turnId)?.status === "running"; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  const next = await s.request(
    `/campaigns/${s.id}/turns`,
    { input: "I wait.", clientTurnId: "late-check-2" },
    s.cookie,
  );
  expect(next.status).toBe(202);
  const stream = await s.request(`/campaigns/${s.id}/turns/${turnId}/stream`, undefined, s.cookie);
  release();
  expect(await stream.text()).toContain("event: check.flag");
  await s.server.idle();
});

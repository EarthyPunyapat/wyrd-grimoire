import { afterEach, beforeEach, expect, test } from "bun:test";
import { defaultTuning } from "@wyrd/core";
import { FakeProvider, type FakeReply, type FakeRule } from "../src/fake.ts";
import { TurnPipeline, type TurnStreamEvent } from "../src/pipeline.ts";
import { RoleRouter } from "../src/router.ts";
import type { GenerateRequest } from "../src/types.ts";
import { MemoryUsageSink } from "../src/usage.ts";
import { gmFixture, rules } from "./gm-fixture.ts";

let fx: ReturnType<typeof gmFixture>;
beforeEach(() => {
  fx = gmFixture();
});
afterEach(() => fx.close());

const toolResults = (req: GenerateRequest) => req.messages.filter((m) => m.role === "tool").length;
const call = (name: string, args: unknown): FakeReply => ({ toolCall: { name, args } });

/** gm replies chosen by how many tool results the request already carries. */
function script(steps: FakeReply[]): FakeRule {
  return { role: "gm", reply: (req) => steps[Math.min(toolResults(req), steps.length - 1)]! };
}

function setup(o: {
  gm?: FakeRule[];
  plan?: FakeRule[];
  classic?: FakeRule[];
  backup?: boolean;
  noGm?: boolean;
}) {
  const fake = new FakeProvider([...(o.gm ?? []), ...(o.classic ?? [])], "deepseek");
  const plan = new FakeProvider(o.plan ?? [], "plan");
  const flash = { provider: "deepseek", model: "flash", fallbacks: [] };
  const router = new RoleRouter({
    providers: { deepseek: fake, plan },
    routing: {
      parser: flash,
      guard: flash,
      narrator: flash,
      ...(o.noGm
        ? {}
        : {
            gm: o.backup
              ? { provider: "plan", model: "sol", fallbacks: [{ provider: "deepseek", model: "flash" }] }
              : flash,
          }),
    },
    usage: new MemoryUsageSink(),
  });
  let ids = 0;
  const pipeline = new TurnPipeline({
    store: fx.store,
    canon: fx.canon,
    router,
    rules,
    tone: "",
    worldBible: "",
    newId: () => `ID${String(++ids).padStart(6, "0")}`,
  });
  const events: TurnStreamEvent[] = [];
  const head = fx.store.events().at(-1)!.seq;
  return {
    fake,
    plan,
    pipeline,
    events,
    onEvent: (e: TurnStreamEvent) => events.push(e),
    since: () => fx.store.events().filter((e) => e.seq > head),
  };
}
const completed = (evs: { type: string; payload: unknown }[]) =>
  evs.find((e) => e.type === "TurnCompleted")!.payload as {
    status: string;
    gm?: { backup: boolean; tools: { name: string; ok: boolean }[]; rounds: number };
  };

test("narrates without tools", async () => {
  const s = setup({ gm: [{ role: "gm", reply: { text: "The river slaps the jetty." } }] });
  const r = await s.pipeline.run({ input: "I listen.", onEvent: s.onEvent });
  expect(r.status).toBe("resolved");
  const narr = s.since().find((e) => e.type === "NarrationCommitted")!.payload as {
    text: string;
    promptVersion: string;
  };
  expect(narr.text).toBe("The river slaps the jetty.");
  expect(narr.promptVersion).toBe("gm@1");
  const order = s.events.map((e) => e.type).filter((t, i, all) => t !== all[i - 1]);
  expect(s.events.filter((e) => e.type === "narration.delta").length).toBeGreaterThan(0);
  expect(order).toEqual(["turn.accepted", "narration.delta", "narration.final", "turn.completed"]);
});

test("rolls then narrates", async () => {
  const s = setup({
    gm: [
      script([
        call("roll", { skill: "core:stealth", difficulty: "normal", goal: "slip past" }),
        { text: "You slip past." },
      ]),
    ],
  });
  const r = await s.pipeline.run({ input: "I sneak past Wenna.", onEvent: s.onEvent });
  expect(r.status).toBe("resolved");
  expect(r.mechanics).toHaveLength(1);
  const types = s.since().map((e) => e.type);
  expect(types.indexOf("CheckResolved")).toBeGreaterThan(-1);
  expect(types.indexOf("CheckResolved")).toBeLessThan(types.indexOf("TurnCompleted"));
  expect(s.events.some((e) => e.type === "mechanics.line")).toBe(true);
  expect(s.events.some((e) => e.type === "progress")).toBe(true);
  // the tool result went back to the model as a tool message
  const second = s.fake.calls("gm")[1]!;
  expect(second.messages.some((m) => m.role === "tool" && m.name === "roll")).toBe(true);
});

test("uses working state between rounds", async () => {
  const s = setup({
    gm: [
      script([
        call("change_state", {
          changes: [
            { kind: "item.define", name: "Yellow lantern ring" },
            { kind: "item.give", actorId: "pc", itemId: "campaign:yellow-lantern-ring" },
          ],
        }),
        call("change_state", {
          changes: [
            { kind: "item.equip", actorId: "pc", itemId: "campaign:yellow-lantern-ring", slot: "worn" },
          ],
        }),
        { text: "It fits." },
      ]),
    ],
  });
  await s.pipeline.run({ input: "I put the ring on." });
  const gm = completed(s.since()).gm!;
  expect(gm.tools.map((t) => [t.name, t.ok])).toEqual([
    ["change_state", true],
    ["change_state", true],
  ]);
  expect(s.since().map((e) => e.type)).toContain("ItemDefined");
});

test("caps tool rounds", async () => {
  const s = setup({
    gm: [{ role: "gm", reply: call("offer_choices", { choices: [{ label: "a" }, { label: "b" }] }) }],
  });
  const r = await s.pipeline.run({ input: "Go on." });
  expect(r.status).toBe("resolved");
  const calls = s.fake.calls("gm");
  expect(calls).toHaveLength(defaultTuning.gm.maxToolRounds + 1);
  expect(calls.at(-1)!.tools ?? []).toHaveLength(0);
  expect(calls[0]!.tools!.length).toBeGreaterThan(0);
});

test("marks backup model", async () => {
  const s = setup({
    backup: true,
    plan: [{ role: "gm", reply: { error: { code: "usage_limit", retryable: false } } }],
    gm: [{ role: "gm", reply: { text: "The backup speaks." } }],
  });
  await s.pipeline.run({ input: "Hello.", onEvent: s.onEvent });
  expect(completed(s.since()).gm!.backup).toBe(true);
  expect(s.events.find((e) => e.type === "model.backup")).toEqual({
    type: "model.backup",
    provider: "deepseek",
  });
});

test("gm prefix forces retcon mode", async () => {
  const s = setup({ gm: [{ role: "gm", reply: { text: "Done." } }] });
  await s.pipeline.run({ input: "/gm make my lantern a yellow lantern ring" });
  const user = s.fake.calls("gm")[0]!.messages.find((m) => m.role === "user")!.content;
  expect(user).toContain("GM MODE: carry this out with the retcon tool.");
  expect(user).not.toContain("/gm");
  expect(user).toContain("make my lantern a yellow lantern ring");
});

test("falls back to classic when gm is down", async () => {
  const s = setup({
    gm: [{ role: "gm", reply: { error: { code: "bad_request", retryable: false } } }],
    classic: [
      {
        role: "parser",
        reply: call("propose_actions", { actions: [{ type: "wait", minutes: 10 }], intent: "wait" }),
      },
      { role: "narrator", reply: { text: "Time passes on the river." } },
      { role: "guard", reply: call("report_canon", {}) },
    ],
  });
  const r = await s.pipeline.run({ input: "I wait.", onEvent: s.onEvent });
  expect(r.status).toBe("resolved");
  expect(r.turnId).toBe("ID000001");
  expect(s.events.some((e) => e.type === "fallback")).toBe(true);
  expect(s.events.filter((e) => e.type === "turn.accepted")).toHaveLength(1);
  expect(s.fake.calls("narrator")).toHaveLength(1);
});

test("classic still runs without a gm route", async () => {
  const s = setup({
    noGm: true,
    classic: [
      {
        role: "parser",
        reply: call("propose_actions", { actions: [{ type: "wait", minutes: 10 }], intent: "wait" }),
      },
      { role: "narrator", reply: { text: "Time passes." } },
      { role: "guard", reply: call("report_canon", {}) },
    ],
  });
  const r = await s.pipeline.run({ input: "I wait." });
  expect(r.status).toBe("resolved");
  expect(s.fake.calls("gm")).toHaveLength(0);
});

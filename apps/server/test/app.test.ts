import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexView, GameView, JournalView, MapView, WyrdConfig } from "@wyrd/core";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function setup(offline = true) {
  const home = mkdtempSync(join(tmpdir(), "wyrd-web-"));
  homes.push(home);
  const server = createApp({ home, offline });
  servers.push(server);
  return server;
}
const request = (server: ReturnType<typeof setup>, path: string, body?: unknown, cookie?: string) =>
  server.app.request(`http://localhost/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Wyrd": "1", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function login(server: ReturnType<typeof setup>) {
  const setup = await request(server, "/auth/setup", { passcode: "a long test passcode" });
  expect(setup.status).toBe(200);
  return setup.headers.get("set-cookie")!.split(";")[0]!;
}

test("model settings persist in app.db, reject inline keys, and usage stays behind authentication", async () => {
  const server = setup();
  expect((await request(server, "/providers")).status).toBe(401);
  expect((await request(server, "/usage")).status).toBe(401);
  const cookie = await login(server);
  const cfg = WyrdConfig.parse({
    providers: { local: { kind: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1" } },
    models: { local: { provider: "local", model: "local-model" } },
    preset: "fullyLocal",
  });
  const saved = await server.app.request("http://localhost/api/providers", {
    method: "PUT",
    headers: { "X-Wyrd": "1", "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(cfg),
  });
  expect(saved.status).toBe(200);
  expect(WyrdConfig.parse(await (await request(server, "/providers", undefined, cookie)).json())).toEqual(
    cfg,
  );
  expect(server.store.providerConfig()).toEqual(cfg);
  const inline = await server.app.request("http://localhost/api/providers", {
    method: "PUT",
    headers: { "X-Wyrd": "1", "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      ...cfg,
      providers: { local: { ...cfg.providers.local, apiKey: "example-inline-key" } },
    }),
  });
  expect(inline.status).toBe(422);
  expect(JSON.stringify(server.store.providerConfig())).not.toContain("example-inline-key");
  const response = await request(server, "/connection", undefined, cookie);
  const text = await response.text();
  expect(text).not.toContain("access_token");
  expect(text).not.toContain("refresh_token");
  expect((await request(server, "/providers/chatgpt/connect", {}, cookie)).status).toBe(409);
  const remote = await server.app.request("http://wyrd.lan/api/providers/chatgpt/connect", {
    method: "POST",
    headers: { "X-Wyrd": "1", Cookie: cookie },
  });
  expect(remote.status).toBe(403);
});

test("first-run setup is host-only; sessions, logout and CSRF are enforced", async () => {
  const server = setup();
  expect((await request(server, "/campaigns")).status).toBe(401);
  const remote = await server.app.request("http://wyrd.lan/api/auth/setup", {
    method: "POST",
    headers: { "X-Wyrd": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ passcode: "remote attacker passcode" }),
  });
  expect(remote.status).toBe(403);
  const cookie = await login(server);
  expect((await request(server, "/campaigns", undefined, cookie)).status).toBe(200);
  expect((await request(server, "/auth/setup", { passcode: "replacement passcode" })).status).toBe(409);
  const csrf = await server.app.request("http://localhost/api/campaigns", {
    method: "POST",
    headers: { Cookie: cookie },
  });
  expect(csrf.status).toBe(403);
  const crossOrigin = await server.app.request("http://localhost/api/campaigns", {
    method: "POST",
    headers: { Cookie: cookie, "X-Wyrd": "1", Origin: "http://attacker.test" },
  });
  expect(crossOrigin.status).toBe(403);
  expect((await request(server, "/auth/logout", {}, cookie)).status).toBe(200);
  expect((await request(server, "/campaigns", undefined, cookie)).status).toBe(401);
});

test("failed logins are limited and do not disclose the passcode", async () => {
  const server = setup();
  await login(server);
  for (let i = 0; i < 10; i++)
    expect((await request(server, "/auth/login", { passcode: "wrong" })).status).toBe(401);
  const limited = await request(server, "/auth/login", { passcode: "a long test passcode" });
  expect(limited.status).toBe(429);
  expect(await limited.text()).not.toContain("a long test passcode");
});

test("campaign quick start persists and GameView excludes world truth and hidden NPC data", async () => {
  const server = setup();
  const cookie = await login(server);
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name: "A night at Ashford", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  expect(made.status).toBe(201);
  const { id } = (await made.json()) as { id: string };
  const view = await request(server, `/campaigns/${id}/view`, undefined, cookie);
  expect(view.status).toBe(200);
  const data = GameView.parse(await view.json());
  expect(data.pc.identity.name).toBe("Wren");
  expect(data.scene?.location).toBeTruthy();
  const text = JSON.stringify(data);
  for (const forbidden of ["world-bible", "rngState", "importance", "secret", "forbidden"])
    expect(text).not.toContain(forbidden);
  expect((await request(server, "/campaigns", undefined, cookie)).status).toBe(200);
  expect(server.store.campaigns()).toHaveLength(1);
});

test("a d20 campaign plays several turns: the view exposes the mode and mechanics use d20 + DC", async () => {
  const server = setup();
  const cookie = await login(server);
  const made = await request(
    server,
    "/campaigns/quick-start",
    {
      name: "A d20 at Ashford",
      characterName: "Wren",
      archetype: "cutpurse",
      resolution: "d20",
    },
    cookie,
  );
  expect(made.status).toBe(201);
  const { id } = (await made.json()) as { id: string };
  let n = 0;
  const turn = async (input: string): Promise<ReturnType<typeof GameView.parse>> => {
    const submitted = await request(
      server,
      `/campaigns/${id}/turns`,
      { input, clientTurnId: `d20-${n++}` },
      cookie,
    );
    expect(submitted.status).toBe(202);
    const { turnId } = (await submitted.json()) as { turnId: string };
    const stream = await (
      await request(server, `/campaigns/${id}/turns/${turnId}/stream`, undefined, cookie)
    ).text();
    expect(stream).toContain("event: narration.final");
    return GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
  };

  let view = await turn("sneak behind the barrels");
  expect(view.resolution).toBe("d20");
  expect(view.skills.length).toBeGreaterThan(0);
  expect(view.skills.every((s) => !s.display.endsWith("%"))).toBe(true);
  const check = view.turns[0]!.mechanics.find((m) => m.roll);
  expect(check?.roll?.die).toBe("d20");
  expect(check?.roll?.sides).toBe(20);
  expect(check?.roll?.dc).toBeGreaterThan(0);
  expect(check?.text).toContain("DC");
  expect(check?.text).not.toContain("%");

  view = await turn("look around");
  view = await turn("wait 10 minutes");
  expect(view.turns).toHaveLength(3);
  expect(view.resolution).toBe("d20");
});

test("a d100 campaign keeps d100 mechanics and percentage skill notation", async () => {
  const server = setup();
  const cookie = await login(server);
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name: "A d100 at Ashford", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  const { id } = (await made.json()) as { id: string };
  const submitted = await request(
    server,
    `/campaigns/${id}/turns`,
    { input: "sneak behind the barrels", clientTurnId: "d100-1" },
    cookie,
  );
  const { turnId } = (await submitted.json()) as { turnId: string };
  await (await request(server, `/campaigns/${id}/turns/${turnId}/stream`, undefined, cookie)).text();
  const view = GameView.parse(
    await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json(),
  );
  expect(view.resolution).toBe("d100");
  expect(view.skills.every((s) => s.display.endsWith("%"))).toBe(true);
  const check = view.turns[0]!.mechanics.find((m) => m.roll);
  expect(check?.roll?.die).toBe("d100");
  expect(check?.roll?.sides).toBe(100);
  expect(check?.roll?.target).toBeGreaterThan(0);
  expect(check?.text).toContain("%");
});

test("turn IDs deduplicate submissions; SSE replays in order and reroll keeps dice and time", async () => {
  const server = setup();
  const cookie = await login(server);
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name: "Ferry", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  const { id } = (await made.json()) as { id: string };
  const input = { input: "sneak behind the barrels", clientTurnId: "test-turn-1" };
  const submitted = await request(server, `/campaigns/${id}/turns`, input, cookie);
  expect(submitted.status).toBe(202);
  const { turnId } = (await submitted.json()) as { turnId: string };
  const duplicate = await request(server, `/campaigns/${id}/turns`, input, cookie);
  expect(await duplicate.json()).toEqual({ turnId });
  const stream = await request(server, `/campaigns/${id}/turns/${turnId}/stream`, undefined, cookie);
  const text = await stream.text();
  expect(text.indexOf("event: mechanics.line")).toBeLessThan(text.indexOf("event: narration.final"));
  expect(text).toContain("event: turn.completed");
  const view = GameView.parse(
    await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json(),
  );
  expect(view.turns).toHaveLength(1);
  const reroll = await request(server, `/campaigns/${id}/turns/${turnId}/reroll`, {}, cookie);
  expect(reroll.status).toBe(202);
  const rerollJob = (await reroll.json()) as { turnId: string };
  await (
    await request(server, `/campaigns/${id}/turns/${rerollJob.turnId}/stream`, undefined, cookie)
  ).text();
  const after = GameView.parse(
    await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json(),
  );
  expect(after.gameTime).toBe(view.gameTime);
  expect(after.turns[0]?.mechanics).toEqual(view.turns[0]?.mechanics);
  const conflict = await request(
    server,
    `/campaigns/${id}/turns`,
    { ...input, input: "wait 10 minutes" },
    cookie,
  );
  expect(conflict.status).toBe(409);
  const resumed = await server.app.request(`http://localhost/api/campaigns/${id}/turns/${turnId}/stream`, {
    headers: { Cookie: cookie, "Last-Event-ID": "2" },
  });
  expect(await resumed.text()).not.toContain("id: 1\n");
  expect(server.store.usage().length).toBeGreaterThan(0);
});

test("unconfigured real play refuses a turn without leaving a running job", async () => {
  const server = setup(false);
  const cookie = await login(server);
  const created = await request(
    server,
    "/campaigns/quick-start",
    { name: "Unconfigured", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  const { id } = (await created.json()) as { id: string };
  const response = await request(
    server,
    `/campaigns/${id}/turns`,
    { input: "look around", clientTurnId: "unconfigured" },
    cookie,
  );
  expect(response.status).toBe(422);
  expect(server.store.running(id)).toBe(false);
});

test("sessions, campaign views, and idempotent turn records survive a server restart", async () => {
  const before = setup();
  const cookie = await login(before);
  const home = homes.at(-1)!;
  const made = await request(
    before,
    "/campaigns/quick-start",
    { name: "Persistent", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  const { id } = (await made.json()) as { id: string };
  const input = { input: "look around", clientTurnId: "persistent-turn" };
  const accepted = await request(before, `/campaigns/${id}/turns`, input, cookie);
  const job = (await accepted.json()) as { turnId: string };
  await before.idle();
  before.store.startJob({
    id: "interrupted",
    campaign_id: id,
    client_id: "interrupted",
    input: "interrupted",
    status: "running",
    target_id: null,
  });
  before.close();
  servers.splice(servers.indexOf(before), 1);
  const after = createApp({ home, offline: true });
  servers.push(after);
  const duplicate = await request(after, `/campaigns/${id}/turns`, input, cookie);
  expect(await duplicate.json()).toEqual(job);
  const view = GameView.parse(
    await (await request(after, `/campaigns/${id}/view`, undefined, cookie)).json(),
  );
  expect(view.turns).toHaveLength(1);
  expect(after.store.job("interrupted")?.status).toBe("done");
  expect(after.store.stream("interrupted", 0).map((e) => e.type)).toEqual(["error", "turn.completed"]);
});

test("a tavern brawl plays through the API: free text starts a fight and the view carries the combat panel", async () => {
  const server = setup();
  const cookie = await login(server);
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name: "Brawl", characterName: "Wren", archetype: "hunter", world: "tavern-brawl" },
    cookie,
  );
  const { id } = (await made.json()) as { id: string };
  const turn = async (
    input: string,
    n: number,
    clarification?: { turnId: string; option: number },
  ): Promise<ReturnType<typeof GameView.parse>> => {
    const r = await request(
      server,
      `/campaigns/${id}/turns`,
      {
        input,
        clientTurnId: `brawl-${n}${clarification ? "-c" : ""}`,
        ...(clarification ? { clarification } : {}),
      },
      cookie,
    );
    const { turnId } = (await r.json()) as { turnId: string };
    const text = await (
      await request(server, `/campaigns/${id}/turns/${turnId}/stream`, undefined, cookie)
    ).text();
    // A plan that doesn't fit (a stunned PC has 1 AP) gets a clarification card: take its first option.
    if (text.includes("event: clarify") && !clarification) return turn("option", n, { turnId, option: 0 });
    expect(text).toContain("event: narration.final");
    expect(text.indexOf("event: mechanics.line")).toBeLessThan(text.indexOf("event: narration.final"));
    return GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
  };
  let view = await turn("I shoot Fen", 0);
  expect(view.turns[0]!.mechanics.some((m) => m.text.startsWith("Initiative"))).toBe(true);
  for (let n = 1; n < 30 && view.combat; n++) {
    expect(view.combat.combatants.some((c) => c.side === "pc")).toBe(true);
    // Enemy health is perceived, never exact.
    for (const c of view.combat.combatants.filter((x) => x.side === "enemy"))
      expect([0, 0.25, 0.5, 0.75, 1]).toContain(c.health);
    const foe = view.combat.combatants.find((c) => c.side === "enemy" && c.status === "active");
    const say =
      n === 1 ? `kick the table over, duck behind it, then shoot ${foe?.name}` : `I shoot ${foe?.name}`;
    view = await turn(foe ? say : "I defend", n);
  }
  expect(view.combat).toBeNull();
});

test("a generated world has regions, sites and roads; travel opens new sites and the world ticks", async () => {
  const server = setup();
  const cookie = await login(server);
  const draft = (await (
    await request(
      server,
      "/world-drafts",
      { name: "Reach", characterName: "", pitch: "A frontier mystery in a cold country." },
      cookie,
    )
  ).json()) as { id: string; origins: Array<{ id: string }>; backgrounds: Array<{ id: string }> };
  const made = await request(
    server,
    "/campaigns",
    {
      draftId: draft.id,
      characterName: "Ash",
      ancestry: draft.origins[0]!.id,
      archetype: draft.backgrounds[0]!.id,
    },
    cookie,
  );
  const { id } = (await made.json()) as { id: string };
  let n = 0;
  const turn = async (input: string) => {
    const r = await request(
      server,
      `/campaigns/${id}/turns`,
      { input, clientTurnId: `reach-${n++}` },
      cookie,
    );
    const { turnId } = (await r.json()) as { turnId: string };
    await (await request(server, `/campaigns/${id}/turns/${turnId}/stream`, undefined, cookie)).text();
    return GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
  };
  const start = GameView.parse(
    await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json(),
  );
  const places = new Set([start.scene!.location]);
  for (const site of ["Greywater Market", "Hollow Watch", "Cinder Steading"]) {
    for (let tries = 0; tries < 6; tries++) {
      const v = await turn(`I travel to ${site}`);
      if (v.combat) {
        // Waylaid: fight it out, or slip away.
        let fight: GameView["combat"] = v.combat;
        for (let i = 0; i < 25 && fight; i++) {
          const foe: string | undefined = fight.combatants.find(
            (c) => c.side === "enemy" && c.status === "active",
          )?.name;
          const next: GameView = await turn(foe ? `I attack ${foe}` : "I defend");
          fight = next.combat;
        }
      }
      const now = GameView.parse(
        await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json(),
      );
      if (now.scene?.location.startsWith(site)) {
        places.add(now.scene.location);
        break;
      }
    }
  }
  expect(places.size).toBeGreaterThanOrEqual(3);
  const end = GameView.parse(
    await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json(),
  );
  expect(end.gameTime).toBeGreaterThan(start.gameTime + 1440);
  // Codex, map and journal show only what the PC knows (spec 07, spec 13).
  const get = async (path: string) =>
    (await request(server, `/campaigns/${id}${path}`, undefined, cookie)).json();
  const codex = CodexView.parse(await get("/codex"));
  expect(codex.entries.map((e) => e.name)).toContain("Greywater Market");
  expect(JSON.stringify(codex)).not.toContain("nearly bankrupt"); // a faction secret
  const map = MapView.parse(await get("/map"));
  expect(map.sites.filter((x) => x.visited).length).toBeGreaterThanOrEqual(3);
  expect(map.routes.length).toBeGreaterThan(0);
  const journal = JournalView.parse(await get("/journal"));
  expect(journal.summaries.length).toBeGreaterThan(0);
  // Pin and retcon a known descriptive fact.
  const known = codex.entries.flatMap((e) => e.facts).find((f) => f.editable)!;
  const factPath = `/campaigns/${id}/facts/${encodeURIComponent(known.id)}`;
  const pinned = CodexView.parse(
    await (await request(server, `${factPath}/pin`, { pinned: true }, cookie)).json(),
  );
  expect(pinned.pins).toBe(codex.pins + 1);
  const edited = CodexView.parse(
    await (await request(server, `${factPath}/retcon`, { value: "Rewritten by the player." }, cookie)).json(),
  );
  expect(edited.entries.flatMap((e) => e.facts).some((f) => f.value === "Rewritten by the player.")).toBe(
    true,
  );
  expect((await request(server, `/campaigns/${id}/address`, { address: "Warden" }, cookie)).status).toBe(200);
  const after = GameView.parse(await get("/view"));
  expect(after.address).toBe("Warden");
  expect(after.known.length).toBeGreaterThan(3);
});

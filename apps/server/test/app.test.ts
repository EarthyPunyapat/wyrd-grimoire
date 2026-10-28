import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameView, WyrdConfig } from "@wyrd/core";
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
  for (const forbidden of ["world-bible", "rngState", "importance", "secret", 'resolution"', "forbidden"])
    expect(text).not.toContain(forbidden);
  expect((await request(server, "/campaigns", undefined, cookie)).status).toBe(200);
  expect(server.store.campaigns()).toHaveLength(1);
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

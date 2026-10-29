import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-crafting-"));
  homes.push(home);
  const server = createApp({ home, offline: true });
  servers.push(server);
  return server;
}
type Server = ReturnType<typeof setup>;
const request = (server: Server, path: string, body?: unknown, cookie?: string, method?: string) =>
  server.app.request(`http://localhost/api${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", "X-Wyrd": "1", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function login(server: Server) {
  const setup = await request(server, "/auth/setup", { passcode: "a long crafting passcode" });
  return setup.headers.get("set-cookie")!.split(";")[0]!;
}
async function quickStart(server: Server, cookie: string) {
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name: "Crafting", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { id: string }).id;
}

test("the downtime route refuses crafting when it is off or the materials are absent", async () => {
  const server = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie);
  const craft = (recipeId: string) =>
    request(server, `/campaigns/${id}/downtime`, { action: { type: "craft", recipeId } }, cookie);

  const off = await craft("fantasy-core:torch-bundle");
  expect(off.status).toBe(422);
  expect(((await off.json()) as { error: string }).error).toMatch(/crafting is off/i);

  const enabled = await request(
    server,
    `/campaigns/${id}/settings`,
    { subsystems: { crafting: true } },
    cookie,
    "PATCH",
  );
  expect(enabled.status).toBe(200);

  const missing = await craft("fantasy-core:healing-salve");
  expect(missing.status).toBe(422);
  const message = ((await missing.json()) as { error: string }).error.toLowerCase();
  expect(message).toContain("bandages");
  expect(message).toContain("waterskin");
});

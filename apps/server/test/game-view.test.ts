import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameView } from "@wyrd/core";
import type { GameState } from "@wyrd/engine";
import { loadPack } from "@wyrd/packs";
import { createApp, visibleSpells } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-view-"));
  homes.push(home);
  const server = createApp({ home, offline: true });
  servers.push(server);
  return server;
}
type Server = ReturnType<typeof setup>;
const request = (server: Server, path: string, body?: unknown, cookie?: string) =>
  server.app.request(`http://localhost/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Wyrd": "1", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function login(server: Server) {
  const setup = await request(server, "/auth/setup", { passcode: "a long view passcode" });
  return setup.headers.get("set-cookie")!.split(";")[0]!;
}

test("a non-caster's view has no spells", async () => {
  const server = setup();
  const cookie = await login(server);
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name: "No Spells", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  expect(made.status).toBe(201);
  const { id } = (await made.json()) as { id: string };
  const view = GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
  expect(view.spells).toEqual([]);
});

test("a caster's view lists exactly the spells on their known list", () => {
  const pack = loadPack(join(import.meta.dir, "../../../packs/fantasy-core")).pack!;
  const [first, second] = Object.keys(pack.spells).sort();
  const state = {
    flags: { spellcasting: { known: { pc: [first!] } } },
  } as unknown as GameState;
  const spells = visibleSpells(state, pack, "pc");
  expect(spells.map((spell) => spell.id)).toEqual([first!]);
  expect(spells.map((spell) => spell.id)).not.toContain(second!);
});

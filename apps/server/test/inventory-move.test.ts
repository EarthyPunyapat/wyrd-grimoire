import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameView } from "@wyrd/core";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-inventory-"));
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

async function start(server: Server) {
  const cookie = (await request(server, "/auth/setup", { passcode: "a long inventory passcode" })).headers
    .get("set-cookie")!
    .split(";")[0]!;
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name: "Paper Doll", characterName: "Wren", archetype: "sellsword" },
    cookie,
  );
  const { id } = (await made.json()) as { id: string };
  const view = GameView.parse(
    await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json(),
  );
  return { cookie, id, view };
}

const item = (view: GameView, local: string) =>
  view.inventory.items.find((entry) => entry.id.endsWith(`:${local}`))!;

test("the inventory move route stows and wields instantly, and the view follows the sheet", async () => {
  const server = setup();
  const { cookie, id, view: first } = await start(server);
  const sword = item(first, "arming-sword");
  expect(sword).toBeTruthy();

  const stow = await request(
    server,
    `/campaigns/${id}/inventory/move`,
    { itemId: sword.id, to: "carried" },
    cookie,
  );
  expect(stow.status).toBe(200);
  let view = GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
  expect(view.pc.equipment.held.main).toBeNull();
  expect(item(view, "arming-sword").location).toBe("carried");

  const wield = await request(
    server,
    `/campaigns/${id}/inventory/move`,
    { itemId: sword.id, to: "main" },
    cookie,
  );
  expect(wield.status).toBe(200);
  view = GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
  expect(view.pc.equipment.held.main).toBe(sword.id);
  expect(item(view, "arming-sword").location).toBe("main hand");
});

test("worn armour can be taken off, and gear cannot be wielded", async () => {
  const server = setup();
  const { cookie, id, view } = await start(server);
  const jack = item(view, "padded-jack");
  const pack = item(view, "backpack");

  const off = await request(
    server,
    `/campaigns/${id}/inventory/move`,
    { itemId: jack.id, to: "carried" },
    cookie,
  );
  expect(off.status).toBe(200);
  const after = GameView.parse(
    await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json(),
  );
  expect(after.pc.equipment.worn).not.toContain(jack.id);
  expect(item(after, "padded-jack").location).toBe("carried");

  const refused = await request(
    server,
    `/campaigns/${id}/inventory/move`,
    { itemId: pack.id, to: "main" },
    cookie,
  );
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: expect.stringContaining("wield") });
});

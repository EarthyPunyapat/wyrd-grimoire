import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draft, GameView, SavesView, TimelineView } from "@wyrd/core";
import { createCampaign, type GameState, reduce, unwrap } from "@wyrd/engine";
import { CampaignStore } from "@wyrd/storage";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-save-load-"));
  homes.push(home);
  const server = createApp({ home, offline: true });
  servers.push(server);
  return { server, home };
}
const request = (server: ReturnType<typeof createApp>, path: string, body?: unknown, cookie?: string) =>
  server.app.request(`http://localhost/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Wyrd": "1", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function login(server: ReturnType<typeof createApp>) {
  const setup = await request(server, "/auth/setup", { passcode: "a long test passcode" });
  expect(setup.status).toBe(200);
  return setup.headers.get("set-cookie")!.split(";")[0]!;
}
let turns = 0;
async function play(server: ReturnType<typeof createApp>, id: string, input: string, cookie: string) {
  const accepted = await request(
    server,
    `/campaigns/${id}/turns`,
    { input, clientTurnId: `save-load-${++turns}` },
    cookie,
  );
  expect(accepted.status).toBe(202);
  const { turnId } = (await accepted.json()) as { turnId: string };
  await (await request(server, `/campaigns/${id}/turns/${turnId}/stream`, undefined, cookie)).text();
}
async function view(server: ReturnType<typeof createApp>, id: string, cookie: string) {
  return GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
}
async function campaign(server: ReturnType<typeof createApp>, cookie: string) {
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name: "Save points", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { id: string }).id;
}

test("loading a save at the branch head activates it without forking", async () => {
  const { server } = setup();
  const cookie = await login(server);
  const id = await campaign(server, cookie);
  await play(server, id, "look around", cookie);

  const saved = await request(server, `/campaigns/${id}/saves`, { name: "At the head" }, cookie);
  expect(saved.status).toBe(201);
  const save = SavesView.parse(await saved.json()).saves.find((s) => s.name === "At the head")!;

  const loaded = await request(server, `/campaigns/${id}/saves/${save.id}/load`, {}, cookie);
  expect(loaded.status).toBe(200);
  const timeline = TimelineView.parse(await loaded.json());
  expect(timeline.activeBranchId).toBe("main");
  expect(timeline.branchId).toBe("main");
  expect(timeline.branches).toHaveLength(1);
  expect(timeline.turns).toHaveLength(1);
  expect((await view(server, id, cookie)).turns).toHaveLength(1);
});

test("loading an earlier save forks its branch and moves the campaign back", async () => {
  const { server } = setup();
  const cookie = await login(server);
  const id = await campaign(server, cookie);
  await play(server, id, "look around", cookie);

  const saved = await request(server, `/campaigns/${id}/saves`, { name: "Before the crypt" }, cookie);
  const save = SavesView.parse(await saved.json()).saves.find((s) => s.name === "Before the crypt")!;
  const before = await view(server, id, cookie);

  await play(server, id, "wait 60 minutes", cookie);
  const moved = await view(server, id, cookie);
  expect(moved.turns).toHaveLength(2);
  expect(moved.gameTime).toBeGreaterThan(before.gameTime);

  const loaded = await request(server, `/campaigns/${id}/saves/${save.id}/load`, {}, cookie);
  expect(loaded.status).toBe(200);
  const timeline = TimelineView.parse(await loaded.json());
  expect(timeline.activeBranchId).not.toBe("main");
  expect(timeline.branches).toHaveLength(2);
  expect(timeline.turns).toHaveLength(1);
  expect(timeline.branches.find((b) => b.id === timeline.activeBranchId)?.label).toBe(
    'from save "Before the crypt"',
  );

  const back = await view(server, id, cookie);
  expect(back.turns).toHaveLength(1);
  expect(back.turns[0]!.input).toBe("look around");
  expect(back.gameTime).toBe(before.gameTime);
});

test("hardcore campaigns refuse loading an earlier save with 409", async () => {
  const { server, home } = setup();
  const cookie = await login(server);
  const id = randomUUID();
  mkdirSync(join(home, "campaigns", id), { recursive: true });
  const created = unwrap(
    createCampaign({
      name: "One life",
      settings: { structural: { hardcore: true } },
      packIds: ["fantasy-core"],
      seed: "hardcore-save",
    }),
  );
  const game = CampaignStore.create<GameState>(join(home, "campaigns", id, "campaign.db"), created, {
    reduce,
  });
  game.append([draft("TurnStarted", { input: "look around" })], { turnId: "hardcore-1" });
  const save = game.saveAs("Before the end");
  game.append([draft("TurnStarted", { input: "wait 60 minutes" })], { turnId: "hardcore-2" });
  game.close();
  server.store.addCampaign({
    id,
    name: "One life",
    characterName: "Wren",
    updatedAt: new Date().toISOString(),
    archived: false,
  });

  const refused = await request(server, `/campaigns/${id}/saves/${save.id}/load`, {}, cookie);
  expect(refused.status).toBe(409);
  expect(await refused.text()).toContain("hardcore");

  // Only loading *earlier* is refused; the branch head can still be activated.
  const head = await request(server, `/campaigns/${id}/saves`, { name: "Now" }, cookie);
  const headSave = SavesView.parse(await head.json()).saves.find((s) => s.name === "Now")!;
  const loaded = await request(server, `/campaigns/${id}/saves/${headSave.id}/load`, {}, cookie);
  expect(loaded.status).toBe(200);
  expect(TimelineView.parse(await loaded.json()).turns).toHaveLength(2);
});

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draft, GameView, SceneState } from "@wyrd/core";
import { type GameState, reduce } from "@wyrd/engine";
import { CampaignStore } from "@wyrd/storage";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-downtime-"));
  homes.push(home);
  const server = createApp({ home, offline: true });
  servers.push(server);
  return { server, home };
}
type Server = ReturnType<typeof setup>["server"];
const request = (server: Server, path: string, body?: unknown, cookie?: string, method?: string) =>
  server.app.request(`http://localhost/api${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", "X-Wyrd": "1", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function login(server: Server) {
  const setup = await request(server, "/auth/setup", { passcode: "a long downtime passcode" });
  return setup.headers.get("set-cookie")!.split(";")[0]!;
}
async function quickStart(server: Server, cookie: string) {
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name: "Bad Training", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { id: string }).id;
}

test("a downtime action with an unknown skill is refused before it writes a mark", async () => {
  const { server } = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie);

  for (const action of [
    { type: "train", skill: "not a skill", teacherId: "npc:wenna" },
    { type: "train", skill: "core:nope" },
    { type: "work", skill: "not a skill" },
  ]) {
    const refused = await request(server, `/campaigns/${id}/downtime`, { action }, cookie);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toContain(action.skill);
  }

  expect((await request(server, `/campaigns/${id}/view`, undefined, cookie)).status).toBe(200);
  expect((await request(server, `/campaigns/${id}/progression`, undefined, cookie)).status).toBe(200);
});

test("a campaign with an unknown mark already in its log still loads", async () => {
  const { server, home } = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie);

  // Rewrite the log directly, the way a campaign written by the old code looks on disk.
  server.close();
  servers.splice(servers.indexOf(server), 1);
  const store = CampaignStore.open<GameState>(join(home, "campaigns", id, "campaign.db"), { reduce });
  store.append([draft("SkillMarked", { actorId: "pc", skillId: "core:nope" }, "engine")]);
  store.close();

  const reopened = createApp({ home, offline: true });
  servers.push(reopened);
  const view = await request(reopened, `/campaigns/${id}/view`, undefined, cookie);
  expect(view.status).toBe(200);
  const progression = await request(reopened, `/campaigns/${id}/progression`, undefined, cookie);
  expect(progression.status).toBe(200);
  expect(JSON.stringify(await progression.json())).not.toContain("core:nope");
});

test("the journal lists research topics, repeats continue them, and one can be abandoned", async () => {
  const { server } = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie);
  const research = { action: { type: "research", topic: "Kryptonite" } };
  expect((await request(server, `/campaigns/${id}/downtime`, research, cookie)).status).toBe(200);
  expect((await request(server, `/campaigns/${id}/downtime`, research, cookie)).status).toBe(200);
  const journal = (await (await request(server, `/campaigns/${id}/journal`, undefined, cookie)).json()) as {
    research: { id: string; name: string; filled: number }[];
    clocks: { name: string }[];
  };
  expect(journal.research).toHaveLength(1);
  expect(journal.research[0]).toMatchObject({ name: "Kryptonite", filled: 2 });
  expect(journal.clocks.some((c) => c.name === "Kryptonite")).toBe(false);

  const gone = await request(
    server,
    `/campaigns/${id}/research/${encodeURIComponent(journal.research[0]!.id)}`,
    undefined,
    cookie,
    "DELETE",
  );
  expect(gone.status).toBe(200);
  expect(((await gone.json()) as { research: unknown[] }).research).toHaveLength(0);
  const again = await request(server, `/campaigns/${id}/research/clock:nope`, undefined, cookie, "DELETE");
  expect(again.status).toBe(404);
});

test("the shop stays where it opened: leaving the place takes it off the screen and the API", async () => {
  const { server, home } = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie);
  const view = async (s: Server) =>
    GameView.parse(await (await request(s, `/campaigns/${id}/view`, undefined, cookie)).json());
  const shop = (await view(server)).shop;
  expect(shop).not.toBeNull();

  server.close();
  servers.splice(servers.indexOf(server), 1);
  const store = CampaignStore.open<GameState>(join(home, "campaigns", id, "campaign.db"), { reduce });
  const here = store.state().scene!;
  store.append([
    draft("SceneOpened", {
      scene: SceneState.parse({ ...here, id: "scene:rooftop", locationId: "location:rooftop" }),
    }),
  ]);
  store.close();

  const moved = createApp({ home, offline: true });
  servers.push(moved);
  expect((await view(moved)).shop).toBeNull();
  const buy = await request(
    moved,
    `/campaigns/${id}/shop/buy`,
    { itemId: shop!.items[0]!.id, qty: 1 },
    cookie,
  );
  expect(buy.status).toBe(409);
});

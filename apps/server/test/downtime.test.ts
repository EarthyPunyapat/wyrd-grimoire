import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draft } from "@wyrd/core";
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

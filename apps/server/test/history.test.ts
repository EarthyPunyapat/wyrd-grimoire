import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BranchesView, draft, ImportResult, SavesView, TimelineView } from "@wyrd/core";
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
  const home = mkdtempSync(join(tmpdir(), "wyrd-history-api-"));
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

test("timeline, rewind, branch switching, saves, export and import work over the API", async () => {
  const { server } = setup();
  const cookie = await login(server);
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name: "Threads", characterName: "Wren", archetype: "cutpurse" },
    cookie,
  );
  const { id } = (await made.json()) as { id: string };

  const accepted = await request(
    server,
    `/campaigns/${id}/turns`,
    { input: "look around", clientTurnId: "history-1" },
    cookie,
  );
  const { turnId } = (await accepted.json()) as { turnId: string };
  await (await request(server, `/campaigns/${id}/turns/${turnId}/stream`, undefined, cookie)).text();

  const timeline = TimelineView.parse(
    await (await request(server, `/campaigns/${id}/timeline`, undefined, cookie)).json(),
  );
  expect(timeline.hardcore).toBe(false);
  expect(timeline.activeBranchId).toBe("main");
  expect(timeline.turns).toHaveLength(1);
  expect(timeline.turns[0]).toMatchObject({ id: turnId, input: "look around" });
  expect(timeline.turns[0]!.narration).toBeTruthy();

  const rewound = await request(server, `/campaigns/${id}/rewind`, { turnId }, cookie);
  expect(rewound.status).toBe(200);
  const fork = TimelineView.parse(await rewound.json());
  expect(fork.activeBranchId).not.toBe("main");
  expect(fork.turns).toHaveLength(0);
  expect(fork.branches).toHaveLength(2);

  // The old branch is still readable without switching to it.
  const old = TimelineView.parse(
    await (await request(server, `/campaigns/${id}/timeline?branch=main`, undefined, cookie)).json(),
  );
  expect(old.branchId).toBe("main");
  expect(old.turns.map((t) => t.id)).toEqual([turnId]);

  const branches = BranchesView.parse(
    await (await request(server, `/campaigns/${id}/branches`, undefined, cookie)).json(),
  );
  expect(branches.branches.map((b) => b.id)).toContain("main");
  const activated = await request(server, `/campaigns/${id}/branches/main/activate`, {}, cookie);
  expect(activated.status).toBe(200);
  expect(BranchesView.parse(await activated.json()).activeBranchId).toBe("main");
  const view = await request(server, `/campaigns/${id}/view`, undefined, cookie);
  expect(view.status).toBe(200);
  expect(((await view.json()) as { turns: unknown[] }).turns).toHaveLength(1);

  const saved = await request(server, `/campaigns/${id}/saves`, { name: "Before the crypt" }, cookie);
  expect(saved.status).toBe(201);
  expect(SavesView.parse(await saved.json()).saves).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "Before the crypt", autosave: false })]),
  );
  const saves = SavesView.parse(
    await (await request(server, `/campaigns/${id}/saves`, undefined, cookie)).json(),
  );
  expect(saves.saves.filter((s) => s.autosave)).toHaveLength(1);

  const exported = await request(server, `/campaigns/${id}/export`, {}, cookie);
  expect(exported.status).toBe(200);
  expect(exported.headers.get("content-type")).toContain("zip");
  expect(exported.headers.get("content-disposition")).toContain(".wyrd");
  const archive = new Uint8Array(await exported.arrayBuffer());
  // Larger than the 16 KB JSON body limit: the import route must be exempt from it.
  expect(archive.byteLength).toBeGreaterThan(16 * 1024);

  const imported = await server.app.request("http://localhost/api/campaigns/import", {
    method: "POST",
    headers: { Cookie: cookie, "X-Wyrd": "1", "Content-Type": "application/octet-stream" },
    body: archive.buffer as ArrayBuffer,
  });
  expect(imported.status).toBe(201);
  const copy = ImportResult.parse(await imported.json());
  expect(copy.id).not.toBe(id);
  expect(copy.name).toBe("Threads");
  expect(copy.characterName).toBe("Wren");
  const copiedView = await request(server, `/campaigns/${copy.id}/view`, undefined, cookie);
  expect(copiedView.status).toBe(200);
  expect(((await copiedView.json()) as { turns: unknown[] }).turns).toHaveLength(1);
});

test("hardcore campaigns refuse rewind with 409", async () => {
  const { server, home } = setup();
  const cookie = await login(server);
  const id = randomUUID();
  mkdirSync(join(home, "campaigns", id), { recursive: true });
  const created = unwrap(
    createCampaign({
      name: "One life",
      settings: { structural: { hardcore: true } },
      packIds: ["fantasy-core"],
      seed: "hardcore",
    }),
  );
  const game = CampaignStore.create<GameState>(join(home, "campaigns", id, "campaign.db"), created, {
    reduce,
  });
  game.append([draft("TurnStarted", { input: "look around" })], { turnId: "hardcore-1" });
  game.close();
  server.store.addCampaign({
    id,
    name: "One life",
    characterName: "Wren",
    updatedAt: new Date().toISOString(),
  });

  const timeline = TimelineView.parse(
    await (await request(server, `/campaigns/${id}/timeline`, undefined, cookie)).json(),
  );
  expect(timeline.hardcore).toBe(true);
  expect(timeline.turns).toHaveLength(1);

  const refused = await request(server, `/campaigns/${id}/rewind`, { turnId: "hardcore-1" }, cookie);
  expect(refused.status).toBe(409);
  expect(await refused.text()).toContain("hardcore");
});

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BaseCampaignPreset, CampaignSettingsView, GameView, presetSubsystems } from "@wyrd/core";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-m7-"));
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
  const setup = await request(server, "/auth/setup", { passcode: "a long acceptance passcode" });
  return setup.headers.get("set-cookie")!.split(";")[0]!;
}

async function quickStart(server: Server, cookie: string, name: string, extra: Record<string, unknown> = {}) {
  const made = await request(
    server,
    "/campaigns/quick-start",
    { name, characterName: "Wren", archetype: "hunter", world: "tavern-brawl", ...extra },
    cookie,
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { id: string }).id;
}

async function settings(server: Server, cookie: string, id: string) {
  return CampaignSettingsView.parse(
    await (await request(server, `/campaigns/${id}/settings`, undefined, cookie)).json(),
  );
}

async function playTurn(server: Server, cookie: string, id: string, input: string, n: number) {
  const started = await request(
    server,
    `/campaigns/${id}/turns`,
    { input, clientTurnId: `m7-${id}-${n}` },
    cookie,
  );
  expect(started.status).toBe(202);
  const { turnId } = (await started.json()) as { turnId: string };
  const text = await (
    await request(server, `/campaigns/${id}/turns/${turnId}/stream`, undefined, cookie)
  ).text();
  expect(text).toContain("event: turn.completed");
  return GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
}

test("a campaign on every preset plays a turn, and toggles change mid-campaign", async () => {
  const server = setup();
  const cookie = await login(server);
  const presets: BaseCampaignPreset[] = ["story", "standard", "simulation"];
  for (const preset of presets) {
    const id = await quickStart(server, cookie, `Preset ${preset}`, { preset });
    const view = await settings(server, cookie, id);
    expect(view.settings.subsystems).toEqual(presetSubsystems(preset));
    expect(view.preset.label).toBe(preset[0]!.toUpperCase() + preset.slice(1));
    // Mid-campaign toggling (M7 acceptance): flip two subsystems and still play.
    const patched = await request(
      server,
      `/campaigns/${id}/settings`,
      { subsystems: { bleeding: false, survival: true, inventory: "abstract" } },
      cookie,
      "PATCH",
    );
    expect(patched.status).toBe(200);
    const after = await settings(server, cookie, id);
    expect(after.settings.subsystems.bleeding).toBe(false);
    expect(after.settings.subsystems.survival).toBe(true);
    expect(after.preset.id).toBe("custom");
    expect(after.preset.base).toBe(preset);
    const game = await playTurn(server, cookie, id, "I look around the room.", 1);
    expect(game.turns.length).toBeGreaterThan(0);
  }
});

test("a d20 campaign plays end to end and reports d20 mechanics", async () => {
  const server = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie, "Dice of Twenty", { resolution: "d20" });
  const view = await settings(server, cookie, id);
  expect(view.settings.structural.resolution).toBe("d20");
  let game = await playTurn(server, cookie, id, "I search the common room carefully.", 1);
  expect(game.resolution).toBe("d20");
  game = await playTurn(server, cookie, id, "I ask the innkeeper about the road.", 2);
  expect(game.resolution).toBe("d20");
  for (const turn of game.turns) {
    for (const line of turn.mechanics) {
      if (line.roll) {
        expect(line.roll.die).toBe("d20");
        expect(line.roll.sides).toBe(20);
      }
      expect(line.text).not.toContain("%");
    }
  }
});

test("locked settings are refused by the API and listed for greying out", async () => {
  const server = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie, "Locked", { resolution: "d20", progression: "hybrid" });
  const view = await settings(server, cookie, id);
  const paths = view.locks.map((l) => l.path);
  expect(paths).toContain("structural.resolution");
  expect(paths).toContain("structural.progression");

  for (const [body, path] of [
    [{ structural: { resolution: "d100" } }, "structural.resolution"],
    [{ structural: { progression: "classless" } }, "structural.progression"],
  ] as const) {
    const refused = await request(server, `/campaigns/${id}/settings`, body, cookie, "PATCH");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ path });
  }
  // Comfort settings still change.
  const ok = await request(
    server,
    `/campaigns/${id}/settings`,
    { narration: { showMath: false } },
    cookie,
    "PATCH",
  );
  expect(ok.status).toBe(200);
});

test("downtime activities resolve through the API and advance game time", async () => {
  const server = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie, "Downtime");
  const before = GameView.parse(
    await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json(),
  ).gameTime;
  const worked = await request(server, `/campaigns/${id}/downtime`, { action: { type: "work" } }, cookie);
  expect(worked.status).toBe(200);
  const result = (await worked.json()) as { action: string; summary: string; minutes: number };
  expect(result.action).toBe("work");
  expect(result.summary.length).toBeGreaterThan(0);
  const after = GameView.parse(
    await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json(),
  ).gameTime;
  expect(after).toBeGreaterThan(before);
  const research = await request(
    server,
    `/campaigns/${id}/downtime`,
    { action: { type: "research", topic: "the river gate" } },
    cookie,
  );
  expect(research.status).toBe(200);
});

test("the starting shop trades and haggles through the API", async () => {
  const server = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie, "Market Day");
  let game = GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
  expect(game.shop).not.toBeNull();
  expect(game.inventory.coins).toBe(50);
  const item = game.shop!.items.find((i) => i.stock > 0 && i.price <= 50)!;
  const bought = await request(server, `/campaigns/${id}/shop/buy`, { itemId: item.id, qty: 1 }, cookie);
  expect(bought.status).toBe(200);
  game = GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
  expect(game.inventory.coins).toBe(50 - item.price);
  expect(game.inventory.items.some((i) => i.id === item.id)).toBe(true);
  // Haggling is the Simulation money mode; turn it on first.
  const mode = await request(
    server,
    `/campaigns/${id}/settings`,
    { subsystems: { money: "haggling" } },
    cookie,
    "PATCH",
  );
  expect(mode.status).toBe(200);
  const haggled = await request(server, `/campaigns/${id}/shop/haggle`, {}, cookie);
  expect(haggled.status).toBe(200);
});

test("a quick-start kit reaches the inventory, weighs in and can be sold", async () => {
  const server = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie, "Kit", { archetype: "cutpurse" });
  let game = GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
  const kit = ["fantasy-core:dagger", "fantasy-core:lockpicks", "fantasy-core:rope", "fantasy-core:backpack"];
  for (const itemId of kit) {
    expect(game.inventory.items.find((i) => i.id === itemId)?.qty).toBe(1);
  }
  expect(game.inventory.weightKg).toBeCloseTo(4.6);

  const sold = await request(server, `/campaigns/${id}/shop/sell`, { itemId: "fantasy-core:dagger", qty: 1 }, cookie);
  expect(sold.status).toBe(200);
  game = GameView.parse(await (await request(server, `/campaigns/${id}/view`, undefined, cookie)).json());
  expect(game.inventory.items.some((i) => i.id === "fantasy-core:dagger")).toBe(false);

  const hunterId = await quickStart(server, cookie, "Hunter", { pregen: "hild" });
  const hunter = GameView.parse(
    await (await request(server, `/campaigns/${hunterId}/view`, undefined, cookie)).json(),
  );
  expect(hunter.inventory.items.find((i) => i.id === "fantasy-core:arrows")?.qty).toBe(2);
});

test("a campaign can be deleted from the home screen API", async () => {
  const server = setup();
  const cookie = await login(server);
  const id = await quickStart(server, cookie, "Delete Me");
  const before = (await (await request(server, "/campaigns", undefined, cookie)).json()) as Array<{
    id: string;
  }>;
  expect(before.some((c) => c.id === id)).toBe(true);
  const removed = await request(server, `/campaigns/${id}`, undefined, cookie, "DELETE");
  expect(removed.status).toBe(204);
  const after = (await (await request(server, "/campaigns", undefined, cookie)).json()) as Array<{
    id: string;
  }>;
  expect(after.some((c) => c.id === id)).toBe(false);
  expect((await request(server, `/campaigns/${id}/view`, undefined, cookie)).status).toBe(404);
});

test("world generation streams real progress steps and the finished draft", async () => {
  const server = setup();
  const cookie = await login(server);
  const response = await request(
    server,
    "/world-drafts/stream",
    { name: "Streamed World", pitch: "A rain-soaked river town with a secret beneath the mill." },
    cookie,
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain("event: progress");
  expect(text).toContain('"status":"running"');
  expect(text).toContain('"status":"done"');
  expect(text).toContain("event: done");
  expect(text).toContain('"worldName"');
});

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BaseCampaignPreset,
  CampaignSettingsView,
  GameView,
  presetSubsystems,
} from "@wyrd/core";
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

async function quickStart(
  server: Server,
  cookie: string,
  name: string,
  extra: Record<string, unknown> = {},
) {
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
  return CampaignSettingsView.parse(await (await request(server, `/campaigns/${id}/settings`, undefined, cookie)).json());
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
  const ok = await request(server, `/campaigns/${id}/settings`, { narration: { showMath: false } }, cookie, "PATCH");
  expect(ok.status).toBe(200);
});

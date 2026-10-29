import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CampaignSettings,
  CampaignSettingsView,
  presetToggles,
  type SubsystemToggles,
} from "@wyrd/core";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-settings-"));
  homes.push(home);
  const server = createApp({ home, offline: true });
  servers.push(server);
  return server;
}
const send = (
  server: ReturnType<typeof setup>,
  path: string,
  method: "GET" | "POST" | "PUT",
  body: unknown,
  cookie?: string,
) =>
  server.app.request(`http://localhost/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Wyrd": "1",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function login(server: ReturnType<typeof setup>) {
  const setupResponse = await send(server, "/auth/setup", "POST", { passcode: "a long settings passcode" });
  expect(setupResponse.status).toBe(200);
  return setupResponse.headers.get("set-cookie")!.split(";")[0]!;
}
async function campaign(server: ReturnType<typeof setup>, cookie: string, hardcore = false) {
  const made = await send(
    server,
    "/campaigns/quick-start",
    "POST",
    { name: "Settings test", characterName: "Wren", archetype: "cutpurse", hardcore },
    cookie,
  );
  expect(made.status).toBe(201);
  return ((await made.json()) as { id: string }).id;
}
const read = async (server: ReturnType<typeof setup>, id: string, cookie: string) => {
  const response = await send(server, `/campaigns/${id}/settings`, "GET", undefined, cookie);
  expect(response.status).toBe(200);
  return CampaignSettingsView.parse(await response.json());
};
const write = async (
  server: ReturnType<typeof setup>,
  id: string,
  settings: CampaignSettings,
  cookie: string,
) => {
  const response = await send(server, `/campaigns/${id}/settings`, "PUT", { settings }, cookie);
  return { response, view: response.ok ? CampaignSettingsView.parse(await response.json()) : null };
};

test("settings lock the dice and progression, and every other toggle is safe mid-campaign", async () => {
  const server = setup();
  const cookie = await login(server);
  const id = await campaign(server, cookie);
  const first = await read(server, id, cookie);
  expect(first.settings.structural.resolution).toBe("d100");
  expect(first.locks.map((l) => l.path)).toContain("structural.resolution");
  expect(first.locks.map((l) => l.path)).toContain("structural.progression");

  // Locked fields are refused by the API, not merely greyed out in the UI.
  const dice = await write(
    server,
    id,
    { ...first.settings, structural: { ...first.settings.structural, resolution: "d20" } },
    cookie,
  );
  expect(dice.response.status).toBe(409);
  expect(await dice.response.text()).toContain("locked");

  // Every boolean toggle can flip on and off; every enum can take each value.
  let current = first.settings;
  const booleans = Object.entries(current.subsystems).filter(([, v]) => typeof v === "boolean");
  for (const [key] of booleans) {
    for (const value of [true, false]) {
      const next: CampaignSettings = {
        ...current,
        preset: "custom",
        subsystems: { ...current.subsystems, [key]: value } as SubsystemToggles,
      };
      const result = await write(server, id, next, cookie);
      expect(result.response.status).toBe(200);
      current = result.view!.settings;
    }
  }
  const enums: Array<[keyof SubsystemToggles, string[]]> = [
    ["inventory", ["abstract", "weight", "slots"]],
    ["money", ["wealthLevels", "coins", "haggling"]],
    ["injuries", ["simple", "realistic"]],
    ["travelEncounters", ["reduced", "on"]],
  ];
  for (const [key, values] of enums) {
    for (const value of values) {
      const next: CampaignSettings = {
        ...current,
        preset: "custom",
        subsystems: { ...current.subsystems, [key]: value } as SubsystemToggles,
      };
      const result = await write(server, id, next, cookie);
      expect(result.response.status).toBe(200);
      current = result.view!.settings;
    }
  }
  // A hand-changed toggle is custom, and persisted.
  expect(current.preset).toBe("custom");
  expect((await read(server, id, cookie)).settings.subsystems).toEqual(current.subsystems);
});

test("presets set every subsystem and the campaign stays playable after each", async () => {
  const server = setup();
  const cookie = await login(server);
  const id = await campaign(server, cookie);
  let view = await read(server, id, cookie);
  for (const preset of ["story", "standard", "simulation"] as const) {
    const toggles = presetToggles(preset);
    const next: CampaignSettings = { ...view.settings, preset, subsystems: toggles };
    const result = await write(server, id, next, cookie);
    expect(result.response.status).toBe(200);
    view = result.view!;
    expect(view.settings.preset).toBe(preset);
    expect(view.settings.subsystems).toEqual(toggles);
    // The campaign's view still opens after each change.
    const game = await send(server, `/campaigns/${id}/view`, "GET", undefined, cookie);
    expect(game.status).toBe(200);
  }
  // Picking a preset by name alone also applies its toggles.
  const story: CampaignSettings = { ...view.settings, preset: "story" };
  const result = await write(server, id, story, cookie);
  expect(result.response.status).toBe(200);
  expect(result.view!.settings.subsystems).toEqual(presetToggles("story"));
});

test("a d20 campaign plays a turn end to end and shows d20 modifiers", async () => {
  const server = setup();
  const cookie = await login(server);
  const made = await send(
    server,
    "/campaigns/quick-start",
    "POST",
    { name: "D20 test", characterName: "Wren", archetype: "cutpurse", resolution: "d20" },
    cookie,
  );
  expect(made.status).toBe(201);
  const id = ((await made.json()) as { id: string }).id;
  const view = await send(server, `/campaigns/${id}/view`, "GET", undefined, cookie);
  expect(view.status).toBe(200);
  const game = (await view.json()) as {
    resolution: string;
    skills: Array<{ value: number; display?: string }>;
  };
  expect(game.resolution).toBe("d20");
  expect(game.skills.every((s) => /^(?:[+−-]?\d+)$/.test(s.display ?? ""))).toBe(true);
  const submitted = await send(
    server,
    `/campaigns/${id}/turns`,
    "POST",
    { input: "sneak behind the barrels", clientTurnId: "d20-turn-1" },
    cookie,
  );
  expect(submitted.status).toBe(202);
  const { turnId } = (await submitted.json()) as { turnId: string };
  const stream = await send(server, `/campaigns/${id}/turns/${turnId}/stream`, "GET", undefined, cookie);
  const text = await stream.text();
  expect(text).toContain("event: mechanics.line");
  expect(text).toContain("event: turn.completed");
  const after = (await (await send(server, `/campaigns/${id}/view`, "GET", undefined, cookie)).json()) as {
    turns: unknown[];
  };
  expect(after.turns).toHaveLength(1);
});

test("class mode starts a character in their background's class", async () => {
  const server = setup();
  const cookie = await login(server);
  const made = await send(
    server,
    "/campaigns/quick-start",
    "POST",
    { name: "Class test", characterName: "Wren", archetype: "cutpurse", progression: "classes" },
    cookie,
  );
  expect(made.status).toBe(201);
  const id = ((await made.json()) as { id: string }).id;
  const party = await send(server, `/campaigns/${id}/progression`, "GET", undefined, cookie);
  expect(party.status).toBe(200);
  const view = (await party.json()) as {
    mode: string;
    members: Array<{ classInfo?: { name: string; level: number; features: unknown[] } }>;
  };
  expect(view.mode).toBe("classes");
  expect(view.members[0]!.classInfo).toMatchObject({ name: "Rogue", level: 1 });
  // A generated world has no class data, so class mode is refused there.
  const generated = await send(
    server,
    "/world-drafts",
    "POST",
    {
      name: "No classes",
      characterName: "",
      pitch: "A hard sci-fi mystery on a failing space station, no magic.",
    },
    cookie,
  );
  expect(generated.status).toBe(201);
  const draftId = ((await generated.json()) as { id: string }).id;
  const rejected = await send(server, "/campaigns", "POST", { draftId, progression: "classes" }, cookie);
  expect(rejected.status).toBe(422);
});

test("hardcore can be turned off but never back on, and leaves a permanent mark", async () => {
  const server = setup();
  const cookie = await login(server);
  const id = await campaign(server, cookie, true);
  const view = await read(server, id, cookie);
  expect(view.settings.structural.hardcore).toBe(true);
  expect(view.settings.companionDeath).toBe(true);
  // Turning it off is allowed, marks the campaign softcore and cannot be undone.
  const off = await write(
    server,
    id,
    { ...view.settings, structural: { ...view.settings.structural, hardcore: false } },
    cookie,
  );
  expect(off.response.status).toBe(200);
  expect(off.view!.settings.structural.hardcore).toBe(false);
  expect(off.view!.settings.flags.softcore).toBe(true);
  const backOn = await write(
    server,
    id,
    { ...off.view!.settings, structural: { ...off.view!.settings.structural, hardcore: true } },
    cookie,
  );
  expect(backOn.response.status).toBe(409);
  const cleared = await write(server, id, { ...off.view!.settings, flags: { softcore: false } }, cookie);
  expect(cleared.response.status).toBe(409);
});

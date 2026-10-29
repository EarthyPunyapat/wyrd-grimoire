import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CampaignSettingsView, GeneratedWorldPreview, presetSubsystems } from "@wyrd/core";
import { SETTING_LOCK_MESSAGES } from "@wyrd/engine";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

async function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-settings-"));
  homes.push(home);
  const server = createApp({ home, offline: true, seed: "settings" });
  servers.push(server);
  const raw = (path: string, cookie: string, body?: unknown, method?: string) =>
    server.app.request(`http://localhost/api${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { Cookie: cookie, "X-Wyrd": "1", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const auth = await raw("/auth/setup", "", { passcode: "a long settings test passcode" });
  const cookie = auth.headers.get("set-cookie")!.split(";")[0]!;
  const call = (path: string, body?: unknown, method?: string) => raw(path, cookie, body, method);
  const started = await call("/campaigns/quick-start", {
    name: "Settings",
    characterName: "Wren",
    archetype: "cutpurse",
  });
  expect(started.status).toBe(201);
  const { id } = (await started.json()) as { id: string };
  const settings = async () =>
    CampaignSettingsView.parse(await (await call(`/campaigns/${id}/settings`)).json());
  return { call, id, settings };
}

test("GET returns the preset label and locks; PATCH changes comfort settings and records the preset", async () => {
  const { call, id, settings } = await setup();
  const before = await settings();
  expect(before.settings.structural).toEqual({
    resolution: "d100",
    progression: "classless",
    hardcore: false,
  });
  expect(before.preset).toEqual({ id: "standard", base: "standard", label: "Standard" });
  expect(before.locks).toEqual([
    { path: "structural.resolution", reason: SETTING_LOCK_MESSAGES.resolution },
    { path: "structural.progression", reason: SETTING_LOCK_MESSAGES.progression },
    { path: "structural.hardcore", reason: SETTING_LOCK_MESSAGES.hardcore },
  ]);

  const patched = await call(
    `/campaigns/${id}/settings`,
    {
      difficulty: "hard",
      narration: { showMath: false },
      content: { violence: "mild" },
      subsystems: { ammo: true },
    },
    "PATCH",
  );
  expect(patched.status).toBe(200);
  const after = CampaignSettingsView.parse(await patched.json());
  expect(after.settings.difficulty).toBe("hard");
  expect(after.settings.narration.showMath).toBe(false);
  expect(after.settings.content.violence).toBe("mild");
  expect(after.settings.subsystems.ammo).toBe(true);
  // A changed toggle is custom, but keeps the preset it came from.
  expect(after.preset).toEqual({
    id: "custom",
    base: "standard",
    label: "Custom (from Standard)",
  });
  // The event is the truth: a fresh read sees the same state.
  expect(await settings()).toEqual(after);
});

test("locked changes are refused with 409 and the exact path and reason", async () => {
  const { call, id } = await setup();
  const cases = [
    { body: { structural: { resolution: "d20" } }, path: "structural.resolution" },
    { body: { structural: { progression: "classes" } }, path: "structural.progression" },
    { body: { structural: { hardcore: true } }, path: "structural.hardcore" },
  ];
  for (const { body, path } of cases) {
    const response = await call(`/campaigns/${id}/settings`, body, "PATCH");
    expect(response.status).toBe(409);
    const error = (await response.json()) as { error: string; path: string; reason: string };
    expect(error.path).toBe(path);
    expect(error.reason).toBe(
      SETTING_LOCK_MESSAGES[path.split(".").at(-1) as keyof typeof SETTING_LOCK_MESSAGES],
    );
    expect(error.error).toBe(error.reason);
  }
  expect((await call(`/campaigns/${id}/settings`, { difficulty: "nightmare" }, "PATCH")).status).toBe(422);
});

test("hardcore locks companion death and can be turned off exactly once", async () => {
  const { call, settings } = await setup();
  const hardcore = await call("/campaigns/quick-start", {
    name: "Hardcore",
    characterName: "Wren",
    archetype: "cutpurse",
    hardcore: true,
  });
  const { id } = (await hardcore.json()) as { id: string };
  const read = async () => CampaignSettingsView.parse(await (await call(`/campaigns/${id}/settings`)).json());
  const before = await read();
  expect(before.settings.structural.hardcore).toBe(true);
  expect(before.settings.companionDeath).toBe(true);
  expect(before.locks.map((lock) => lock.path)).toContain("companionDeath");
  expect(before.locks.map((lock) => lock.path)).not.toContain("structural.hardcore");

  const forced = await call(`/campaigns/${id}/settings`, { companionDeath: false }, "PATCH");
  expect(forced.status).toBe(409);
  expect(await forced.json()).toMatchObject({
    path: "companionDeath",
    reason: SETTING_LOCK_MESSAGES.companionDeath,
  });

  const off = await call(`/campaigns/${id}/settings`, { structural: { hardcore: false } }, "PATCH");
  expect(off.status).toBe(200);
  const soft = CampaignSettingsView.parse(await off.json());
  expect(soft.settings.flags.softcore).toBe(true);
  expect(soft.locks.map((lock) => lock.path)).toContain("flags.softcore");
  expect(soft.locks.map((lock) => lock.path)).toContain("structural.hardcore");

  const permanent = await call(`/campaigns/${id}/settings`, { flags: { softcore: false } }, "PATCH");
  expect(permanent.status).toBe(409);
  expect((await permanent.json()).path).toBe("flags.softcore");
  // The first campaign is untouched by the second.
  expect((await settings()).settings.structural.hardcore).toBe(false);
});

test("the wizard's preset, story mode, dice and progression reach CampaignCreated settings", async () => {
  const { call } = await setup();
  const draft = GeneratedWorldPreview.parse(
    await (
      await call("/world-drafts", { name: "Preset Test", pitch: "A station mystery in the dark." })
    ).json(),
  );
  expect(draft.progressions).toContain("useBased");
  expect(draft.progressions).not.toContain("classes");
  const started = await call("/campaigns", {
    draftId: draft.id,
    ancestry: draft.origins[0]!.id,
    archetype: draft.backgrounds[0]!.id,
    preset: "simulation",
    storyMode: "livingWorld",
    resolution: "d20",
    progression: "hybrid",
  });
  expect(started.status).toBe(201);
  const { id } = (await started.json()) as { id: string };
  const view = CampaignSettingsView.parse(await (await call(`/campaigns/${id}/settings`)).json());
  expect(view.settings.structural).toEqual({
    resolution: "d20",
    progression: "hybrid",
    hardcore: false,
  });
  expect(view.settings.story.mode).toBe("livingWorld");
  expect(view.settings.subsystems).toEqual(presetSubsystems("simulation"));
  expect(view.preset.label).toBe("Simulation");

  // The pack does not offer class progression, so the API refuses it at creation.
  const classes = await call("/campaigns/quick-start", {
    name: "Classes",
    characterName: "Wren",
    archetype: "cutpurse",
    progression: "classes",
  });
  expect(classes.status).toBe(422);
});

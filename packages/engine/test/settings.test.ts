import { describe, expect, test } from "bun:test";
import { unwrap } from "../src/result.ts";
import { changeSettings, SETTING_LOCK_MESSAGES, settingsLocks } from "../src/settings.ts";
import { Sim } from "./sim.ts";

describe("settings changes", () => {
  test("comfort settings change any time and report changed paths", () => {
    const s = new Sim();
    const drafts = unwrap(changeSettings(s.state, { narration: { showMath: false }, difficulty: "hard" }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      type: "SettingsChanged",
      payload: { changed: ["difficulty", "narration.showMath"] },
    });
    s.commit(drafts);
    expect(s.state.campaign.settings.narration.showMath).toBe(false);
  });

  test("no-op patches emit nothing", () => {
    const s = new Sim();
    expect(unwrap(changeSettings(s.state, { difficulty: "standard" }))).toEqual([]);
  });

  test("dice and progression are locked", () => {
    const s = new Sim();
    expect(changeSettings(s.state, { structural: { resolution: "d20" } })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTING_LOCKED", path: "structural.resolution" }],
    });
    expect(changeSettings(s.state, { structural: { progression: "classes" } })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTING_LOCKED", path: "structural.progression" }],
    });
  });

  test("hardcore can't be turned on later", () => {
    const s = new Sim();
    expect(changeSettings(s.state, { structural: { hardcore: true } })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTING_LOCKED", path: "structural.hardcore" }],
    });
  });

  test("turning hardcore off permanently marks the campaign softcore", () => {
    const s = new Sim({ structural: { hardcore: true } });
    expect(s.state.campaign.settings.companionDeath).toBe(true);
    s.commit(unwrap(changeSettings(s.state, { structural: { hardcore: false } })));
    expect(s.state.campaign.settings.flags.softcore).toBe(true);
    expect(changeSettings(s.state, { flags: { softcore: false } })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTING_LOCKED", path: "flags.softcore" }],
    });
    expect(changeSettings(s.state, { structural: { hardcore: true } }).ok).toBe(false);
  });

  test("companion death is forced on in hardcore", () => {
    const s = new Sim({ structural: { hardcore: true } });
    expect(changeSettings(s.state, { companionDeath: false })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTING_FORCED" }],
    });
  });

  test("invalid values are rejected", () => {
    const s = new Sim();
    expect(changeSettings(s.state, { difficulty: "nightmare" as never })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTINGS_INVALID" }],
    });
  });

  test("every lock is reported with its path and reason", () => {
    const s = new Sim();
    const locks = settingsLocks(s.state.campaign.settings);
    expect(locks).toEqual([
      { path: "structural.resolution", reason: SETTING_LOCK_MESSAGES.resolution },
      { path: "structural.progression", reason: SETTING_LOCK_MESSAGES.progression },
      { path: "structural.hardcore", reason: SETTING_LOCK_MESSAGES.hardcore },
    ]);
    expect(
      changeSettings(s.state, { structural: { resolution: "d20", progression: "classes" } }),
    ).toMatchObject({
      ok: false,
      errors: [
        { code: "SETTING_LOCKED", path: "structural.resolution" },
        { code: "SETTING_LOCKED", path: "structural.progression" },
      ],
    });
    // Sending the current value is not a change and is allowed.
    expect(unwrap(changeSettings(s.state, { structural: { resolution: "d100" } }))).toEqual([]);
  });

  test("hardcore campaigns lock companion death, and turning hardcore off is one-way", () => {
    const s = new Sim({ structural: { hardcore: true } });
    expect(settingsLocks(s.state.campaign.settings)).toEqual([
      { path: "structural.resolution", reason: SETTING_LOCK_MESSAGES.resolution },
      { path: "structural.progression", reason: SETTING_LOCK_MESSAGES.progression },
      { path: "companionDeath", reason: SETTING_LOCK_MESSAGES.companionDeath },
    ]);
    expect(changeSettings(s.state, { companionDeath: false })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTING_FORCED", path: "companionDeath" }],
    });
    const off = unwrap(changeSettings(s.state, { structural: { hardcore: false } }));
    expect(off).toHaveLength(1);
    s.commit(off);
    expect(s.state.campaign.settings.flags.softcore).toBe(true);
    expect(s.state.campaign.settings.companionDeath).toBe(true);
    expect(settingsLocks(s.state.campaign.settings).map((lock) => lock.path)).toContain("flags.softcore");
    expect(changeSettings(s.state, { flags: { softcore: false } })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTING_LOCKED", path: "flags.softcore" }],
    });
  });

  test("companion death can be changed freely outside hardcore", () => {
    const s = new Sim();
    s.commit(unwrap(changeSettings(s.state, { companionDeath: true })));
    expect(s.state.campaign.settings.companionDeath).toBe(true);
    s.commit(unwrap(changeSettings(s.state, { companionDeath: false })));
    expect(s.state.campaign.settings.companionDeath).toBe(false);
  });

  test("the cheat-edit mark is permanent", () => {
    const s = new Sim();
    const marked = unwrap(changeSettings(s.state, { flags: { cheatEdited: true } }));
    s.commit(marked);
    expect(settingsLocks(s.state.campaign.settings).map((lock) => lock.path)).toContain("flags.cheatEdited");
    expect(changeSettings(s.state, { flags: { cheatEdited: false } })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTING_LOCKED", path: "flags.cheatEdited" }],
    });
  });
});

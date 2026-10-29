import { describe, expect, test } from "bun:test";
import { defaultTuning, type SubsystemToggles, SubsystemToggles as Toggles } from "@wyrd/core";
import { travelEncounterDue } from "../src/exploration.ts";
import { unwrap } from "../src/result.ts";
import { changeSettings } from "../src/settings.ts";
import { Sim } from "./sim.ts";

/**
 * M7 acceptance: "A campaign on each preset is playable; toggling subsystems mid-campaign causes
 * no errors." Preset playability lives with the preset tests; this file flips every subsystem
 * toggle twice in a running campaign and asserts the change is a clean SettingsChanged event.
 *
 * The table must cover every key of the schema: the last test fails when a new toggle is added
 * without a mid-campaign case here.
 */
type Case = {
  key: keyof SubsystemToggles;
  first: SubsystemToggles[keyof SubsystemToggles];
  second: SubsystemToggles[keyof SubsystemToggles];
};

const cases: Case[] = [
  { key: "inventory", first: "abstract", second: "slots" },
  { key: "money", first: "wealthLevels", second: "haggling" },
  { key: "injuries", first: "simple", second: "realistic" },
  { key: "bleeding", first: false, second: true },
  { key: "infection", first: false, second: true },
  { key: "fractures", first: false, second: true },
  { key: "permanentInjuries", first: false, second: true },
  { key: "timeDetail", first: false, second: true },
  { key: "factionReputation", first: false, second: true },
  { key: "weatherEffects", first: false, second: true },
  { key: "travelEncounters", first: "reduced", second: "on" },
  { key: "lightingAndVision", first: false, second: true },
  { key: "languageBarriers", first: false, second: true },
  { key: "ammo", first: false, second: true },
  { key: "durability", first: false, second: true },
  { key: "crafting", first: false, second: true },
  { key: "survival", first: false, second: true },
  { key: "disease", first: false, second: true },
];

describe("M7 subsystem toggles", () => {
  test("the case table covers every toggle in the schema", () => {
    expect(Object.keys(Toggles.shape).sort()).toEqual(cases.map((c) => c.key).sort());
  });

  for (const c of cases) {
    test(`${c.key} flips mid-campaign and back without errors`, () => {
      const sim = new Sim({ subsystems: { [c.key]: c.first } });
      const baseEvents = sim.events.length;
      expect(sim.state.campaign.settings.subsystems[c.key]).toBe(c.first);

      const on = unwrap(changeSettings(sim.state, { subsystems: { [c.key]: c.second } }));
      expect(on).toHaveLength(1);
      expect(on[0]).toMatchObject({ type: "SettingsChanged" });
      if (on[0]!.type !== "SettingsChanged") return;
      expect(on[0].payload.changed).toContain(`subsystems.${c.key}`);
      sim.commit(on);
      expect(sim.state.campaign.settings.subsystems[c.key]).toBe(c.second);

      const off = unwrap(changeSettings(sim.state, { subsystems: { [c.key]: c.first } }));
      expect(off).toHaveLength(1);
      sim.commit(off);
      expect(sim.state.campaign.settings.subsystems[c.key]).toBe(c.first);

      // Two flips, two events, and the campaign still folds forward cleanly.
      expect(sim.events.length).toBe(baseEvents + 2);
      expect(sim.state.campaign.settings.subsystems[c.key]).toBe(c.first);
    });
  }

  test("turning every toggle off and back on in one campaign leaves it playable", () => {
    const sim = new Sim();
    const off = Object.fromEntries(cases.map((c) => [c.key, c.first]));
    const drafts = unwrap(changeSettings(sim.state, { subsystems: off }));
    sim.commit(drafts);
    const back = Object.fromEntries(cases.map((c) => [c.key, c.second]));
    sim.commit(unwrap(changeSettings(sim.state, { subsystems: back })));
    expect(Object.keys(sim.state.campaign.settings.subsystems).sort()).toEqual(
      cases.map((c) => c.key).sort(),
    );
  });

  test("structural locks still refuse after a toggle sweep", () => {
    const sim = new Sim();
    sim.commit(unwrap(changeSettings(sim.state, { subsystems: { bleeding: false } })));
    expect(changeSettings(sim.state, { structural: { resolution: "d20" } })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTING_LOCKED", path: "structural.resolution" }],
    });
    expect(changeSettings(sim.state, { structural: { progression: "classes" } })).toMatchObject({
      ok: false,
      errors: [{ code: "SETTING_LOCKED", path: "structural.progression" }],
    });
  });

  const maxDanger = defaultTuning.world.travel.reducedMaxDanger;
  describe("travel encounters", () => {
    test(`on: failures on dangerous routes and every critical failure spring an ambush`, () => {
      expect(travelEncounterDue("failure", 2, "on", maxDanger)).toBe(true);
      expect(travelEncounterDue("success", 4, "on", maxDanger)).toBe(false);
      expect(travelEncounterDue("critFailure", 1, "on", maxDanger)).toBe(true);
      expect(travelEncounterDue("critFailure", 5, "on", maxDanger)).toBe(true);
    });
    test("reduced: half the chance, and the lethal tiers never ambush by surprise", () => {
      expect(travelEncounterDue("critFailure", maxDanger, "reduced", maxDanger)).toBe(true);
      expect(travelEncounterDue("critFailure", maxDanger + 1, "reduced", maxDanger)).toBe(false);
      expect(travelEncounterDue("failure", 2, "reduced", maxDanger)).toBe(false);
    });
  });
});

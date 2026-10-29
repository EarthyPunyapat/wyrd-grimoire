import { describe, expect, test } from "bun:test";
import { presetOf, presetSelection, presetSubsystems } from "../src/presets.ts";
import { CampaignSettings, CampaignSettingsPatch, defaultCampaignSettings } from "../src/schemas/settings.ts";

describe("presets (spec 11)", () => {
  test("Story turns bookkeeping off and keeps reputation on", () => {
    expect(presetSubsystems("story")).toEqual({
      inventory: "abstract",
      money: "wealthLevels",
      injuries: "simple",
      bleeding: false,
      infection: false,
      fractures: false,
      permanentInjuries: false,
      timeDetail: false,
      factionReputation: true,
      weatherEffects: false,
      travelEncounters: "reduced",
      lightingAndVision: false,
      languageBarriers: false,
      ammo: false,
      durability: false,
      crafting: false,
      survival: false,
      disease: false,
    });
  });

  test("Standard is the schema default column", () => {
    expect(presetSubsystems("standard")).toEqual(defaultCampaignSettings().subsystems);
    expect(presetSubsystems("standard")).toMatchObject({
      inventory: "weight",
      money: "coins",
      injuries: "realistic",
      bleeding: true,
      timeDetail: true,
      factionReputation: true,
      weatherEffects: true,
      travelEncounters: "on",
      lightingAndVision: true,
      languageBarriers: false,
      ammo: false,
      durability: false,
      crafting: false,
      survival: false,
      disease: false,
    });
  });

  test("Simulation turns every dial on", () => {
    expect(presetSubsystems("simulation")).toMatchObject({
      inventory: "slots",
      money: "haggling",
      injuries: "realistic",
      bleeding: true,
      infection: true,
      fractures: true,
      permanentInjuries: true,
      timeDetail: true,
      factionReputation: true,
      weatherEffects: true,
      travelEncounters: "on",
      lightingAndVision: true,
      languageBarriers: true,
      ammo: true,
      durability: true,
      crafting: true,
      survival: true,
      disease: true,
    });
  });

  test("preset selection sets the preset and its toggles; custom keeps the toggles", () => {
    expect(presetSelection("story")).toEqual({ preset: "story", subsystems: presetSubsystems("story") });
    expect(presetSelection("custom")).toEqual({ preset: "custom" });
  });
});

describe("presetOf", () => {
  test("reports the preset a campaign follows", () => {
    const settings = CampaignSettings.parse(presetSelection("story"));
    expect(presetOf(settings)).toEqual({ id: "story", base: "story", label: "Story" });
    expect(presetOf(defaultCampaignSettings())).toEqual({
      id: "standard",
      base: "standard",
      label: "Standard",
    });
  });

  test("a changed toggle is custom, labelled from the preset it came from", () => {
    const standard = defaultCampaignSettings();
    const settings = CampaignSettings.parse({
      ...standard,
      subsystems: { ...standard.subsystems, ammo: true },
    });
    expect(presetOf(settings)).toEqual({
      id: "custom",
      base: "standard",
      label: "Custom (from Standard)",
    });
  });

  test("a campaign created custom has no base preset", () => {
    const settings = CampaignSettings.parse({ preset: "custom" });
    expect(presetOf(settings)).toEqual({ id: "custom", base: null, label: "Custom" });
  });

  test("toggles that match a different preset still report the base they diverged from", () => {
    const settings = CampaignSettings.parse({
      preset: "standard",
      subsystems: presetSubsystems("simulation"),
    });
    expect(presetOf(settings)).toEqual({
      id: "custom",
      base: "standard",
      label: "Custom (from Standard)",
    });
  });
});

describe("CampaignSettingsPatch", () => {
  test("a partial patch fills in nothing the caller omitted", () => {
    expect(CampaignSettingsPatch.parse({ subsystems: { ammo: true } })).toEqual({
      subsystems: { ammo: true },
    });
    expect(CampaignSettingsPatch.parse({ narration: { showMath: false } })).toEqual({
      narration: { showMath: false },
    });
  });

  test("unknown fields and invalid values are rejected", () => {
    expect(CampaignSettingsPatch.safeParse({ difficulty: "nightmare" }).success).toBe(false);
    expect(CampaignSettingsPatch.safeParse({ bogus: true }).success).toBe(false);
    expect(CampaignSettingsPatch.safeParse({ subsystems: { telepathy: true } }).success).toBe(false);
  });
});

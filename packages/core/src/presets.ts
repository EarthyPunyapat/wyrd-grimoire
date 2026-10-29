import {
  type BaseCampaignPreset,
  type CampaignPreset,
  type CampaignSettings,
  SubsystemToggles,
} from "./schemas/settings.ts";
import { stableStringify } from "./stable-json.ts";

/** The three starting presets from spec 11; `custom` is not a preset, only a detection result. */
export const PRESET_IDS = ["story", "standard", "simulation"] as const;
export const PRESET_NAMES: Record<BaseCampaignPreset, string> = {
  story: "Story",
  standard: "Standard",
  simulation: "Simulation",
};

const PRESET_SUBSYSTEMS: Record<BaseCampaignPreset, SubsystemToggles> = {
  story: SubsystemToggles.parse({
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
  }),
  // The schema defaults are the Standard column of the spec 11 table.
  standard: SubsystemToggles.parse({}),
  simulation: SubsystemToggles.parse({
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
  }),
};

/** A fresh copy of a preset's subsystem toggles. */
export function presetSubsystems(id: BaseCampaignPreset): SubsystemToggles {
  return { ...PRESET_SUBSYSTEMS[id] };
}

/**
 * The settings patch that selects a preset. `custom` keeps the current toggles and only marks the
 * campaign as custom.
 */
export function presetSelection(id: CampaignPreset): {
  preset: CampaignPreset;
  subsystems?: SubsystemToggles;
} {
  return id === "custom" ? { preset: "custom" } : { preset: id, subsystems: presetSubsystems(id) };
}

export type PresetDetection = {
  id: CampaignPreset;
  /** The preset the campaign was based on, or null when it was created custom. */
  base: BaseCampaignPreset | null;
  /** The label the settings screen shows, e.g. "Standard" or "Custom (from Standard)". */
  label: string;
};

/**
 * Detects the preset a campaign currently follows (spec 11). Presets differ only in subsystem
 * toggles. A campaign whose toggles diverge from its base preset is `custom`, but keeps the base
 * in its label: "Custom (from Standard)".
 */
export function presetOf(settings: Pick<CampaignSettings, "preset" | "subsystems">): PresetDetection {
  if (settings.preset === "custom") return { id: "custom", base: null, label: "Custom" };
  const base = settings.preset;
  if (stableStringify(settings.subsystems) === stableStringify(PRESET_SUBSYSTEMS[base])) {
    return { id: base, base, label: PRESET_NAMES[base] };
  }
  return { id: "custom", base, label: `Custom (from ${PRESET_NAMES[base]})` };
}

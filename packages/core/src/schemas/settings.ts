import { z } from "zod";
import { ResolutionId } from "./common.ts";

export const SubsystemToggles = z.object({
  inventory: z.enum(["abstract", "weight", "slots"]).default("weight"),
  money: z.enum(["wealthLevels", "coins", "haggling"]).default("coins"),
  injuries: z.enum(["simple", "realistic"]).default("realistic"),
  bleeding: z.boolean().default(true),
  infection: z.boolean().default(true),
  fractures: z.boolean().default(true),
  permanentInjuries: z.boolean().default(true),
  timeDetail: z.boolean().default(true),
  factionReputation: z.boolean().default(true),
  weatherEffects: z.boolean().default(true),
  travelEncounters: z.enum(["reduced", "on"]).default("on"),
  lightingAndVision: z.boolean().default(true),
  languageBarriers: z.boolean().default(false),
  ammo: z.boolean().default(false),
  durability: z.boolean().default(false),
  crafting: z.boolean().default(false),
  survival: z.boolean().default(false),
  disease: z.boolean().default(false),
});
export type SubsystemToggles = z.infer<typeof SubsystemToggles>;

/** The three presets (spec 11). A custom campaign starts from one and exposes every toggle. */
export const SUBSYSTEM_PRESETS = {
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
} as const satisfies Record<"story" | "standard" | "simulation", SubsystemToggles>;
export type PresetName = keyof typeof SUBSYSTEM_PRESETS;

/** The toggles a named preset sets. */
export function presetToggles(name: PresetName): SubsystemToggles {
  return SubsystemToggles.parse(SUBSYSTEM_PRESETS[name]);
}

/** Which preset these toggles are exactly equal to, if any. */
export function presetForToggles(toggles: SubsystemToggles): PresetName | null {
  for (const name of Object.keys(SUBSYSTEM_PRESETS) as PresetName[]) {
    if (JSON.stringify(toggles) === JSON.stringify(SUBSYSTEM_PRESETS[name])) return name;
  }
  return null;
}

export const CampaignSettings = z.object({
  structural: z
    .object({
      resolution: ResolutionId.default("d100"),
      progression: z.enum(["classless", "useBased", "hybrid", "classes"]).default("classless"),
      hardcore: z.boolean().default(false),
    })
    .prefault({}),
  story: z.object({ mode: z.enum(["threatClock", "livingWorld"]).default("threatClock") }).prefault({}),
  difficulty: z.enum(["story", "standard", "hard"]).default("standard"),
  lethality: z.enum(["gritty", "brutal"]).default("gritty"),
  companionDeath: z.boolean().default(false),
  subsystems: SubsystemToggles.prefault({}),
  preset: z.enum(["story", "standard", "simulation", "custom"]).default("standard"),
  content: z
    .object({
      violence: z.enum(["mild", "moderate", "intense"]).default("moderate"),
      horror: z.enum(["off", "light", "moderate", "intense"]).default("light"),
      romance: z.enum(["off", "fadeToBlack"]).default("fadeToBlack"),
      language: z.enum(["clean", "moderate", "strong"]).default("moderate"),
      lines: z.array(z.string()).default([]),
      veils: z.array(z.string()).default([]),
    })
    .prefault({}),
  narration: z
    .object({
      language: z.string().default("en"),
      person: z.enum(["second", "third"]).default("second"),
      length: z.enum(["short", "normal", "long"]).default("normal"),
      showMath: z.boolean().default(true),
      canonCheck: z.enum(["beforeShowing", "afterShowing"]).default("beforeShowing"),
      fastCombat: z.boolean().default(false),
      suggestions: z.boolean().default(true),
      banter: z.enum(["off", "low", "normal"]).default("low"),
    })
    .prefault({}),
  xp: z.object({ modelSuggestedXp: z.boolean().default(false) }).prefault({}),
  media: z
    .object({
      images: z
        .object({
          portraits: z.boolean().default(true),
          sceneArt: z.boolean().default(true),
          combatShots: z.boolean().default(false),
          itemArt: z.boolean().default(false),
          cover: z.boolean().default(true),
        })
        .prefault({}),
      artStyle: z.string().default(""),
      voice: z
        .object({
          enabled: z.boolean().default(false),
          autoplay: z.boolean().default(false),
          dialogueOnly: z.boolean().default(false),
          narratorVoiceId: z.string().optional(),
        })
        .prefault({}),
    })
    .prefault({}),
  flags: z.object({ softcore: z.boolean().optional(), cheatEdited: z.boolean().optional() }).prefault({}),
});
export type CampaignSettings = z.infer<typeof CampaignSettings>;
/** Settings as a caller may write them: every field optional, defaults filled in by parsing. */
export type CampaignSettingsInput = z.input<typeof CampaignSettings>;

export function defaultCampaignSettings(): CampaignSettings {
  return CampaignSettings.parse({});
}

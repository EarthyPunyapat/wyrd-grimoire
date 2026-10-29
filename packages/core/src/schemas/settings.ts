import { z } from "zod";
import { ResolutionId } from "./common.ts";

export const CampaignPreset = z.enum(["story", "standard", "simulation", "custom"]);
export type CampaignPreset = z.infer<typeof CampaignPreset>;
/** A preset a campaign can be based on; `custom` is the unbased label. */
export const BaseCampaignPreset = z.enum(["story", "standard", "simulation"]);
export type BaseCampaignPreset = z.infer<typeof BaseCampaignPreset>;

export const ProgressionMode = z.enum(["classless", "useBased", "hybrid", "classes"]);
export type ProgressionMode = z.infer<typeof ProgressionMode>;

const toggle = {
  inventory: z.enum(["abstract", "weight", "slots"]),
  money: z.enum(["wealthLevels", "coins", "haggling"]),
  injuries: z.enum(["simple", "realistic"]),
  bleeding: z.boolean(),
  infection: z.boolean(),
  fractures: z.boolean(),
  permanentInjuries: z.boolean(),
  timeDetail: z.boolean(),
  factionReputation: z.boolean(),
  weatherEffects: z.boolean(),
  travelEncounters: z.enum(["reduced", "on"]),
  lightingAndVision: z.boolean(),
  languageBarriers: z.boolean(),
  ammo: z.boolean(),
  durability: z.boolean(),
  crafting: z.boolean(),
  survival: z.boolean(),
  disease: z.boolean(),
};

export const SubsystemToggles = z.object({
  inventory: toggle.inventory.default("weight"),
  money: toggle.money.default("coins"),
  injuries: toggle.injuries.default("realistic"),
  bleeding: toggle.bleeding.default(true),
  infection: toggle.infection.default(true),
  fractures: toggle.fractures.default(true),
  permanentInjuries: toggle.permanentInjuries.default(true),
  timeDetail: toggle.timeDetail.default(true),
  factionReputation: toggle.factionReputation.default(true),
  weatherEffects: toggle.weatherEffects.default(true),
  travelEncounters: toggle.travelEncounters.default("on"),
  lightingAndVision: toggle.lightingAndVision.default(true),
  languageBarriers: toggle.languageBarriers.default(false),
  ammo: toggle.ammo.default(false),
  durability: toggle.durability.default(false),
  crafting: toggle.crafting.default(false),
  survival: toggle.survival.default(false),
  disease: toggle.disease.default(false),
});
export type SubsystemToggles = z.infer<typeof SubsystemToggles>;

/** A partial patch of subsystem toggles; defaults never fill in fields the caller omitted. */
export const SubsystemTogglesPatch = z
  .object({
    inventory: toggle.inventory.optional(),
    money: toggle.money.optional(),
    injuries: toggle.injuries.optional(),
    bleeding: toggle.bleeding.optional(),
    infection: toggle.infection.optional(),
    fractures: toggle.fractures.optional(),
    permanentInjuries: toggle.permanentInjuries.optional(),
    timeDetail: toggle.timeDetail.optional(),
    factionReputation: toggle.factionReputation.optional(),
    weatherEffects: toggle.weatherEffects.optional(),
    travelEncounters: toggle.travelEncounters.optional(),
    lightingAndVision: toggle.lightingAndVision.optional(),
    languageBarriers: toggle.languageBarriers.optional(),
    ammo: toggle.ammo.optional(),
    durability: toggle.durability.optional(),
    crafting: toggle.crafting.optional(),
    survival: toggle.survival.optional(),
    disease: toggle.disease.optional(),
  })
  .strict();

export const CampaignSettings = z.object({
  structural: z
    .object({
      resolution: ResolutionId.default("d100"),
      progression: ProgressionMode.default("classless"),
      hardcore: z.boolean().default(false),
    })
    .prefault({}),
  story: z.object({ mode: z.enum(["threatClock", "livingWorld"]).default("threatClock") }).prefault({}),
  difficulty: z.enum(["story", "standard", "hard"]).default("standard"),
  lethality: z.enum(["gritty", "brutal"]).default("gritty"),
  companionDeath: z.boolean().default(false),
  subsystems: SubsystemToggles.prefault({}),
  preset: CampaignPreset.default("standard"),
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
      choices: z.enum(["gm", "always", "onRequest"]).default("gm"),
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

/**
 * A partial settings patch for `PATCH /campaigns/:id/settings`. Every field is optional and no
 * defaults are applied here: the engine merges the patch into the current settings, then validates
 * the result against `CampaignSettings` (the authoritative schema).
 */
export const CampaignSettingsPatch = z
  .object({
    structural: z
      .object({
        resolution: ResolutionId.optional(),
        progression: ProgressionMode.optional(),
        hardcore: z.boolean().optional(),
      })
      .strict()
      .optional(),
    story: z
      .object({ mode: z.enum(["threatClock", "livingWorld"]).optional() })
      .strict()
      .optional(),
    difficulty: z.enum(["story", "standard", "hard"]).optional(),
    lethality: z.enum(["gritty", "brutal"]).optional(),
    companionDeath: z.boolean().optional(),
    subsystems: SubsystemTogglesPatch.optional(),
    preset: CampaignPreset.optional(),
    content: z
      .object({
        violence: z.enum(["mild", "moderate", "intense"]).optional(),
        horror: z.enum(["off", "light", "moderate", "intense"]).optional(),
        romance: z.enum(["off", "fadeToBlack"]).optional(),
        language: z.enum(["clean", "moderate", "strong"]).optional(),
        lines: z.array(z.string()).optional(),
        veils: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    narration: z
      .object({
        language: z.string().optional(),
        person: z.enum(["second", "third"]).optional(),
        length: z.enum(["short", "normal", "long"]).optional(),
        showMath: z.boolean().optional(),
        canonCheck: z.enum(["beforeShowing", "afterShowing"]).optional(),
        fastCombat: z.boolean().optional(),
        suggestions: z.boolean().optional(),
        banter: z.enum(["off", "low", "normal"]).optional(),
        choices: z.enum(["gm", "always", "onRequest"]).optional(),
      })
      .strict()
      .optional(),
    xp: z.object({ modelSuggestedXp: z.boolean().optional() }).strict().optional(),
    media: z
      .object({
        images: z
          .object({
            portraits: z.boolean().optional(),
            sceneArt: z.boolean().optional(),
            combatShots: z.boolean().optional(),
            itemArt: z.boolean().optional(),
            cover: z.boolean().optional(),
          })
          .strict()
          .optional(),
        artStyle: z.string().optional(),
        voice: z
          .object({
            enabled: z.boolean().optional(),
            autoplay: z.boolean().optional(),
            dialogueOnly: z.boolean().optional(),
            narratorVoiceId: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    flags: z
      .object({ softcore: z.boolean().optional(), cheatEdited: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict();
export type CampaignSettingsPatch = z.infer<typeof CampaignSettingsPatch>;

export function defaultCampaignSettings(): CampaignSettings {
  return CampaignSettings.parse({});
}

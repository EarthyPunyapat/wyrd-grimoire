import { z } from "zod";
import { ResolutionId } from "./common.ts";
import { DraftSheet } from "./creation.ts";
import { CampaignImport } from "./import.ts";
import { CampaignPreset, ProgressionMode } from "./settings.ts";
import { CreationReview, StartGeneratedCampaign, WorldPitch } from "./world-generation.ts";

export const WorldSetup = z.object({
  id: z.string().min(1),
  builtin: z.boolean().default(false),
  name: z.string().trim().min(1).max(80),
  blurb: z.string().trim().max(240).default(""),
  art: z.string().max(200).optional(),
  pitch: WorldPitch.shape.pitch,
  source: WorldPitch.shape.source,
  rules: z
    .object({
      preset: CampaignPreset,
      storyMode: StartGeneratedCampaign.shape.storyMode,
      resolution: ResolutionId,
      hardcore: z.boolean(),
      progression: ProgressionMode,
    })
    .partial(),
  review: CreationReview.partial().default({}),
  updatedAt: z.string().default(""),
});
export type WorldSetup = z.infer<typeof WorldSetup>;
export const CardSheet = DraftSheet.pick({
  pronouns: true,
  attributes: true,
  skills: true,
  appearance: true,
  personality: true,
}).partial();
export const CharacterCard = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(80),
  origin: z.enum(["created", "campaign", "import"]),
  pc: CampaignImport.shape.pc,
  companions: CampaignImport.shape.companions,
  sheet: CardSheet.optional(),
  updatedAt: z.string().default(""),
});
export type CharacterCard = z.infer<typeof CharacterCard>;
export const SavedWorldMeta = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  worldName: z.string(),
  premise: z.string(),
  sourceCampaignId: z.string(),
  updatedAt: z.string(),
});
export type SavedWorldMeta = z.infer<typeof SavedWorldMeta>;
export const WorldSetupInput = WorldSetup.omit({ id: true, builtin: true, updatedAt: true });
export type WorldSetupInput = z.infer<typeof WorldSetupInput>;
export const CharacterCardInput = CharacterCard.omit({ id: true, updatedAt: true });
export type CharacterCardInput = z.infer<typeof CharacterCardInput>;

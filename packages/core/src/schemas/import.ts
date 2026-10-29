import { z } from "zod";
import { defaultTuning } from "../tuning.ts";
import { Level } from "./domains/levels.ts";

/**
 * A campaign carried over from the player's ChatGPT RPG chats (D142): their character, companions and
 * history as drafts the player reviews at creation. Only what they keep is imported.
 */
export const ImportedAbility = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(400),
  rank: z.number().int().min(defaultTuning.levels.minRank).max(defaultTuning.levels.maxRank),
});
export const ImportedCompanion = z.object({
  name: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(600),
  voice: z.string().trim().min(1).max(defaultTuning.delegation.voiceChars),
  level: Level,
});
export const CampaignImport = z.object({
  pc: z.object({
    name: z.string().trim().min(1).max(80),
    level: Level,
    backstory: z.string().trim().min(1).max(4000),
    abilities: z.array(ImportedAbility).max(20).default([]),
    gear: z
      .array(
        z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(400).default("") }),
      )
      .max(12)
      .default([]),
  }),
  companions: z.array(ImportedCompanion).max(5).default([]),
  history: z
    .array(z.object({ subject: z.string().trim().min(1).max(80), fact: z.string().trim().min(1).max(300) }))
    .max(40)
    .default([]),
});
export type CampaignImport = z.infer<typeof CampaignImport>;

/** Asking the server to read share links; `exclude` names arcs, worlds or people to leave out. */
export const ImportRequest = z.object({
  urls: z.array(z.string().url()).min(1).max(6),
  exclude: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
});

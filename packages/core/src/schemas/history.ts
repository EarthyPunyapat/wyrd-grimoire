import { z } from "zod";

/** One turn as the Timeline shows it: where it lives in the log and what was said. */
export const HistoryTurn = z.object({
  id: z.string(),
  branchId: z.string(),
  seq: z.number().int().positive(),
  input: z.string(),
  narration: z.string().nullable(),
  status: z.string().nullable(),
  gameTime: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type HistoryTurn = z.infer<typeof HistoryTurn>;

export const HistoryBranch = z.object({
  id: z.string(),
  parentBranchId: z.string().nullable(),
  forkSeq: z.number().int().nonnegative(),
  label: z.string().nullable(),
  head: z.number().int().nonnegative(),
  active: z.boolean(),
});
export type HistoryBranch = z.infer<typeof HistoryBranch>;

/** The active timeline, or another branch the player is looking at. */
export const TimelineView = z.object({
  campaignId: z.string(),
  activeBranchId: z.string(),
  branchId: z.string(),
  hardcore: z.boolean(),
  branches: z.array(HistoryBranch),
  turns: z.array(HistoryTurn),
});
export type TimelineView = z.infer<typeof TimelineView>;

export const BranchesView = z.object({
  campaignId: z.string(),
  activeBranchId: z.string(),
  hardcore: z.boolean(),
  branches: z.array(HistoryBranch),
});
export type BranchesView = z.infer<typeof BranchesView>;

export const SaveView = z.object({
  id: z.string(),
  name: z.string(),
  branchId: z.string(),
  seq: z.number().int().nonnegative(),
  autosave: z.boolean(),
  createdAt: z.string(),
});
export type SaveView = z.infer<typeof SaveView>;

export const SavesView = z.object({ saves: z.array(SaveView) });
export type SavesView = z.infer<typeof SavesView>;

export const RewindInput = z
  .object({
    turnId: z.string().min(1).max(100),
    label: z.string().trim().max(120).optional(),
  })
  .strict();
export type RewindInput = z.infer<typeof RewindInput>;

export const SaveInput = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export type SaveInput = z.infer<typeof SaveInput>;

/** Campaign IDs become directory names, so they may only contain these characters. */
export const CampaignId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * `manifest.json` inside a `.wyrd` archive. The manifest is data, never instructions: import
 * validates it before touching the archive's database or media.
 */
export const ExportManifest = z
  .object({
    format: z.literal("wyrd"),
    formatVersion: z.literal(1),
    campaignId: CampaignId,
    name: z.string().min(1).max(200),
    characterName: z.string().max(200).default(""),
    /** `PRAGMA user_version` of the archived campaign.db. */
    schemaVersion: z.number().int().nonnegative(),
    eventSchemaVersion: z.number().int().positive(),
    createdAt: z.string(),
    files: z.array(z.string()).default([]),
  })
  .strict();
export type ExportManifest = z.infer<typeof ExportManifest>;

export const ImportResult = z.object({
  id: z.string(),
  name: z.string(),
  characterName: z.string(),
});
export type ImportResult = z.infer<typeof ImportResult>;

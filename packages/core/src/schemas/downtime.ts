import { z } from "zod";
import { Degree } from "./common.ts";

/**
 * Downtime activities (spec 06, Downtime): what the PC does when time passes in a safe place. The
 * parser proposes one of these; the engine resolves it into events and a short outcome.
 */

export const DOWNTIME_ACTION_TYPES = [
  "train",
  "craft",
  "work",
  "research",
  "carouse",
  "recover",
] as const;
export const DowntimeActionType = z.enum(DOWNTIME_ACTION_TYPES);
export type DowntimeActionType = z.infer<typeof DowntimeActionType>;

export const TrainAction = z.object({
  type: z.literal("train"),
  /** The skill trained, e.g. `core:melee` or `fantasy-core:arcana`. */
  skill: z.string().trim().min(1),
  /** A teacher present in the scene; with one, training grants an improvement opportunity. */
  teacherId: z.string().min(1).optional(),
});

export const CraftAction = z.object({
  type: z.literal("craft"),
  /** A recipe from the pack's `recipes.yaml`. */
  recipeId: z.string().min(1),
});

export const WorkAction = z.object({
  type: z.literal("work"),
  /** The skill the PC works with; defaults to Craft. */
  skill: z.string().trim().min(1).optional(),
});

export const ResearchAction = z.object({
  type: z.literal("research"),
  /** What the PC is trying to learn. */
  topic: z.string().trim().min(1).max(200),
  /** Continue an existing research clock instead of starting one. */
  clockId: z.string().min(1).optional(),
});

export const CarouseAction = z.object({ type: z.literal("carouse") });
export const RecoverAction = z.object({ type: z.literal("recover") });

export const DowntimeAction = z.discriminatedUnion("type", [
  TrainAction,
  CraftAction,
  WorkAction,
  ResearchAction,
  CarouseAction,
  RecoverAction,
]);
export type DowntimeAction = z.infer<typeof DowntimeAction>;
export type DowntimeActionInput = z.input<typeof DowntimeAction>;

/** What a resolved downtime activity produced, for the API, the journal and the narrator. */
export const DowntimeResult = z.object({
  action: DowntimeActionType,
  minutes: z.number().int().nonnegative(),
  degree: Degree.optional(),
  summary: z.string().min(1),
  rewards: z
    .object({
      coins: z.number().int().nonnegative().optional(),
      itemId: z.string().optional(),
      itemQty: z.number().int().positive().optional(),
      /** A use-based improvement opportunity was granted. */
      improvement: z.boolean().optional(),
      clockId: z.string().optional(),
    })
    .default({}),
});
export type DowntimeResult = z.infer<typeof DowntimeResult>;

/** The API body: a structured action, or free text for the parser. */
export const DowntimeRequest = z
  .object({
    action: DowntimeAction.optional(),
    input: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => !!v.action !== !!v.input, "Send either an action or free text, not both");
export type DowntimeRequest = z.infer<typeof DowntimeRequest>;

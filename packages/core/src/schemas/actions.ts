import { z } from "zod";
import { AttributeId, Degree, Difficulty, MechanicsLine } from "./common.ts";

/**
 * Player actions (spec 08, "The action union"). M2 implements the exploration subset below; the
 * parser only ever sees the actions legal in the current mode. Combat and dialogue actions arrive
 * with their milestones.
 */

const Id = z.string().min(1);

export const CheckAction = z.object({
  type: z.literal("check"),
  /** A skill ID (`core:stealth`, `stealth`, `fantasy-core:arcana`) or an attribute (`end`). */
  skill: z.string().min(1),
  goal: z.string().min(1),
  proposedDifficulty: Difficulty,
  reason: z.string().min(1),
  targetId: Id.optional(),
});

export const ExamineAction = z.object({
  type: z.literal("examine"),
  targetId: Id.optional(),
  area: z.string().optional(),
});

export const SearchAction = z.object({
  type: z.literal("search"),
  targetId: Id.optional(),
  area: z.string().optional(),
});

export const InteractAction = z.object({
  type: z.literal("interact"),
  targetId: Id,
  verb: z.string().min(1),
});

export const MoveAction = z.object({ type: z.literal("move"), toZoneId: Id });

export const WaitAction = z.object({ type: z.literal("wait"), minutes: z.number().int().positive() });

export const TalkAction = z.object({
  type: z.literal("talk"),
  targetId: Id,
  utterance: z.string().min(1),
  approach: z.enum(["neutral", "persuade", "deceive", "intimidate", "charm"]).default("neutral"),
});

export const ExplorationAction = z.discriminatedUnion("type", [
  CheckAction,
  ExamineAction,
  SearchAction,
  InteractAction,
  MoveAction,
  WaitAction,
  TalkAction,
]);
export type ExplorationAction = z.infer<typeof ExplorationAction>;
export type ExplorationActionInput = z.input<typeof ExplorationAction>;

export const ACTIONS_BY_MODE = {
  exploration: ["check", "examine", "search", "interact", "move", "wait", "talk"],
} as const;

/** Re-exported so callers can build `check` actions on attributes without string typos. */
export const CheckSkill = z.union([z.string(), AttributeId]);

/** One resolved step of a plan, as the narrator and the mechanics log see it. */
export const ResolvedStep = z.object({
  index: z.number().int().nonnegative(),
  action: z.unknown(),
  /** "done" = no roll needed; otherwise the check's degree. */
  outcome: z.union([z.literal("done"), Degree]),
  /** Plain statement of what happened, from the engine; never prose. */
  summary: z.string(),
  mechanics: MechanicsLine.optional(),
});
export type ResolvedStep = z.infer<typeof ResolvedStep>;

export const Resolution = z.object({
  actorId: z.string(),
  steps: z.array(ResolvedStep),
  /** Things the narration must mention, consistent with the steps. */
  requiredBeats: z.array(z.string()),
  /** Things the narration must not reveal or decide. */
  forbidden: z.array(z.string()).default([]),
  /** Set when an earlier result made a later action impossible; actions from here weren't run. */
  stoppedAt: z.number().int().nonnegative().optional(),
  minutes: z.number().int().nonnegative(),
});
export type Resolution = z.infer<typeof Resolution>;

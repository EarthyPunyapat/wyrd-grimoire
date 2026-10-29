import { z } from "zod";
import { ActorId, AttributeId, Degree, Difficulty, MechanicsLine, ResolutionId, SkillId } from "./common.ts";
import { LevelOpposition } from "./domains/levels.ts";

/** What a check tests: a skill, or a raw attribute (target = attribute × 10). */
export const CheckTarget = z.union([SkillId, z.object({ attribute: AttributeId })]);
export type CheckTarget = z.infer<typeof CheckTarget>;

export const Modifier = z.object({ source: z.string(), value: z.number().int() });
export type Modifier = z.infer<typeof Modifier>;

export const CheckRequest = z.object({
  actorId: ActorId,
  opposition: LevelOpposition.optional(),
  abilityId: z.string().min(1).optional(),
  exploit: z.string().trim().min(1).optional(),
  skill: CheckTarget,
  difficulty: Difficulty,
  modifiers: z.array(Modifier).default([]),
  boons: z.number().int().min(0).max(2).default(0),
  banes: z.number().int().min(0).max(2).default(0),
  opposedBy: z.object({ actorId: ActorId, skill: CheckTarget }).optional(),
  purpose: z.string(),
  pushed: z.boolean().optional(),
  /**
   * What kind of check this is, for conditions that care: "sight", "hearing", "attack", "escape",
   * "resist", "fear", "movement", "physical", "hand:<side>" (a hand check, for sameArm wound penalties),
   * "ignore-wound:<woundId>" (a wound's own lethal check skips that wound's penalty). Not in the spec's
   * CheckRequest; see decisions.md.
   */
  tags: z.array(z.string()).default([]),
});
export type CheckRequest = z.infer<typeof CheckRequest>;
export type CheckRequestInput = z.input<typeof CheckRequest>;

export const CheckResult = z.object({
  degree: Degree,
  margin: z.number().int(),
  rolls: z.array(z.number().int()),
  display: MechanicsLine,
});
export type CheckResult = z.infer<typeof CheckResult>;

/**
 * The fully prepared numbers a resolution module rolls against, recorded in `CheckResolved`
 * so the mechanics log and audits never need to recompute them.
 */
export const PreparedCheck = z.object({
  label: z.string(), // "Stealth", "Endurance"
  skillValue: z.number().int(), // 0–100 canonical scale (attribute checks: attribute × 10)
  difficulty: Difficulty,
  modifiers: z.array(Modifier), // every contributing modifier, including conditions and campaign difficulty
  modifierTotal: z.number().int(), // sum, clamped to ±tuning.modifierCap
  netBoons: z.number().int().min(-2).max(2),
});
export type PreparedCheck = z.infer<typeof PreparedCheck>;

export const CheckAttempt = z.enum(["initial", "push", "luck"]);
export type CheckAttempt = z.infer<typeof CheckAttempt>;

export const CheckResolvedPayload = z.object({
  actorId: ActorId,
  request: CheckRequest,
  module: ResolutionId,
  prepared: PreparedCheck,
  /** This roll's own result. */
  result: CheckResult,
  /** The result that counts: a failed push becomes critFailure; a Luck reroll keeps the better of two. */
  effective: CheckResult,
  attempt: CheckAttempt,
  inCombat: z.boolean(),
  /** Set when the roll fails without dice (e.g. a sight check while Blinded). */
  autoFailed: z.string().optional(),
  /** Set on both sides of an opposed check. */
  opposed: z
    .object({ role: z.enum(["active", "defender"]), againstActorId: ActorId, won: z.boolean() })
    .optional(),
  rngAfter: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type CheckResolvedPayload = z.infer<typeof CheckResolvedPayload>;

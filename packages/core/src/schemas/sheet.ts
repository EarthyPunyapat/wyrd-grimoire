import { z } from "zod";
import { ActorId, AttributeId, ContentId, SkillId } from "./common.ts";

export const AttributesSchema = z.record(AttributeId, z.number().int().min(1).max(10));
export type Attributes = Record<AttributeId, number>;

export const AppearanceFacts = z.object({
  build: z.string().optional(),
  hair: z.string().optional(),
  eyes: z.string().optional(),
  skin: z.string().optional(),
  marks: z.array(z.string()).default([]),
  clothingStyle: z.string().optional(),
});

/** An engine-tracked condition on an actor. One instance per condition ID; re-applying replaces it. */
export const ConditionInstance = z.object({
  id: ContentId, // e.g. "core:prone"
  level: z.number().int().min(1).optional(), // Bleeding 1–3, Exhausted 1–5, Intoxicated 1–3
  variant: z.string().optional(), // In Cover: "partial" | "full"
  sourceActorId: ActorId.optional(), // Frightened of whom, Grappled by whom
  note: z.string().optional(),
});
export type ConditionInstance = z.infer<typeof ConditionInstance>;

export const WoundSeverity = z.enum(["minor", "serious", "critical", "lethal"]);
export type WoundSeverity = z.infer<typeof WoundSeverity>;

/** Wound shape needed by the rules core (Luck can downgrade lethal → critical). Combat (M4) extends it. */
export const Wound = z.object({
  id: z.string(),
  location: z.string(),
  severity: WoundSeverity,
  damageType: z.string().optional(),
  hpMaxReduction: z.number().int().nonnegative().default(0),
});
export type Wound = z.infer<typeof Wound>;

export const PermanentInjury = z.object({ id: z.string(), location: z.string(), description: z.string() });

export const ProgressionState = z.object({
  xpEarned: z.number().int().nonnegative().default(0),
  xpSpent: z.number().int().nonnegative().default(0),
  marks: z.array(SkillId).default([]),
  classLevels: z.record(z.string(), z.number().int().min(1)).default({}),
});

export const DerivedStats = z.object({
  hpMax: z.number().int(),
  wt: z.number().int(),
  carryKg: z.number(),
  initiative: z.number().int(),
  composure: z.number().int().optional(),
});
export type DerivedStats = z.infer<typeof DerivedStats>;

export const CharacterSheet = z.object({
  id: ActorId,
  identity: z.object({
    name: z.string().min(1),
    pronouns: z.string().optional(),
    ancestry: ContentId,
    age: z.number().int().positive().optional(),
    appearance: AppearanceFacts.prefault({}),
    background: z.string().default(""),
    personality: z.array(z.string()).default([]),
    backstory: z.string().default(""),
    hookIds: z.array(z.string()).default([]),
  }),
  archetypeId: ContentId.optional(),
  attributes: AttributesSchema,
  /** Trained points per skill; the skill's value is untrained (attribute × 3) + trained. */
  skills: z.record(SkillId, z.object({ trained: z.number().int().nonnegative() })).default({}),
  talents: z.array(ContentId).default([]),
  languages: z.array(z.string()).default([]),
  derived: DerivedStats,
  status: z.object({
    hp: z.number().int().nonnegative(),
    luck: z.number().int().nonnegative(),
    conditions: z.array(ConditionInstance).default([]),
    wounds: z.array(Wound).default([]),
    permanentInjuries: z.array(PermanentInjury).default([]),
  }),
  progression: ProgressionState.prefault({}),
  voiceId: z.string().optional(),
  portraitAssetId: z.string().optional(),
});
export type CharacterSheet = z.infer<typeof CharacterSheet>;
export type CharacterSheetInput = z.input<typeof CharacterSheet>;

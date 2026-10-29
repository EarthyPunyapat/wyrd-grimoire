import { z } from "zod";
import type { LocationKind } from "../tuning.ts";
import { ActorId, AttributeId, ContentId, PenaltyScope, SkillId } from "./common.ts";

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

/** A wound on an actor. `penalty` is copied from the wound effect when the wound is inflicted; check penalties read it. */
export const Wound = z.object({
  id: z.string(),
  location: z.string(),
  locationKind: z.enum(["head", "torso", "arm", "leg"] as const satisfies readonly LocationKind[]),
  severity: WoundSeverity,
  damageType: z.string().optional(),
  hpMaxReduction: z.number().int().nonnegative().default(0),
  fracture: z.boolean().default(false),
  severed: z.boolean().default(false),
  /** The limb's side, copied from the body plan when the wound is inflicted. Only limbs have one. */
  side: z.enum(["left", "right"]).optional(),
  penalty: z.object({ scope: PenaltyScope, value: z.number().int() }).optional(),
});
export type Wound = z.infer<typeof Wound>;

export const PermanentInjury = z.object({ id: z.string(), location: z.string(), description: z.string() });

/**
 * What an actor holds, wears and carries. Held and worn items also appear in `carried`; the engine
 * enforces that and the hand rules (see engine/src/equipment.ts).
 */
export const Equipment = z.object({
  held: z.object({ main: ContentId.nullable(), off: ContentId.nullable() }),
  worn: z.array(ContentId),
  carried: z.array(z.object({ item: ContentId, qty: z.number().int().positive() })),
});
export type Equipment = z.infer<typeof Equipment>;

export const ProgressionState = z.object({
  xpEarned: z.number().int().nonnegative().default(0),
  xpSpent: z.number().int().nonnegative().default(0),
  marks: z.array(SkillId).default([]),
  /** The character's class in class mode, and every class's level (multiclassing later). */
  classId: ContentId.optional(),
  classLevels: z.record(z.string(), z.number().int().min(1)).default({}),
  /** Use-based grants waiting to be chosen: attribute points (arc closes) and talents (chapters). */
  pendingAttributes: z.number().int().nonnegative().default(0),
  pendingTalents: z.number().int().nonnegative().default(0),
  chaptersClosed: z.number().int().nonnegative().default(0),
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
  /** The body plan the ancestry resolved to (`packId:localId`). Old sheets default to the plain "humanoid". */
  bodyPlan: z.string().min(1).default("humanoid"),
  attributes: AttributesSchema,
  /** Trained points per skill; the skill's value is untrained (attribute × 3) + trained. */
  skills: z.record(SkillId, z.object({ trained: z.number().int().nonnegative() })).default({}),
  talents: z.array(ContentId).default([]),
  /** Spells the character knows (spellcasting plugin, spec 05). */
  spells: z.array(ContentId).default([]),
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
  equipment: Equipment.prefault({ held: { main: null, off: null }, worn: [], carried: [] }),
  voiceId: z.string().optional(),
  portraitAssetId: z.string().optional(),
});
export type CharacterSheet = z.infer<typeof CharacterSheet>;
export type CharacterSheetInput = z.input<typeof CharacterSheet>;

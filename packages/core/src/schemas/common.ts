import { z } from "zod";

export const ATTRIBUTE_IDS = ["str", "agi", "end", "int", "awa", "wil", "pre"] as const;
export const AttributeId = z.enum(ATTRIBUTE_IDS);
export type AttributeId = z.infer<typeof AttributeId>;

export const ATTRIBUTE_NAMES: Record<AttributeId, string> = {
  str: "Strength",
  agi: "Agility",
  end: "Endurance",
  int: "Intellect",
  awa: "Awareness",
  wil: "Willpower",
  pre: "Presence",
};

/** Namespaced content ID: `packId:localId`, with an optional field specialisation `packId:localId/field`. */
export const ContentId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/, "expected packId:localId[/field]");
export type ContentId = z.infer<typeof ContentId>;

export const SkillId = ContentId;
export type SkillId = ContentId;

export const ActorId = z.string().min(1);

/** A world inside a campaign (D141). v1 campaigns have one; everything recorded before W2 lives there. */
export const MAIN_WORLD = "world:main";
export const WorldId = z.string().regex(/^world:[a-z0-9-]+$/, "expected world:local-id");
export type WorldId = z.infer<typeof WorldId>;
export const World = z.object({ id: WorldId, name: z.string().min(1), source: z.string().optional() });
export type World = z.infer<typeof World>;
/** The world a record belongs to; records written before W2 have none and live in the main world. */
export const worldOf = (record: { worldId?: string | undefined }): string => record.worldId ?? MAIN_WORLD;
export type ActorId = z.infer<typeof ActorId>;

export const Degree = z.enum(["critSuccess", "success", "failure", "critFailure"]);
export type Degree = z.infer<typeof Degree>;

export const Difficulty = z.enum(["easy", "normal", "hard", "extreme", "heroic"]);
export type Difficulty = z.infer<typeof Difficulty>;

export const ResolutionId = z.enum(["d100", "d20"]);
export type ResolutionId = z.infer<typeof ResolutionId>;

export const DamageType = z.string().min(1); // cut, pierce, blunt, burn, cold, shock, poison, plus pack types
/** Which checks a wound penalty applies to. Shared by the wound effects table and the Wound schema. */
export const PenaltyScope = z.enum(["physical", "movement", "sameArm", "all"]);
export type PenaltyScope = z.infer<typeof PenaltyScope>;
export const RangeBand = z.enum(["engaged", "close", "near", "far", "distant"]);
export type RangeBand = z.infer<typeof RangeBand>;

export const RngStateSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);

/**
 * The structured dice detail behind a mechanics line (spec 02). `text` is still the
 * pre-rendered line the resolution module produced; this lets the UI label the dice mode and
 * keep a d100 roll out of a d20 campaign without re-implementing any rules.
 */
export const MechanicsRoll = z.object({
  /** Which resolution module produced the line. */
  die: ResolutionId,
  /** Die faces: 100 or 20. */
  sides: z.number().int().positive(),
  /** The die result that counted (the kept die of a boon/bane pair). */
  natural: z.number().int(),
  /** d20: the total modifier added to the die (skill + modifiers + boon bonus). */
  modifier: z.number().int().optional(),
  /** d20: die + modifier. */
  total: z.number().int().optional(),
  /** d100: the target percentage. */
  target: z.number().int().optional(),
  /** d20: the difficulty class. */
  dc: z.number().int().optional(),
});
export type MechanicsRoll = z.infer<typeof MechanicsRoll>;

/** A short pre-rendered line for the mechanics log, so the UI never re-implements rules. */
export const MechanicsLine = z.object({
  text: z.string(),
  degree: Degree.optional(),
  /** Present when the line records a dice roll. */
  roll: MechanicsRoll.optional(),
  /** What the roll was for, in the GM's words (a GM `roll` call's goal); shown with the outcome. */
  purpose: z.string().max(200).optional(),
});
export type MechanicsLine = z.infer<typeof MechanicsLine>;

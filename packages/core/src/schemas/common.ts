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
export type ActorId = z.infer<typeof ActorId>;

export const Degree = z.enum(["critSuccess", "success", "failure", "critFailure"]);
export type Degree = z.infer<typeof Degree>;

export const Difficulty = z.enum(["easy", "normal", "hard", "extreme", "heroic"]);
export type Difficulty = z.infer<typeof Difficulty>;

export const ResolutionId = z.enum(["d100", "d20"]);
export type ResolutionId = z.infer<typeof ResolutionId>;

export const DamageType = z.string().min(1); // cut, pierce, blunt, burn, cold, shock, poison, plus pack types
export const RangeBand = z.enum(["engaged", "close", "near", "far", "distant"]);
export type RangeBand = z.infer<typeof RangeBand>;

export const RngStateSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);

/** A short pre-rendered line for the mechanics log, so the UI never re-implements rules. */
export const MechanicsLine = z.object({
  text: z.string(),
  degree: Degree.optional(),
});
export type MechanicsLine = z.infer<typeof MechanicsLine>;

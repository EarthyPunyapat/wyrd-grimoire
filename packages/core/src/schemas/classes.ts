import { z } from "zod";
import { ContentRef } from "./pack.ts";

/**
 * Class progression data (spec 04, "Classes"). A pack that ships `classes.yaml` can run class
 * campaigns: XP crosses a level threshold, and the level grants training, features and sometimes
 * an attribute point. Numbers live in the pack data, never in the engine.
 */

const ClassId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected a lowercase local id (a-z, 0-9, -)");

/** One class feature, written fresh for the pack. A feature may also name a talent it grants. */
export const ClassFeature = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    /** Optional talent from the same pack that the feature adds to the sheet. */
    talent: ContentRef.optional(),
  })
  .strict();
export type ClassFeature = z.infer<typeof ClassFeature>;

/** One row of the level table: the total XP needed and what reaching the level grants. */
export const ClassLevel = z
  .object({
    level: z.number().int().min(1).max(20),
    /** Total XP needed to reach this level. Level 1 is always 0. */
    xp: z.number().int().nonnegative(),
    /** Trained points for the class's own skills, chosen by the player. */
    classSkillPoints: z.number().int().nonnegative().default(0),
    /** Trained points for any skill, chosen by the player. */
    anySkillPoints: z.number().int().nonnegative().default(0),
    /** Attribute points granted automatically (spec 04: levels 4 and 8). */
    attributePoints: z.number().int().nonnegative().default(0),
    features: z.array(ClassFeature).default([]),
  })
  .strict();
export type ClassLevel = z.infer<typeof ClassLevel>;

/** Whether a character may take levels in more than one class. */
export const MulticlassOption = z
  .object({
    allowed: z.boolean().default(false),
    maxClasses: z.number().int().min(1).max(4).default(2),
  })
  .strict();
export type MulticlassOption = z.infer<typeof MulticlassOption>;

export const ClassDef = z
  .object({
    id: ClassId,
    name: z.string().min(1),
    description: z.string().min(1),
    /** The class's skills. A field skill here means any of its specialisations. */
    skills: z.array(ContentRef).min(1),
    /** The level table, levels 1–10 by default, contiguous and ordered. */
    levels: z.array(ClassLevel).min(2).max(20),
    /** At most this many trained points per skill from one level's grant. */
    maxPointsPerSkillPerLevel: z.number().int().positive().default(10),
    /** Backgrounds that map to this class when a class campaign starts (spec 04). */
    archetypes: z.array(ContentRef).default([]),
    multiclass: MulticlassOption.prefault({}),
  })
  .strict();
export type ClassDef = z.infer<typeof ClassDef>;

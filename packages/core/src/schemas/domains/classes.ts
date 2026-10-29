import { z } from "zod";
import { ClassFeature } from "../classes.ts";
import { ActorId } from "../common.ts";

/**
 * Event payloads for class progression (M7). `events.ts` spreads this object.
 */
export const classEventSchemas = {
  /**
   * XP crossed a class level's threshold (spec 04). The payload carries what the level grants, so
   * the reducer needs no pack data and replay is exact.
   */
  ClassLevelGained: z.object({
    actorId: ActorId,
    classId: z.string(),
    level: z.number().int().min(1),
    classSkillPoints: z.number().int().nonnegative().default(0),
    anySkillPoints: z.number().int().nonnegative().default(0),
    attributes: z.number().int().nonnegative().default(0),
    features: z.array(ClassFeature).default([]),
  }),
  /** Class training points are spent on a skill, from the class pool or the any-skill pool. */
  ClassTrainingSpent: z.object({
    actorId: ActorId,
    classId: z.string(),
    /** The level whose grant pays for this training. */
    level: z.number().int().min(1),
    pool: z.enum(["class", "any"]),
    skillId: z.string(),
    amount: z.number().int().positive(),
  }),
} as const;

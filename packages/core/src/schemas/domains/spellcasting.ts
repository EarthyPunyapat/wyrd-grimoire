import { z } from "zod";
import { Degree } from "../common.ts";

/**
 * Spellcasting events (spec 05). A cast is one event: the engine has already validated AP, range
 * and the school check, so the narrator can describe an outcome that is already canonical.
 */
const Id = z.string().min(1);

export const SpellEffectSummary = z.object({
  kind: z.string().min(1),
  targetId: Id.optional(),
  amount: z.number().int().optional(),
  conditionId: Id.optional(),
  text: z.string().optional(),
});
export type SpellEffectSummary = z.infer<typeof SpellEffectSummary>;

export const MiscastResult = z.enum(["backlash", "wild", "attention", "lost"]);
export type MiscastResult = z.infer<typeof MiscastResult>;

export const spellEventSchemas = {
  SpellCast: z.object({
    actorId: Id,
    spellId: Id,
    targetIds: z.array(Id).default([]),
    degree: Degree.optional(),
    apCost: z.number().int().nonnegative().default(0),
    strain: z.number().int().nonnegative().default(0),
    effects: z.array(SpellEffectSummary).default([]),
    /** A spell that holds concentration keeps this until game time (minutes since epoch). */
    concentrationUntil: z.number().int().nonnegative().optional(),
    summary: z.string().min(1),
  }),
  SpellMiscast: z.object({
    actorId: Id,
    spellId: Id,
    result: MiscastResult,
    damage: z.number().int().nonnegative().default(0),
    summary: z.string().min(1),
  }),
} as const;

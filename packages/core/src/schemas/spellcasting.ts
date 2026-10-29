import { z } from "zod";
import { ActorId, ContentId, Difficulty } from "./common.ts";

/**
 * Spell data and plugin state (spec 05, the spellcasting plugin). Spells are pack data; casting is
 * engine code. The engine never trusts the model with an effect: the parser proposes a spell and
 * targets, the engine validates the AP, range and check, then emits the events.
 */

const LocalId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected a lowercase local id (a-z, 0-9, -)");

export const SPELL_SCHOOLS = ["elemental", "healing", "illusion", "warding"] as const;
export const SpellSchool = z.enum(SPELL_SCHOOLS);
export type SpellSchool = z.infer<typeof SpellSchool>;

export const SpellRange = z.enum(["self", "touch", "near", "far"]);
export type SpellRange = z.infer<typeof SpellRange>;

export const SpellTarget = z.enum(["self", "actor", "zone", "none"]);
export type SpellTarget = z.infer<typeof SpellTarget>;

/** One effect a spell applies on a successful cast. */
export const SpellEffect = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("damage"),
    amount: z.number().int().positive(),
    damageType: z.string().default("arcane"),
  }),
  z.object({ kind: z.literal("heal"), amount: z.number().int().positive() }),
  z.object({
    kind: z.literal("applyCondition"),
    conditionId: ContentId,
    level: z.number().int().min(1).optional(),
    note: z.string().optional(),
  }),
  z.object({ kind: z.literal("removeCondition"), conditionId: ContentId }),
  z.object({
    kind: z.literal("createZoneTag"),
    tag: z.string().trim().min(1).max(60),
    zoneId: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("moveTarget"), toZoneId: z.string().min(1).optional() }),
  z.object({ kind: z.literal("ward"), amount: z.number().int().positive() }),
  z.object({ kind: z.literal("summon"), creatureId: ContentId }),
  z.object({ kind: z.literal("detect"), what: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal("illusion"), text: z.string().trim().min(1).max(300) }),
]);
export type SpellEffect = z.infer<typeof SpellEffect>;

export const SpellCheck = z.object({
  skill: z.string().min(1),
  difficulty: Difficulty.default("normal"),
});
export type SpellCheck = z.infer<typeof SpellCheck>;

export const SpellDef = z.object({
  id: LocalId,
  name: z.string().trim().min(1).max(80),
  description: z.string().default(""),
  school: SpellSchool,
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Action points in combat; 0 means a free action outside a fight. */
  apCost: z.number().int().min(0).max(3).default(1),
  range: SpellRange.default("near"),
  target: SpellTarget.default("actor"),
  check: SpellCheck.optional(),
  /** HP paid as strain; defaults to the tuning table by tier. */
  strain: z.number().int().nonnegative().optional(),
  effects: z.array(SpellEffect).min(1),
  durationMinutes: z.number().int().positive().optional(),
  concentration: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});
export type SpellDef = z.infer<typeof SpellDef>;

/** Per-actor spell knowledge and concentration, kept under `GameState.flags.spellcasting`. */
export const SpellcastingState = z.object({
  /** An actor's known spell ids; absent means every spell in the pack. */
  known: z.record(ActorId, z.array(z.string())).default({}),
  concentration: z
    .record(ActorId, z.object({ spellId: z.string(), until: z.number().int().nonnegative() }))
    .default({}),
});
export type SpellcastingState = z.infer<typeof SpellcastingState>;

export function spellcastingOf(flags: Record<string, unknown> | undefined): SpellcastingState {
  const parsed = SpellcastingState.safeParse(flags?.spellcasting ?? {});
  return parsed.success ? parsed.data : SpellcastingState.parse({});
}

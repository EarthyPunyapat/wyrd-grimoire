import { z } from "zod";
import { WorldId } from "../common.ts";

const id = z.string().min(1);
export const CanonClockPlan = z.object({
  startedAt: z.number().int().nonnegative(),
  outcome: z.object({
    entityId: id,
    predicate: id,
    value: z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.unknown())]),
  }),
  intervention: z.object({ entityId: id, predicate: id }).optional(),
});
export const CanonAutonomy = z.object({
  entityId: id,
  worldId: WorldId,
  motivation: z.string().min(1).max(1500),
  action: z.string().min(1).max(1500),
  paceDays: z.number().int().positive(),
  startedAt: z.number().int().nonnegative(),
});
export type CanonAutonomy = z.infer<typeof CanonAutonomy>;
export type CanonClockResult = { status: "occurred" | "averted"; factId?: string };
export type CanonActorProgress = { profile: CanonAutonomy; lastActedAt: number };

export const canonEventSchemas = {
  CanonSourceSet: z.object({ worldId: WorldId, source: id }),
  CanonClockIntervened: z.object({ clockId: id, factId: id }),
  CanonClockResolved: z.object({
    clockId: id,
    status: z.enum(["occurred", "averted"]),
    factId: id.optional(),
  }),
  CanonActorConfigured: z.object({ profile: CanonAutonomy }),
  CanonActorActed: z.object({ entityId: id, at: z.number().int().nonnegative() }),
} as const;

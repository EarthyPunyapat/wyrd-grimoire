import { z } from "zod";
import { ActorId, MAIN_WORLD, WorldId } from "../common.ts";
import { Level } from "./levels.ts";

/**
 * Avatars and sealing (W2 step 3 B, spec §7, D134). A run is a projection of these events; the
 * sovereign's sheet is never touched, and an avatar's death closes only its own run.
 */
export const AvatarRunReason = z.enum(["died", "completed", "unsealed"]);
export type AvatarRunReason = z.infer<typeof AvatarRunReason>;

/** One avatar run as projected into `flags.avatarRuns`. */
export const AvatarRun = z.object({
  avatarId: ActorId,
  sovereignId: ActorId,
  level: Level,
  worldId: WorldId.default(MAIN_WORLD),
  status: z.enum(["active", "ended"]).default("active"),
  reason: AvatarRunReason.optional(),
  startedAt: z.number().int().nonnegative().default(0),
  endedAt: z.number().int().nonnegative().optional(),
});
export type AvatarRun = z.infer<typeof AvatarRun>;

export const avatarEventSchemas = {
  AvatarCreated: z.object({
    avatarId: ActorId,
    sovereignId: ActorId,
    level: Level,
    worldId: WorldId.default(MAIN_WORLD),
  }),
  AvatarRunEnded: z.object({ avatarId: ActorId, reason: AvatarRunReason }),
  SealSet: z.object({ actorId: ActorId, effectiveLevel: Level }),
  SealBroken: z.object({ actorId: ActorId }),
} as const;

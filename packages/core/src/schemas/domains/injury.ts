import { z } from "zod";
import { PermanentInjury } from "../sheet.ts";

/**
 * Injury completion events (spec 03, Healing). A wound heals over game time; an untreated wound
 * can infect; a badly healed critical can leave a permanent injury. Rests are actions, not events.
 */
const Id = z.string().min(1);

export const injuryEventSchemas = {
  /** A wound finished healing; the effector restores nothing else because max HP derives from wounds. */
  WoundHealed: z.object({ actorId: Id, woundId: Id, summary: z.string().min(1) }),
  /** One day of healing passed; `healingDays` is how many remain. */
  WoundProgressed: z.object({ actorId: Id, woundId: Id, healingDays: z.number().int().nonnegative() }),
  /** An untreated wound turned infected. */
  WoundInfected: z.object({ actorId: Id, woundId: Id, summary: z.string().min(1) }),
  /** A wound was treated: first aid, a set fracture, or clean rest. */
  WoundTreated: z.object({
    actorId: Id,
    woundId: Id,
    kind: z.enum(["firstAid", "fracture", "rest"]),
    summary: z.string().min(1),
  }),
  /** A critical wound healed badly and left a lasting mark. */
  PermanentInjuryGained: z.object({
    actorId: Id,
    injury: PermanentInjury,
    summary: z.string().min(1),
  }),
} as const;

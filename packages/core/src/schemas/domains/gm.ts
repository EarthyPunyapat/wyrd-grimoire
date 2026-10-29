import { z } from "zod";
import { GearDef } from "../pack.ts";

const DraftSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
  source: z.enum(["engine", "model", "player", "system"]).optional(),
});

/**
 * Events the GM turn adds (Wyrd 2.0, D144/D149). They live in a domain module so workstreams can
 * add their own without touching the registry by hand.
 */
export const gmEventSchemas = {
  /** A GM-invented gear item, merged into the catalog by `catalogWith`. */
  ItemDefined: z.object({
    itemId: z.string().regex(/^campaign:[a-z0-9-]+$/, "expected campaign:local-id"),
    def: GearDef,
  }),
  /** A player-authorised retcon, with the events that undo it. */
  RetconApplied: z.object({
    retconId: z.string().min(1),
    turnId: z.string().min(1),
    summary: z.string().min(1).max(200),
    inverse: z.array(DraftSchema),
  }),
  RetconUndone: z.object({ retconId: z.string().min(1) }),
  /** The non-blocking structural check's reading of a passage: a record, never game state (D144). */
  CheckReported: z.object({
    turnId: z.string().min(1),
    flags: z.array(z.object({ quote: z.string().min(1), claim: z.string().min(1) })).default([]),
    /** The changes the turn recorded, as plain lines for the check's prompt and the player. */
    recorded: z.array(z.string()).default([]),
  }),
};

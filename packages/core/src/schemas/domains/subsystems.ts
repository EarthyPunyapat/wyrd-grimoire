import { z } from "zod";
import { ActorId } from "../common.ts";
import { ShopState } from "../inventory.ts";

/**
 * Inventory and economy events (spec 11). The inventory projection is the detailed record; the
 * character sheet's equipment is the combat-facing view that the existing rules already read.
 */
const Id = z.string().min(1);

export const subsystemEventSchemas = {
  /** Coins moved into or out of an actor's purse. */
  CoinsChanged: z.object({
    actorId: ActorId,
    delta: z.number().int(),
    reason: z.string().min(1),
  }),
  /** An item stack entered or left an actor's inventory. */
  ItemTransferred: z.object({
    actorId: ActorId,
    itemId: Id,
    qty: z.number().int().positive(),
    /** Where it went; omitted on removal. */
    location: z
      .object({
        kind: z.enum(["held", "worn", "container", "carried"]),
        slot: z.string().optional(),
        containerId: z.string().optional(),
        hand: z.enum(["main", "off"]).optional(),
      })
      .optional(),
    reason: z.string().min(1),
  }),
  /** An item's condition moved one step (durability). */
  ItemConditionChanged: z.object({
    actorId: ActorId,
    itemId: Id,
    condition: z.enum(["pristine", "worn", "damaged", "broken"]),
    reason: z.string().min(1),
  }),
  /** A shop opened in a settlement (campaign creation or world generation). */
  ShopOpened: z.object({ shop: ShopState }),
  /** One shop line changed quantity (a purchase or a restock). */
  ShopStockChanged: z.object({
    shopId: Id,
    itemId: Id,
    delta: z.number().int(),
    reason: z.string().min(1),
  }),
  /** Shop stock was refreshed from the pack's tables. */
  ShopRefreshed: z.object({ shopId: Id, stock: z.array(z.unknown()).default([]) }),
  /** A haggling attempt resolved; `multiplier` applies to the shop's price for this visit. */
  BargainStruck: z.object({
    actorId: ActorId,
    shopId: Id,
    multiplier: z.number().positive(),
    summary: z.string().min(1),
  }),
} as const;

import { z } from "zod";

/**
 * Loot tables (spec 05/06/11): a bounded source of coins and items for a creature, a cache or a
 * shop's stock. The engine rolls them with its seeded RNG; the pack only supplies the odds.
 */

/** A content reference in a pack file (`rope` or `fantasy-core:rope`). The loader qualifies it. */
const ContentRefLike = z
  .string()
  .regex(/^([a-z0-9][a-z0-9-]*:)?[a-z0-9][a-z0-9-]*$/, "expected [packId:]localId");

const LocalId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected a lowercase local id (a-z, 0-9, -)");

const Range = z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() });

export const LootEntryDef = z.object({
  /** An item from the pack, or omitted for a pure coin entry. */
  item: ContentRefLike.optional(),
  /** How many are found when this entry is rolled. */
  qty: Range.default({ min: 1, max: 1 }),
  /** Relative weight among a table's entries. */
  weight: z.number().positive().default(1),
  /** Coins in the pack's smallest denomination. */
  coins: Range.optional(),
});
export type LootEntryDef = z.infer<typeof LootEntryDef>;

export const LootTableDef = z.object({
  id: LocalId,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["coins", "gear", "mixed", "creature", "hoard", "shop"]).default("mixed"),
  /** How many entries are drawn (with replacement) when the table is rolled. */
  rolls: z.number().int().min(1).max(20).default(1),
  entries: z.array(LootEntryDef).min(1).max(60),
  tags: z.array(z.string()).default([]),
});
export type LootTableDef = z.infer<typeof LootTableDef>;

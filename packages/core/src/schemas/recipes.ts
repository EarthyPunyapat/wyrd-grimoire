import { z } from "zod";
import { Difficulty } from "./common.ts";

/**
 * Crafting recipes (spec 11, Crafting). `recipes.yaml` is shared with the inventory workstream:
 * this file only defines the data shape, not the inventory rules that consume it.
 */

const LocalId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected a lowercase local id (a-z, 0-9, -)");
const ContentRefLike = z
  .string()
  .regex(/^([a-z0-9][a-z0-9-]*:)?[a-z0-9][a-z0-9-]*$/, "expected [packId:]localId");

export const RecipeInputDef = z.object({
  item: ContentRefLike,
  qty: z.number().int().positive().default(1),
});
export type RecipeInputDef = z.infer<typeof RecipeInputDef>;

export const RecipeDef = z.object({
  id: LocalId,
  name: z.string().trim().min(1).max(80),
  description: z.string().default(""),
  output: z.object({ item: ContentRefLike, qty: z.number().int().positive().default(1) }),
  inputs: z.array(RecipeInputDef).min(1).max(12),
  /** Tool tags the crafter needs (e.g. `smith`, `kitchen`); empty means bare hands. */
  tools: z.array(z.string()).default([]),
  /** The check a downtime craft rolls; defaults to the core Craft skill. */
  skill: ContentRefLike.default("core:craft"),
  difficulty: Difficulty.default("normal"),
  /** Time one attempt takes, in game minutes. */
  minutes: z.number().int().positive().default(60),
  /** Complex items produce nothing on a failure; simple ones produce a crude version. */
  complex: z.boolean().default(false),
  /** A talent that upgrades a critSuccess from fine to masterwork. */
  masterworkTalent: ContentRefLike.optional(),
  tags: z.array(z.string()).default([]),
});
export type RecipeDef = z.infer<typeof RecipeDef>;

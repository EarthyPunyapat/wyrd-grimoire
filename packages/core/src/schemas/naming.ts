import { z } from "zod";

/**
 * Naming styles (spec 06, Names): each culture or region draws names from a style in
 * `naming.yaml`. The engine uses these for NPC life events (births) and world generation.
 */

const LocalId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected a lowercase local id (a-z, 0-9, -)");

export const NamingStyleDef = z.object({
  id: LocalId,
  name: z.string().trim().min(1).max(80),
  given: z.array(z.string().trim().min(1).max(60)).min(1).max(80),
  family: z.array(z.string().trim().min(1).max(60)).max(80).default([]),
  /** Patterns for a full name; `{given}`, `{family}` and `{place}` are replaced. */
  patterns: z.array(z.string().trim().min(1).max(80)).default(["{given} {family}"]),
  /** Regions or cultures this style suits, by name. Empty means any. */
  cultures: z.array(z.string()).default([]),
});
export type NamingStyleDef = z.infer<typeof NamingStyleDef>;

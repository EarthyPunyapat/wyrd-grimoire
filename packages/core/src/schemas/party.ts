import { z } from "zod";

// ── Progression and the party (spec 04, spec 13 Party tab) ──────────────────────────────────────

const Priced = { cost: z.number().nullable(), why: z.string().optional() };
export const ProgressionMember = z.object({
  actorId: z.string(),
  name: z.string(),
  role: z.enum(["pc", "companion"]),
  xp: z.object({ earned: z.number(), spent: z.number(), available: z.number() }),
  pending: z.object({ attributes: z.number(), talents: z.number() }),
  marks: z.array(z.string()),
  attributes: z.array(z.object({ id: z.string(), name: z.string(), value: z.number(), ...Priced })),
  skills: z.array(z.object({ id: z.string(), name: z.string(), value: z.number(), ...Priced })),
  talents: z.array(
    z.object({ id: z.string(), name: z.string(), tier: z.number(), description: z.string(), ...Priced }),
  ),
  fieldSkills: z.array(z.object({ id: z.string(), name: z.string(), ...Priced })),
});
export type ProgressionMember = z.infer<typeof ProgressionMember>;
export const ProgressionView = z.object({
  mode: z.enum(["classless", "useBased", "hybrid", "classes"]),
  members: z.array(ProgressionMember),
});
export type ProgressionView = z.infer<typeof ProgressionView>;
export const AdvanceInput = z
  .object({
    actorId: z.string().min(1).max(80),
    kind: z.enum(["skill", "attribute", "talent", "fieldSkill"]),
    id: z.string().min(1).max(120),
  })
  .strict();

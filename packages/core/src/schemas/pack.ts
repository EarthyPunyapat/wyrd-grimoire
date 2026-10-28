import { z } from "zod";
import { DiceExpr } from "../dice.ts";
import { AttributeId, RangeBand } from "./common.ts";

/**
 * Pack content schemas, as authored in YAML. Entry IDs are local (`arcana`); references may be
 * local or fully qualified (`core:melee`, `other-pack:thing`). The loader namespaces everything
 * to `packId:localId` when it compiles the pack.
 */

const LocalId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected a lowercase local id (a-z, 0-9, -)");
/** A reference to content: local id, `pack:id`, or either with a `/field` specialisation. */
export const ContentRef = z
  .string()
  .regex(
    /^([a-z0-9][a-z0-9-]*:)?[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/,
    "expected [packId:]localId[/field]",
  );

const SemverRe = /^\d+\.\d+\.\d+$/;

export const PackManifest = z.object({
  id: LocalId,
  name: z.string().min(1),
  version: z.string().regex(SemverRe, "expected semver x.y.z"),
  engine: z.string().min(1),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  kind: z.enum(["genre", "addon"]),
  requires: z.array(z.string()).default([]),
  plugins: z.array(z.object({ id: z.string(), config: z.string().optional() })).default([]),
  supports: z
    .object({
      progression: z.array(z.enum(["classless", "useBased", "hybrid", "classes"])).default(["classless"]),
      bodyPlans: z.array(z.string()).default(["humanoid"]),
    })
    .prefault({}),
});
export type PackManifest = z.infer<typeof PackManifest>;

export const SkillGroup = z.enum([
  "combat",
  "physical",
  "senses",
  "social",
  "knowledge",
  "magic",
  "faith",
  "other",
]);

export const SkillDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  group: SkillGroup,
  /** Governing attributes; with two, the higher is used. */
  attributes: z.array(AttributeId).min(1).max(2),
  /** Field skills take a specialisation and each specialisation is a separate skill: `lore/history`. */
  field: z.boolean().default(false),
  /** Suggested specialisations for field skills (any is allowed). */
  fields: z.array(LocalId).default([]),
  description: z.string().default(""),
});
export type SkillDef = z.infer<typeof SkillDef>;

export const Prerequisites = z.object({
  attributes: z.partialRecord(AttributeId, z.number().int().min(1).max(10)).default({}),
  skills: z.record(ContentRef, z.number().int().min(1).max(99)).default({}),
  talents: z.array(ContentRef).default([]),
});

export const TalentDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  tier: z.number().int().min(1).max(3),
  description: z.string().min(1),
  prerequisites: Prerequisites.prefault({}),
});
export type TalentDef = z.infer<typeof TalentDef>;

export const AncestryDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  description: z.string().min(1),
  bodyPlan: z.string().default("humanoid"),
  /** Attributes this ancestry may raise to 8 at creation instead of 7. */
  attributeMaxBonus: z.array(AttributeId).default([]),
  languages: z.array(z.string()).default([]),
  traits: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
});
export type AncestryDef = z.infer<typeof AncestryDef>;

export const KitEntry = z.object({ item: ContentRef, qty: z.number().int().positive().default(1) });

export const ArchetypeDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  description: z.string().min(1),
  suggestedAttributes: z.record(AttributeId, z.number().int().min(1).max(10)),
  /** Suggested trained points (core + interest) per skill. */
  skills: z.record(ContentRef, z.number().int().positive()),
  talent: ContentRef,
  kit: z.array(KitEntry).default([]),
  backstoryPrompts: z.array(z.string()).default([]),
});
export type ArchetypeDef = z.infer<typeof ArchetypeDef>;

const ItemBase = {
  id: LocalId,
  name: z.string().min(1),
  description: z.string().default(""),
  weightKg: z.number().nonnegative(),
  /** Price in the pack's smallest currency unit. */
  price: z.number().int().nonnegative(),
  tags: z.array(z.string()).default([]),
};

export const WeaponDef = z.object({
  ...ItemBase,
  skill: ContentRef,
  damage: DiceExpr,
  damageType: z.string().min(1),
  armorPiercing: z.number().int().nonnegative().default(0),
  hands: z.union([z.literal(1), z.literal(2)]),
  /** Range bands the weapon works in, with the modifier at each; a missing band means it can't be used there. */
  ranges: z.partialRecord(RangeBand, z.number().int()),
  reloadAp: z.number().int().nonnegative().default(0),
});
export type WeaponDef = z.infer<typeof WeaponDef>;

export const ArmorDef = z.object({
  ...ItemBase,
  covers: z.array(z.string()).min(1),
  protection: z.record(z.string(), z.number().int().nonnegative()),
  penalties: z.array(z.object({ skill: ContentRef, value: z.number().int() })).default([]),
});
export type ArmorDef = z.infer<typeof ArmorDef>;

export const GearDef = z.object(ItemBase);
export type GearDef = z.infer<typeof GearDef>;

/** A compiled pack: every ID namespaced, every reference resolved to a full ID. */
export type CompiledPack = {
  manifest: PackManifest;
  tone: string;
  skills: Record<string, SkillDef & { id: string }>;
  talents: Record<string, TalentDef & { id: string }>;
  ancestries: Record<string, AncestryDef & { id: string }>;
  archetypes: Record<string, ArchetypeDef & { id: string }>;
  items: {
    weapons: Record<string, WeaponDef & { id: string }>;
    armor: Record<string, ArmorDef & { id: string }>;
    gear: Record<string, GearDef & { id: string }>;
  };
  hash: string;
};

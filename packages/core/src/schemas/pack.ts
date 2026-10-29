import { z } from "zod";
import { DiceExpr } from "../dice.ts";
import type { LocationKind } from "../tuning.ts";
import type { ClassDef } from "./classes.ts";
import { AttributeId, RangeBand } from "./common.ts";
import { BackstoryHook } from "./creation.ts";
import { AppearanceFacts } from "./sheet.ts";

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

const LOCATION_KINDS = ["head", "torso", "arm", "leg"] as const satisfies readonly LocationKind[];

/** One hit location: the d100 bands `from`–`to` (inclusive) land here. */
export const BodyLocationDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  kind: z.enum(LOCATION_KINDS),
  side: z.enum(["left", "right"]).optional(),
  from: z.number().int().min(1).max(100),
  to: z.number().int().min(1).max(100),
  /** Scales final damage at this location (head 1.5). */
  multiplier: z.number().positive().default(1),
});
export type BodyLocationDef = z.infer<typeof BodyLocationDef>;

/** A pack-defined body plan: the hit-location table an attack rolls on. */
export const BodyPlanDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  locations: z.array(BodyLocationDef).min(1),
});
export type BodyPlanDef = z.infer<typeof BodyPlanDef>;

/** The part of an ID after the last `:`. */
export const localIdOf = (id: string): string => id.slice(id.lastIndexOf(":") + 1);

/**
 * The humanoid body plan, built into the engine so every pack can use it without declaring it
 * (spec 03, "Hit locations"; spec 05, `bodyplans.yaml`). Head × 1.5 is read by hit resolution.
 */
export const HUMANOID_BODY_PLAN: BodyPlanDef = {
  id: "core:humanoid",
  name: "Humanoid",
  locations: [
    { id: "head", name: "Head", kind: "head", from: 1, to: 10, multiplier: 1.5 },
    { id: "torso", name: "Torso", kind: "torso", from: 11, to: 50, multiplier: 1 },
    { id: "right-arm", name: "Right Arm", kind: "arm", side: "right", from: 51, to: 60, multiplier: 1 },
    { id: "left-arm", name: "Left Arm", kind: "arm", side: "left", from: 61, to: 70, multiplier: 1 },
    { id: "right-leg", name: "Right Leg", kind: "leg", side: "right", from: 71, to: 85, multiplier: 1 },
    { id: "left-leg", name: "Left Leg", kind: "leg", side: "left", from: 86, to: 100, multiplier: 1 },
  ],
};

/**
 * Finds a body plan by ID. An exact match wins; then the first plan whose local ID (the part after
 * the last `:`) equals the local ID asked for, so `humanoid` finds `fantasy-core:humanoid`. A
 * humanoid request that no pack plan matches falls back to the built-in `HUMANOID_BODY_PLAN`.
 */
export function findBodyPlan(plans: Record<string, BodyPlanDef>, id: string): BodyPlanDef | undefined {
  if (Object.hasOwn(plans, id)) return plans[id];
  const local = localIdOf(id);
  const found = Object.values(plans).find((plan) => localIdOf(plan.id) === local);
  if (found) return found;
  return local === localIdOf(HUMANOID_BODY_PLAN.id) ? HUMANOID_BODY_PLAN : undefined;
}

export const KitEntry = z.object({ item: ContentRef, qty: z.number().int().positive().default(1) });
export type KitEntry = z.infer<typeof KitEntry>;

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

/**
 * A ready-to-play character (spec 04 quick start). Attributes, skills and kit come from the
 * archetype; the pregen adds a person: a name, a free talent, looks, a backstory and hooks.
 */
export const PregenDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  pronouns: z.string().default(""),
  ancestry: ContentRef,
  archetype: ContentRef,
  freeTalent: ContentRef.optional(),
  appearance: AppearanceFacts.prefault({}),
  personality: z.array(z.string()).default([]),
  backstory: z.string().min(1),
  hooks: z.array(BackstoryHook).default([]),
  /** For a portrait generator; no portraits ship as images yet. */
  portraitPrompt: z.string().default(""),
});
export type PregenDef = z.infer<typeof PregenDef>;

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
  /** Whether the wielder's STR bonus adds to damage. The loader fills it in: true unless the skill is `ranged`. */
  strengthBonus: z.boolean().optional(),
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

export const CreatureSize = z.enum(["tiny", "small", "medium", "large", "huge"]);
export type CreatureSize = z.infer<typeof CreatureSize>;

/**
 * A creature or NPC stat block (spec 05, creatures). Natural weapons and hide compile into the
 * pack's item tables as `pack:creature-weapon` / `pack:creature-hide`, so combat treats them like gear.
 */
export const CreatureDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  description: z.string().min(1),
  size: CreatureSize.default("medium"),
  bodyPlan: ContentRef.default("humanoid"),
  attributes: z.record(AttributeId, z.number().int().min(1).max(10)),
  /** Trained points per skill. */
  skills: z.record(ContentRef, z.number().int().nonnegative()).default({}),
  kit: z.array(KitEntry).default([]),
  naturalWeapons: z
    .array(
      WeaponDef.omit({ weightKg: true, price: true }).extend({
        weightKg: z.number().default(0),
        price: z.number().int().default(0),
      }),
    )
    .default([]),
  naturalArmor: z
    .object({
      covers: z.array(z.string()).min(1),
      protection: z.record(z.string(), z.number().int().nonnegative()),
    })
    .optional(),
  tactics: z
    .enum(["aggressive", "defensive", "cowardly", "cunning", "berserk", "protector", "sniper", "caster"])
    .default("aggressive"),
  intent: z.enum(["kill", "rob", "capture", "arrest", "driveOff", "prey"]).default("kill"),
});
export type CreatureDef = z.infer<typeof CreatureDef>;

/** A compiled pack: every ID namespaced, every reference resolved to a full ID. */
export type CompiledPack = {
  manifest: PackManifest;
  tone: string;
  skills: Record<string, SkillDef & { id: string }>;
  talents: Record<string, TalentDef & { id: string }>;
  ancestries: Record<string, AncestryDef & { id: string }>;
  bodyPlans: Record<string, BodyPlanDef>;
  archetypes: Record<string, ArchetypeDef & { id: string }>;
  /** Classes for class mode (spec 04). Empty when the pack has no `classes.yaml`. */
  classes: Record<string, ClassDef & { id: string }>;
  pregens: Record<string, PregenDef & { id: string }>;
  creatures: Record<string, CreatureDef & { id: string }>;
  items: {
    weapons: Record<string, WeaponDef & { id: string }>;
    armor: Record<string, ArmorDef & { id: string }>;
    gear: Record<string, GearDef & { id: string }>;
  };
  hash: string;
};

/** Every item a pack defines, by namespaced ID, in the three categories the rules distinguish. */
export type ItemCatalog = CompiledPack["items"];

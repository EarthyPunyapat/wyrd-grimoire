import { z } from "zod";
import { DiceExpr } from "../dice.ts";
import type { LocationKind } from "../tuning.ts";
import { AttributeId, Difficulty, RangeBand } from "./common.ts";
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
  /** In class mode, the class this background maps onto (spec 04). */
  class: ContentRef.optional(),
  /** Spells this background starts knowing (spellcasting plugin). */
  spells: z.array(ContentRef).default([]),
  kit: z.array(KitEntry).default([]),
  backstoryPrompts: z.array(z.string()).default([]),
});
export type ArchetypeDef = z.infer<typeof ArchetypeDef>;

/**
 * A ready-to-play character (spec 04 quick start). Attributes, skills and kit come from the
 * archetype; the pregen adds a person: a name, a free talent, looks, a backstory and hooks.
 */
/**
 * A class for class progression (spec 04). Levels run 1–10 by default; XP thresholds are engine
 * tuning, and each level grants training in the class skills plus a class feature at set levels.
 */
export const ClassFeature = z.object({
  level: z.number().int().min(1).max(10),
  name: z.string().min(1),
  description: z.string().default(""),
  /** A talent the feature grants when the level is reached. */
  talent: ContentRef.optional(),
});
export type ClassFeature = z.infer<typeof ClassFeature>;

export const ClassDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  description: z.string().min(1),
  /** Skills this class trains; each level's class points go to these. */
  skills: z.array(ContentRef).min(1),
  features: z.array(ClassFeature).default([]),
  /** Which archetypes map onto this class at creation. */
  archetypes: z.array(ContentRef).default([]),
});
export type ClassDef = z.infer<typeof ClassDef>;

export const SpellSchool = z.enum(["elemental", "healing", "illusion", "warding"]);
export type SpellSchool = z.infer<typeof SpellSchool>;

export const SpellEffect = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("damage"),
    dice: DiceExpr,
    damageType: z.string().min(1),
    armorPiercing: z.number().int().nonnegative().default(0),
  }),
  z.object({ kind: z.literal("heal"), dice: DiceExpr }),
  z.object({
    kind: z.literal("applyCondition"),
    condition: ContentRef,
    level: z.number().int().min(1).max(5).optional(),
    note: z.string().optional(),
  }),
  z.object({ kind: z.literal("removeCondition"), condition: ContentRef }),
  z.object({
    kind: z.literal("zoneTag"),
    tag: z.string().min(1),
    duration: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("moveTarget"),
    toZoneId: z.string().optional(),
    metres: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("ward"),
    protection: z.number().int().positive(),
    damageTypes: z.array(z.string()).default([]),
    duration: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("summon"),
    creature: ContentRef,
    count: z.number().int().min(1).max(3).default(1),
  }),
  z.object({ kind: z.literal("detect"), what: z.enum(["hidden", "magic", "lies", "traps"]) }),
  z.object({ kind: z.literal("illusion"), difficulty: Difficulty.default("normal") }),
]);
export type SpellEffect = z.infer<typeof SpellEffect>;

/** A spell (spec 05): data the spellcasting plugin resolves. Strain and miscasts are plugin rules. */
export const SpellDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  description: z.string().default(""),
  school: SpellSchool,
  tier: z.number().int().min(1).max(3),
  apCost: z.number().int().min(1).max(3),
  range: RangeBand,
  target: z.enum(["self", "actor", "zone", "area"]),
  check: ContentRef,
  difficulty: Difficulty.default("normal"),
  effects: z.array(SpellEffect).min(1),
  /** Strain points; defaults to the tier's cost from tuning. */
  strain: z.number().int().nonnegative().optional(),
  components: z.array(z.string()).default([]),
  duration: z.number().int().positive().optional(),
  concentration: z.boolean().default(false),
});
export type SpellDef = z.infer<typeof SpellDef>;

/** The spellcasting plugin's pack config: school list and per-school miscast results. */
export const SpellcastingConfig = z.object({
  schools: z.array(SpellSchool).min(1).default(["elemental", "healing", "illusion", "warding"]),
  /** Extra strain past this threshold gives an Exhausted level (spec 05). */
  strainThreshold: z.number().int().positive().default(3),
  miscasts: z
    .partialRecord(
      SpellSchool,
      z.array(
        z.object({
          name: z.string().min(1),
          description: z.string().min(1),
          damage: DiceExpr.optional(),
          condition: ContentRef.optional(),
          attention: z.boolean().default(false),
          loseSpell: z.boolean().default(false),
        }),
      ),
    )
    .default({}),
});
export type SpellcastingConfig = z.infer<typeof SpellcastingConfig>;

export const LootEntry = z.object({
  item: ContentRef,
  weight: z.number().positive().default(1),
  qtyMin: z.number().int().positive().default(1),
  qtyMax: z.number().int().positive().default(1),
  coins: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).optional(),
});
export const LootTableDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  description: z.string().default(""),
  /** Who or what the table is for: a settlement size, creature tag or quest kind. */
  tags: z.array(z.string()).default([]),
  rolls: z.number().int().positive().default(1),
  entries: z.array(LootEntry).min(1),
});
export type LootTableDef = z.infer<typeof LootTableDef>;

export const EconomyDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  /** The smallest unit prices are written in (ItemDef.price). */
  baseUnit: z.string().min(1),
  denominations: z.array(z.object({ name: z.string().min(1), value: z.number().int().positive() })).min(1),
  /** Price multipliers by tag (food, weapon, lodging…), applied by shops. */
  priceByTag: z.record(z.string(), z.number().positive()).default({}),
  /** Regional price multipliers by culture, terrain or named region tag. */
  regionalModifiers: z.record(z.string(), z.number().positive()).default({}),
  wealthLevels: z
    .array(
      z.object({
        level: z.number().int().min(1).max(5),
        name: z.string().min(1),
        minCoins: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  /** Weekly shop drift and seasonal multipliers (Simulation money). */
  seasonalDrift: z.record(z.string(), z.number().positive()).default({}),
});
export type EconomyDef = z.infer<typeof EconomyDef>;

export const CalendarDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  daysPerMonth: z.number().int().positive(),
  monthNames: z.array(z.string().min(1)).min(1),
  seasons: z.array(z.string()).default([]),
  festivals: z
    .array(
      z.object({ month: z.number().int().min(1), day: z.number().int().min(1), name: z.string().min(1) }),
    )
    .default([]),
  dawn: z.number().int().min(0).max(23).default(6),
  dusk: z.number().int().min(0).max(23).default(19),
});
export type CalendarDef = z.infer<typeof CalendarDef>;

export const NamingDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  cultures: z
    .array(
      z.object({
        id: LocalId,
        name: z.string().min(1),
        given: z.array(z.string().min(1)).min(1),
        family: z.array(z.string().min(1)).default([]),
        style: z.string().default(""),
      }),
    )
    .min(1),
});
export type NamingDef = z.infer<typeof NamingDef>;

export const RecipeDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  description: z.string().default(""),
  inputs: z.array(z.object({ item: ContentRef, qty: z.number().int().positive().default(1) })).min(1),
  tools: z.array(ContentRef).default([]),
  skill: ContentRef,
  difficulty: Difficulty.default("normal"),
  minutes: z.number().int().positive(),
  output: z.object({ item: ContentRef, qty: z.number().int().positive().default(1) }),
  complex: z.boolean().default(false),
});
export type RecipeDef = z.infer<typeof RecipeDef>;

export const DiseaseDef = z.object({
  id: LocalId,
  name: z.string().min(1),
  description: z.string().min(1),
  vector: z.string().min(1),
  onsetHours: z.number().int().positive(),
  stages: z
    .array(
      z.object({
        name: z.string().min(1),
        endCheck: Difficulty.default("normal"),
        penalty: z.number().int().nonnegative().default(0),
        condition: ContentRef.optional(),
      }),
    )
    .min(1),
  symptoms: z.array(z.string()).default([]),
  contagion: z.number().min(0).max(1).default(0),
  cure: z.string().default(""),
});
export type DiseaseDef = z.infer<typeof DiseaseDef>;

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
  /** Class data (spec 04). Empty unless the pack supports class progression. */
  classes: Record<string, ClassDef & { id: string }>;
  pregens: Record<string, PregenDef & { id: string }>;
  creatures: Record<string, CreatureDef & { id: string }>;
  /** Spells for the spellcasting plugin. */
  spells: Record<string, SpellDef & { id: string }>;
  lootTables: Record<string, LootTableDef & { id: string }>;
  recipes: Record<string, RecipeDef & { id: string }>;
  diseases: Record<string, DiseaseDef & { id: string }>;
  /** Singleton pack data; null when the pack doesn't define it. */
  economy: (EconomyDef & { id: string }) | null;
  calendar: (CalendarDef & { id: string }) | null;
  naming: (NamingDef & { id: string }) | null;
  /** Validated plugin configs, by plugin ID. */
  pluginConfigs: Record<string, unknown>;
  items: {
    weapons: Record<string, WeaponDef & { id: string }>;
    armor: Record<string, ArmorDef & { id: string }>;
    gear: Record<string, GearDef & { id: string }>;
  };
  hash: string;
};

/** Every item a pack defines, by namespaced ID, in the three categories the rules distinguish. */
export type ItemCatalog = CompiledPack["items"];

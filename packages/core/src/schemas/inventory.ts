import { z } from "zod";
import { ActorId, ContentId, Degree, Difficulty } from "./common.ts";

/**
 * Inventory, money and item subsystems (spec 11). Items are stacks with a weight, a location, a
 * condition and (for ammunition) a count. Coins, shops and prices live in the economy state.
 * The engine in `packages/engine/src/inventory.ts` and `economy.ts` owns every rule; this module is
 * the shared vocabulary for state, events, pack data and the browser.
 */

/** A reference to pack content (`local`, `pack:id` or `pack:id/field`). Pack schemas resolve these. */
const Ref = z
  .string()
  .regex(
    /^([a-z0-9][a-z0-9-]*:)?[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/,
    "expected [packId:]localId[/field]",
  );

export const ItemCondition = z.enum(["pristine", "worn", "damaged", "broken"]);
export type ItemCondition = z.infer<typeof ItemCondition>;

/** Crafting quality (spec 11, Crafting): crude, standard, fine, masterwork. */
export const ItemQuality = z.enum(["crude", "standard", "fine", "masterwork"]);
export type ItemQuality = z.infer<typeof ItemQuality>;

/**
 * Worn slots (spec 11): head, body, hands, feet, back, neck, two rings, and a belt with four
 * quick-access slots. Belt slots are the ones a combatant can draw from for 1 AP.
 */
export const WORN_SLOTS = [
  "head",
  "body",
  "hands",
  "feet",
  "back",
  "belt1",
  "belt2",
  "belt3",
  "belt4",
  "neck",
  "ring1",
  "ring2",
] as const;
export const WornSlot = z.enum(WORN_SLOTS);
export type WornSlot = z.infer<typeof WornSlot>;
export const BELT_SLOTS: readonly WornSlot[] = ["belt1", "belt2", "belt3", "belt4"];
export const isBeltSlot = (slot: WornSlot): boolean => BELT_SLOTS.includes(slot);
export const isRingSlot = (slot: WornSlot): boolean => slot === "ring1" || slot === "ring2";

/** A hand that can hold something. */
export const HeldHand = z.enum(["main", "off"]);
export type HeldHand = z.infer<typeof HeldHand>;

/**
 * Where a stack is. `container` points at another stack in the same actor's inventory; containers
 * nest one level only (a pack inside a pack is refused by the engine).
 */
export const ItemLocation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("worn"), slot: WornSlot }),
  z.object({ kind: z.literal("held"), hand: HeldHand }),
  z.object({ kind: z.literal("container"), containerId: z.string().min(1) }),
  z.object({ kind: z.literal("carried") }),
]);
export type ItemLocation = z.infer<typeof ItemLocation>;

/** One stack of identical items. Stack IDs are unique within an actor's inventory. */
export const ItemStack = z.object({
  id: z.string().min(1),
  itemId: ContentId,
  qty: z.number().int().positive().default(1),
  location: ItemLocation.default({ kind: "carried" }),
  condition: ItemCondition.default("pristine"),
  quality: ItemQuality.default("standard"),
  /** Containers only: copied from the pack/economy data when the stack is created. */
  capacityKg: z.number().nonnegative().optional(),
  /** Ammunition only: the kind from the economy config (`arrow`, `bolt`, `bullet`). */
  ammoKind: z.string().optional(),
});
export type ItemStack = z.infer<typeof ItemStack>;

/** One actor's inventory. `spentAmmo` is per item ID, so recovery can roll for what was shot. */
export const ActorInventory = z.object({
  actorId: ActorId,
  stacks: z.array(ItemStack).default([]),
  spentAmmo: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type ActorInventory = z.infer<typeof ActorInventory>;

export const InventoryState = z.object({
  actors: z.record(ActorId, ActorInventory).default({}),
});
export type InventoryState = z.infer<typeof InventoryState>;

// ── Economy ───────────────────────────────────────────────────────────────────

/** Wealth levels (spec 11, Story mode): 1 Destitute … 5 Rich. Names come from `economy.yaml`. */
export const WealthLevel = z.number().int().min(1).max(5);
export type WealthLevel = z.infer<typeof WealthLevel>;

export const Wallet = z.object({
  coins: z.number().int().nonnegative().default(0),
  wealthLevel: WealthLevel.default(3),
});
export type Wallet = z.infer<typeof Wallet>;

export const ShopStockEntry = z.object({
  itemId: ContentId,
  qty: z.number().int().nonnegative(),
  /** Optional override; otherwise the item's pack price applies. */
  price: z.number().int().nonnegative().optional(),
});
export type ShopStockEntry = z.infer<typeof ShopStockEntry>;

export const SettlementSize = z.enum(["hamlet", "village", "town", "city"]);
export type SettlementSize = z.infer<typeof SettlementSize>;

/** A haggled price, kept for the rest of the day (game minutes). */
export const ShopBargain = z.object({
  actorId: ActorId,
  /** Multiplier the PC pays: 0.9 for success, 0.8 for critSuccess. */
  modifier: z.number().positive(),
  at: z.number().int().nonnegative(),
});
export type ShopBargain = z.infer<typeof ShopBargain>;

/** A shop's live state. Stock refreshes weekly from its pack template (spec 11, Money). */
export const ShopState = z.object({
  id: z.string().min(1),
  /** The canon entity for this shop (kind `site`), when one was created. */
  entityId: z.string().optional(),
  locationId: z.string().optional(),
  templateId: z.string(),
  name: z.string().min(1),
  kind: z.string().default("general"),
  settlement: SettlementSize.default("village"),
  merchant: z.object({ id: z.string(), name: z.string(), insight: z.number().int().min(1).max(99) }),
  /** Merchant attitude toward the PC, −100…100; selling rates and haggling use it. */
  attitude: z.number().int().min(-100).max(100).default(0),
  /** Template markup over the pack price. */
  markup: z.number().positive().default(1),
  /** Price drift (Simulation mode): a multiplier over the template markup. */
  priceModifier: z.number().positive().default(1),
  stock: z.array(ShopStockEntry).default([]),
  lastRefresh: z.number().int().nonnegative().default(0),
  bargain: ShopBargain.nullable().default(null),
});
export type ShopState = z.infer<typeof ShopState>;

export const EconomyState = z.object({
  wallets: z.record(ActorId, Wallet).default({}),
  shops: z.record(z.string(), ShopState).default({}),
});
export type EconomyState = z.infer<typeof EconomyState>;

// ── Pack economy data (`economy.yaml`) ────────────────────────────────────────

export const DenominationDef = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  /** Value in the base unit. */
  value: z.number().int().positive(),
});
export type DenominationDef = z.infer<typeof DenominationDef>;

export const CurrencyDef = z.object({
  name: z.string().min(1),
  symbol: z.string().default(""),
  base: z.string().min(1),
  denominations: z.array(DenominationDef).min(1),
});
export type CurrencyDef = z.infer<typeof CurrencyDef>;

export const ShopTemplate = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  kind: z.string().default("general"),
  settlement: SettlementSize.default("village"),
  /** Stock quantities scale by settlement size; see `settlementFactor`. */
  markup: z.number().positive().default(1),
  merchant: z
    .object({
      name: z.string().min(1),
      insight: z.number().int().min(1).max(99).default(30),
    })
    .optional(),
  stock: z.array(z.object({ item: Ref, qty: z.number().int().positive().default(1) })).default([]),
});
export type ShopTemplate = z.infer<typeof ShopTemplate>;

export const AmmoKindDef = z.object({
  /** Items that are this kind of ammunition. */
  items: z.array(Ref).default([]),
  /** Weapons that consume it. */
  weapons: z.array(Ref).default([]),
  /** Fraction of spent rounds recoverable with a Search action (arrows and bolts 0.5; bullets 0). */
  recover: z.number().min(0).max(1).default(0.5),
});
export type AmmoKindDef = z.infer<typeof AmmoKindDef>;

export const WealthLevelDef = z.object({
  level: WealthLevel,
  name: z.string().min(1),
  /** Purchases up to this price (in base units) are within the level. */
  maxPrice: z.number().int().nonnegative(),
});
export type WealthLevelDef = z.infer<typeof WealthLevelDef>;

export const EconomyDef = z.object({
  currency: CurrencyDef,
  selling: z.object({
    min: z.number().min(0).max(1).default(0.4),
    max: z.number().min(0).max(1).default(0.6),
  }),
  haggling: z
    .object({
      success: z.number().min(0).max(1).default(0.1),
      critSuccess: z.number().min(0).max(1).default(0.2),
      critFailureAttitude: z.number().int().default(-10),
    })
    .prefault({}),
  wealth: z.array(WealthLevelDef).default([]),
  shops: z.array(ShopTemplate).default([]),
  /** Item local ID → capacity in kg (a backpack, a chest). */
  containers: z.record(z.string(), z.number().nonnegative()).default({}),
  ammo: z.record(z.string(), AmmoKindDef).default({}),
  priceDrift: z
    .object({
      weekly: z.number().min(0).max(0.5).default(0.05),
      min: z.number().positive().default(0.75),
      max: z.number().positive().default(1.5),
    })
    .prefault({}),
});
export type EconomyDef = z.infer<typeof EconomyDef>;

/** A small, currency-agnostic economy so engine tests and packs without economy.yaml work. */
export function defaultEconomy(): EconomyDef {
  return EconomyDef.parse({
    currency: {
      name: "coin",
      symbol: "c",
      base: "copper",
      denominations: [
        { id: "copper", name: "Copper", value: 1 },
        { id: "silver", name: "Silver", value: 10 },
        { id: "gold", name: "Gold", value: 100 },
      ],
    },
    wealth: [
      { level: 1, name: "Destitute", maxPrice: 2 },
      { level: 2, name: "Poor", maxPrice: 10 },
      { level: 3, name: "Comfortable", maxPrice: 50 },
      { level: 4, name: "Wealthy", maxPrice: 250 },
      { level: 5, name: "Rich", maxPrice: 100000 },
    ],
  });
}

/** How much stock a settlement supports; a city carries more of everything. */
export const SETTLEMENT_FACTOR: Record<SettlementSize, number> = {
  hamlet: 1,
  village: 2,
  town: 3,
  city: 4,
};

// ── Crafting (`recipes.yaml`) ─────────────────────────────────────────────────

export const RecipeInput = z.object({ item: Ref, qty: z.number().int().positive().default(1) });
export type RecipeInput = z.infer<typeof RecipeInput>;

/**
 * A crafting recipe (spec 11, Crafting). Deliberately simple: the living-world workstream adds
 * recipes to the same file, so only inputs, tools, skill, difficulty, time and one output are here.
 */
export const RecipeDef = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  description: z.string().default(""),
  inputs: z.array(RecipeInput).min(1),
  tools: z.array(Ref).default([]),
  skill: Ref,
  difficulty: Difficulty.default("normal"),
  minutes: z.number().int().positive().default(60),
  output: z.object({ item: Ref, qty: z.number().int().positive().default(1) }),
  /** Complex items produce nothing on a failure; simple ones produce a crude version. */
  complex: z.boolean().default(false),
  /** A talent that upgrades a critSuccess from fine to masterwork. */
  masterworkTalent: Ref.optional(),
  tags: z.array(z.string()).default([]),
});
export type RecipeDef = z.infer<typeof RecipeDef>;

// ── Views (spec 13 Inventory) ────────────────────────────────────────────────

export const EncumbranceBand = z.enum(["none", "burdened", "heavilyBurdened", "overloaded"]);
export type EncumbranceBand = z.infer<typeof EncumbranceBand>;

export const InventoryItemView = z.object({
  stackId: z.string(),
  itemId: z.string(),
  name: z.string(),
  description: z.string().default(""),
  qty: z.number().int().positive(),
  unitWeightKg: z.number().nonnegative(),
  weightKg: z.number().nonnegative(),
  condition: ItemCondition,
  quality: ItemQuality,
  price: z.number().int().nonnegative(),
  isWeapon: z.boolean().default(false),
  isArmour: z.boolean().default(false),
  isContainer: z.boolean().default(false),
  capacityKg: z.number().nonnegative().optional(),
  contentsWeightKg: z.number().nonnegative().optional(),
  ammoKind: z.string().optional(),
  location: z.object({ kind: z.string(), label: z.string() }),
});
export type InventoryItemView = z.infer<typeof InventoryItemView>;

export const ShopView = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  settlement: SettlementSize,
  attitude: z.number().int(),
  markup: z.number(),
  priceModifier: z.number(),
  bargain: z.number().nullable().default(null),
  stock: z.array(
    z.object({
      itemId: z.string(),
      name: z.string(),
      qty: z.number().int().nonnegative(),
      price: z.number().int().nonnegative(),
      weightKg: z.number().nonnegative(),
    }),
  ),
});
export type ShopView = z.infer<typeof ShopView>;

export const RecipeView = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  skill: z.string(),
  difficulty: Difficulty,
  minutes: z.number().int(),
  inputs: z.array(z.object({ itemId: z.string(), name: z.string(), qty: z.number().int() })),
  tools: z.array(z.object({ itemId: z.string(), name: z.string() })),
  output: z.object({ itemId: z.string(), name: z.string(), qty: z.number().int() }),
  canCraft: z.boolean(),
  missing: z.array(z.string()),
});
export type RecipeView = z.infer<typeof RecipeView>;

export const InventoryView = z.object({
  actorId: z.string(),
  name: z.string(),
  /** Abstract mode tracks notable items without weight (spec 11). */
  abstract: z.boolean().default(false),
  coins: z.number().int(),
  wealthLevel: WealthLevel,
  wealthName: z.string(),
  capacityKg: z.number(),
  weightKg: z.number(),
  band: EncumbranceBand,
  bandLabel: z.string(),
  effects: z.object({
    agiPenalty: z.number().int(),
    travelFactor: z.number(),
    firstMoveAp: z.number().int(),
    maxMovesPerTurn: z.number().int().nullable(),
  }),
  held: z.object({ main: InventoryItemView.nullable(), off: InventoryItemView.nullable() }),
  worn: z.record(z.string(), InventoryItemView.nullable()),
  containers: z.array(
    z.object({
      stackId: z.string(),
      name: z.string(),
      capacityKg: z.number(),
      weightKg: z.number(),
      contents: z.array(InventoryItemView),
    }),
  ),
  carried: z.array(InventoryItemView),
  ammo: z.array(
    z.object({ kind: z.string(), itemId: z.string(), name: z.string(), count: z.number().int() }),
  ),
  shops: z.array(ShopView),
  shopTemplates: z.array(
    z.object({ id: z.string(), name: z.string(), kind: z.string(), settlement: SettlementSize }),
  ),
  recipes: z.array(RecipeView),
  companions: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type InventoryView = z.infer<typeof InventoryView>;

// ── Action inputs ────────────────────────────────────────────────────────────

export const EquipInput = z
  .object({
    stackId: z.string().min(1).max(200),
    slot: WornSlot.optional(),
    hand: HeldHand.optional(),
  })
  .strict();
export type EquipInput = z.infer<typeof EquipInput>;

export const StowInput = z
  .object({ stackId: z.string().min(1).max(200), containerId: z.string().min(1).max(200).nullable() })
  .strict();
export type StowInput = z.infer<typeof StowInput>;

export const GiveInput = z
  .object({
    stackId: z.string().min(1).max(200),
    toId: z.string().min(1).max(200),
    qty: z.number().int().positive().max(9999).default(1),
  })
  .strict();
export type GiveInput = z.infer<typeof GiveInput>;

export const BuyInput = z
  .object({
    itemId: z.string().min(1).max(200),
    qty: z.number().int().positive().max(999).default(1),
    /** Wealth levels (Story): why a purchase above your station is allowed. */
    reason: z.string().trim().max(300).optional(),
  })
  .strict();
export type BuyInput = z.infer<typeof BuyInput>;

export const SellInput = z
  .object({ stackId: z.string().min(1).max(200), qty: z.number().int().positive().max(9999).default(1) })
  .strict();
export type SellInput = z.infer<typeof SellInput>;

export const OpenShopInput = z.object({ templateId: z.string().min(1).max(200) }).strict();
export type OpenShopInput = z.infer<typeof OpenShopInput>;

export const CraftInput = z.object({ recipeId: z.string().min(1).max(200) }).strict();
export type CraftInput = z.infer<typeof CraftInput>;

export const HaggleResult = z.object({
  degree: Degree,
  modifier: z.number(),
  attitudeDelta: z.number().int(),
  text: z.string(),
});
export type HaggleResult = z.infer<typeof HaggleResult>;

export const CraftResult = z.object({
  degree: Degree,
  quality: ItemQuality.nullable(),
  outputName: z.string().nullable(),
  lostMaterials: z.boolean(),
  text: z.string(),
});
export type CraftResult = z.infer<typeof CraftResult>;

export const InventoryResponse = z.object({
  view: InventoryView,
  /** Set by the action that produced this response. */
  haggle: HaggleResult.nullable().default(null),
  craft: CraftResult.nullable().default(null),
});
export type InventoryResponse = z.infer<typeof InventoryResponse>;

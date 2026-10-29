import {
  type ActorId,
  type ActorInventory,
  type ArmorDef,
  type CharacterSheet,
  draft,
  type EventDraft,
  type GearDef,
  type ItemCatalog,
  type ItemCondition,
  localIdOf,
  type Tuning,
  type WeaponDef,
} from "@wyrd/core";
import { catalogWith } from "./catalog.ts";
import type { GameState } from "./state.ts";

/**
 * Inventory and encumbrance (spec 11). The detailed stacks live in `state.inventory`; the sheet's
 * equipment stays the combat-facing projection. Functions here return events, so every change is
 * replayable. Weight uses the pack's item data through `ctx.items`.
 */

export type InventoryContext = { items: ItemCatalog; tuning: Tuning };

export type Encumbrance = "none" | "burdened" | "heavilyBurdened" | "overloaded";

export const inventoryOf = (state: GameState, actorId: ActorId): ActorInventory =>
  state.inventory?.actors[actorId] ?? { actorId, stacks: [], spentAmmo: {} };

export const capacityKg = (sheet: CharacterSheet, tuning: Tuning): number =>
  sheet.attributes.str * tuning.derived.carryKgPerStr;

const itemOf = (items: ItemCatalog, id: string): WeaponDef | ArmorDef | GearDef | undefined =>
  items.weapons[id] ?? items.armor[id] ?? items.gear[id];

/** Total carried weight in kg. Abstract mode tracks notable items only, so it weighs nothing. */
export function carriedKg(state: GameState, actorId: ActorId, ctx: InventoryContext): number {
  if (state.campaign.settings.subsystems.inventory === "abstract") return 0;
  return inventoryOf(state, actorId).stacks.reduce((sum, stack) => {
    const item = itemOf(catalogWith(state, ctx.items), stack.itemId);
    return sum + (item?.weightKg ?? 0) * stack.qty;
  }, 0);
}

export function encumbranceBand(state: GameState, actorId: ActorId, ctx: InventoryContext): Encumbrance {
  if (state.campaign.settings.subsystems.inventory === "abstract") return "none";
  const sheet = state.actors[actorId]?.sheet;
  if (!sheet) return "none";
  const cap = capacityKg(sheet, ctx.tuning);
  if (cap <= 0) return "overloaded";
  const load = carriedKg(state, actorId, ctx) / cap;
  const b = ctx.tuning.inventory.bands;
  if (load > b.heavily) return "overloaded";
  if (load > b.burdened) return "heavilyBurdened";
  if (load > 1) return "burdened";
  return "none";
}

/** The AGI penalty and travel factor this load imposes (spec 11). */
export function encumbranceEffect(
  band: Encumbrance,
  tuning: Tuning,
): { agi: number; travel: number; firstMoveAp: number; moves: number } {
  const e = tuning.inventory;
  switch (band) {
    case "burdened":
      return { agi: e.agiPenalty.burdened, travel: e.travelFactor.burdened, firstMoveAp: 0, moves: 99 };
    case "heavilyBurdened":
      return {
        agi: e.agiPenalty.heavilyBurdened,
        travel: e.travelFactor.heavilyBurdened,
        firstMoveAp: e.heavilyFirstMoveAp,
        moves: 99,
      };
    case "overloaded":
      return {
        agi: e.agiPenalty.overloaded,
        travel: e.travelFactor.overloaded,
        firstMoveAp: e.heavilyFirstMoveAp,
        moves: e.overloadedMoves,
      };
    default:
      return { agi: 0, travel: 1, firstMoveAp: 0, moves: 99 };
  }
}

export function addItem(
  actorId: ActorId,
  itemId: string,
  qty: number,
  location: {
    kind: "held" | "worn" | "container" | "carried";
    slot?: string;
    hand?: "main" | "off";
    containerId?: string;
  },
  reason: string,
): EventDraft[] {
  return [
    draft(
      "ItemTransferred",
      {
        actorId,
        itemId,
        qty,
        location: {
          kind: location.kind,
          ...(location.slot ? { slot: location.slot } : {}),
          ...(location.hand ? { hand: location.hand } : {}),
          ...(location.containerId ? { containerId: location.containerId } : {}),
        },
        reason,
      },
      "engine",
    ),
  ];
}

export function removeItem(actorId: ActorId, itemId: string, qty: number, reason: string): EventDraft[] {
  return [draft("ItemTransferred", { actorId, itemId, qty, reason }, "engine")];
}

const CONDITION_ORDER: ItemCondition[] = ["pristine", "worn", "damaged", "broken"];

/** Degrade an item one step (weapon on a critFailure or heavy parry; armour on a big hit). */
export function degradeItem(
  state: GameState,
  actorId: ActorId,
  itemId: string,
  reason: string,
): EventDraft[] {
  const stack = inventoryOf(state, actorId).stacks.find((s) => s.itemId === itemId);
  if (!stack) return [];
  const next =
    CONDITION_ORDER[Math.min(CONDITION_ORDER.length - 1, CONDITION_ORDER.indexOf(stack.condition) + 1)]!;
  if (next === stack.condition) return [];
  return [draft("ItemConditionChanged", { actorId, itemId, condition: next, reason }, "engine")];
}

/** Spend ammunition one round at a time; the thrown-away count feeds recovery after a fight. */
export function spendAmmo(
  state: GameState,
  actorId: ActorId,
  ammoItemId: string,
  qty = 1,
  reason = "shot",
): EventDraft[] {
  const have = inventoryOf(state, actorId)
    .stacks.filter((s) => s.itemId === ammoItemId)
    .reduce((sum, s) => sum + s.qty, 0);
  const spent = Math.min(have, Math.max(0, qty));
  if (spent <= 0) return [];
  return [draft("ItemTransferred", { actorId, itemId: ammoItemId, qty: spent, reason }, "engine")];
}

const AMMO_LOCAL = /arrow|bolt|bullet/;

/** Recover spent arrows and bolts after a fight (spec 11: 50%, bullets cannot be recovered). */
export function recoverAmmo(
  state: GameState,
  actorId: ActorId,
  ctx: InventoryContext,
  reason = "search for spent ammunition",
): EventDraft[] {
  if (!state.campaign.settings.subsystems.ammo) return [];
  const inventory = inventoryOf(state, actorId);
  const events: EventDraft[] = [];
  for (const [itemId, spent] of Object.entries(inventory.spentAmmo)) {
    if (spent <= 0) continue;
    const item = itemOf(ctx.items, itemId);
    const isAmmo = item ? AMMO_LOCAL.test(localIdOf(item.id)) : AMMO_LOCAL.test(localIdOf(itemId));
    if (!isAmmo) continue;
    if (/bullet/.test(localIdOf(itemId))) continue;
    // Half of what was shot, rounded up: deterministic, so replay is exact.
    const recovered = Math.ceil(spent / 2);
    if (recovered > 0)
      events.push(
        draft(
          "ItemTransferred",
          { actorId, itemId, qty: recovered, location: { kind: "carried" }, reason },
          "engine",
        ),
      );
  }
  return events;
}

/** Equip a carried item into a worn slot or a hand, returning the transfer event. */
export function equipItem(
  actorId: ActorId,
  itemId: string,
  slot: { kind: "worn"; slot: string } | { kind: "held"; hand: "main" | "off" },
): EventDraft[] {
  return [
    draft(
      "ItemTransferred",
      { actorId, itemId, qty: 1, location: slot, reason: `equip ${localIdOf(itemId)}` },
      "engine",
    ),
  ];
}

/** In combat, drawing from a belt slot costs AP; a pack takes longer (spec 11). */
export function drawAp(location: "held" | "worn" | "belt" | "pack", tuning: Tuning): number {
  return tuning.inventory.drawAp[location];
}

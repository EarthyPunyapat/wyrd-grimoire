import type { GearDef, ItemCatalog } from "@wyrd/core";
import type { GameState } from "./state.ts";

/**
 * The pack's item catalog plus the campaign's GM-invented gear (D149). Every inventory, shop and
 * prompt read goes through this so a `campaign:` item defined mid-turn is immediately real.
 */
export function catalogWith(state: GameState, items: ItemCatalog): ItemCatalog {
  const custom = state.customItems ?? {};
  if (Object.keys(custom).length === 0) return items;
  return { ...items, gear: { ...items.gear, ...(custom as Record<string, GearDef>) } };
}

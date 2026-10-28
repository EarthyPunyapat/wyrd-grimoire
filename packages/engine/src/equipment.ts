import type { Equipment, ItemCatalog, KitEntry } from "@wyrd/core";
import type { Result, RuleError } from "./result.ts";

const isWeapon = (items: ItemCatalog, id: string) => Object.hasOwn(items.weapons, id);
const isArmour = (items: ItemCatalog, id: string) => Object.hasOwn(items.armor, id);
const isKnown = (items: ItemCatalog, id: string) =>
  isWeapon(items, id) || isArmour(items, id) || Object.hasOwn(items.gear, id);

/**
 * The equipment an archetype's kit starts with: every kit entry is carried, the first weapon in
 * the kit is held in the main hand, and all armour in the kit is worn.
 */
export function startingEquipment(kit: KitEntry[], items: ItemCatalog): Equipment {
  const firstWeapon = kit.find((k) => isWeapon(items, k.item));
  return {
    held: { main: firstWeapon?.item ?? null, off: null },
    worn: kit.filter((k) => isArmour(items, k.item)).map((k) => k.item),
    carried: kit.map((k) => ({ item: k.item, qty: k.qty })),
  };
}

type Slot = { id: string; path: string };

/**
 * Checks an equipment state against the catalog and the hand and wear rules. Held and worn items
 * must be carried, a two-handed main weapon leaves the off hand empty, and only armour is worn.
 */
export function validateEquipment(eq: Equipment, items: ItemCatalog): Result<Equipment> {
  const errors: RuleError[] = [];
  const err = (code: string, message: string, path: string) => errors.push({ code, message, path });

  const held: Slot[] = [
    ...(eq.held.main ? [{ id: eq.held.main, path: "held.main" }] : []),
    ...(eq.held.off ? [{ id: eq.held.off, path: "held.off" }] : []),
  ];
  const worn: Slot[] = eq.worn.map((id, i) => ({ id, path: `worn.${i}` }));
  const carried: Slot[] = eq.carried.map((c, i) => ({ id: c.item, path: `carried.${i}.item` }));

  // Each unknown id is reported once, at its first place in the state.
  const reportedUnknown = new Set<string>();
  for (const { id, path } of [...held, ...worn, ...carried]) {
    if (isKnown(items, id) || reportedUnknown.has(id)) continue;
    reportedUnknown.add(id);
    err("ITEM_UNKNOWN", `Unknown item ${id}`, path);
  }

  for (const { id, path } of worn) {
    if (isKnown(items, id) && !isArmour(items, id))
      err("NOT_ARMOUR", `${id} is not armour and cannot be worn`, path);
  }

  const carriedIds = new Set(carried.map((s) => s.id));
  for (const { id, path } of [...held, ...worn]) {
    if (!carriedIds.has(id)) err("ITEM_NOT_CARRIED", `${id} must also be carried`, path);
  }

  const main = eq.held.main;
  if (main && eq.held.off && items.weapons[main]?.hands === 2)
    err("TWO_HANDED_OCCUPIED", `${main} needs both hands, so the off hand must be empty`, "held.off");

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: eq };
}

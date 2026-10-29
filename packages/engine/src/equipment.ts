import {
  type ActorId,
  draft,
  type Equipment,
  type EventDraft,
  type ItemCatalog,
  type KitEntry,
} from "@wyrd/core";
import { fail, type Result, type RuleError } from "./result.ts";
import type { GameState } from "./state.ts";

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

/**
 * Turns the sheet's starting equipment into inventory events. The same carried entry may also be
 * held or worn; one event carries it to the right slot so quantities are not counted twice.
 */
export function startingKitEvents(
  actorId: ActorId,
  equipment: Equipment,
  reason = "starting kit",
): EventDraft[] {
  return equipment.carried.map(({ item, qty }) => {
    const hand: "main" | "off" | null =
      equipment.held.main === item ? "main" : equipment.held.off === item ? "off" : null;
    const location = hand
      ? { kind: "held" as const, hand }
      : equipment.worn.includes(item)
        ? { kind: "worn" as const, slot: "body" }
        : { kind: "carried" as const };
    return draft("ItemTransferred", { actorId, itemId: item, qty, location, reason }, "engine");
  });
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

export type EquipTarget = "main" | "off" | "worn" | "carried";

/**
 * Moves a carried item between the bag, a hand and the worn list (U4 inventory). The sheet's
 * equipment is the combat-facing truth; the item stacks keep their carried quantity. One
 * `EquipmentChanged` records the whole change, and `validateEquipment` enforces the hand and
 * wear rules before anything is committed.
 */
export function moveEquipment(
  state: GameState,
  actorId: ActorId,
  itemId: string,
  to: EquipTarget,
  items: ItemCatalog,
): Result<EventDraft[]> {
  const sheet = state.actors[actorId]?.sheet;
  if (!sheet) return fail("ACTOR_UNKNOWN", `Unknown actor ${actorId}`, "actorId");

  // Carried is derived from the detailed stacks, so items the GM gave mid-turn are equippable.
  const stacks = state.inventory?.actors[actorId]?.stacks ?? [];
  const carried = new Map<string, number>();
  for (const stack of stacks) carried.set(stack.itemId, (carried.get(stack.itemId) ?? 0) + stack.qty);
  if (carried.size === 0) {
    for (const line of sheet.equipment.carried)
      carried.set(line.item, (carried.get(line.item) ?? 0) + line.qty);
  }
  if ((carried.get(itemId) ?? 0) <= 0) return fail("ITEM_NOT_CARRIED", `${itemId} is not carried`, "itemId");

  const equipping = to !== "carried";
  const isWeapon = Object.hasOwn(items.weapons, itemId);
  const isArmour = Object.hasOwn(items.armor, itemId);
  if (equipping && (to === "main" || to === "off") && !isWeapon)
    return fail("NOT_WEAPON", `${itemId} cannot be wielded`, "itemId");
  if (equipping && to === "worn" && !isArmour)
    return fail("NOT_ARMOUR", `${itemId} cannot be worn`, "itemId");
  if (to === "off" && items.weapons[itemId]?.hands === 2)
    return fail("TWO_HANDED_OFF", `${itemId} needs both hands`, "itemId");

  const current = sheet.equipment;
  const next: Equipment = {
    held: { ...current.held },
    worn: [...current.worn],
    carried: [...carried].map(([item, qty]) => ({ item, qty })),
  };
  if (to === "main") next.held.main = itemId;
  else if (to === "off") next.held.off = itemId;
  else if (to === "worn") {
    if (!next.worn.includes(itemId)) next.worn.push(itemId);
  } else {
    if (next.held.main === itemId) next.held.main = null;
    if (next.held.off === itemId) next.held.off = null;
    next.worn = next.worn.filter((id) => id !== itemId);
  }

  const valid = validateEquipment(next, items);
  if (!valid.ok) return valid;
  return {
    ok: true,
    value: [draft("EquipmentChanged", { actorId, equipment: valid.value }, "player")],
  };
}

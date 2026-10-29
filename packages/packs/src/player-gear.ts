import { type CompiledPack, defaultTuning, GearDef, playerGearIds } from "@wyrd/core";
import { packHash } from "./hash.ts";

export { playerGearIds } from "@wyrd/core";

/**
 * Adds the player's written gear to a compiled pack as `player:` gear definitions. The same compiled
 * pack is frozen into the campaign, so the items can be carried, shown and sold like pack gear.
 */
export function withPlayerGear(
  pack: CompiledPack,
  gear: { name: string; description: string }[],
): CompiledPack {
  if (!gear.length) return pack;
  const items = { ...pack.items, gear: { ...pack.items.gear } };
  for (const entry of playerGearIds(gear)) {
    const source = gear.find((g) => g.name.trim().toLowerCase() === entry.name.toLowerCase());
    items.gear[entry.id] = {
      ...GearDef.parse({
        id: "item",
        name: entry.name,
        description: source?.description ?? "",
        weightKg: defaultTuning.creation.playerGearWeightKg,
        price: 0,
        tags: ["player"],
      }),
      id: entry.id,
    };
  }
  const next = { ...pack, items };
  return { ...next, hash: packHash(next) };
}

import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadPack } from "../src/loader.ts";
import { playerGearIds, withPlayerGear } from "../src/player-gear.ts";

const FANTASY = join(import.meta.dir, "../../../packs/fantasy-core");
const pack = loadPack(FANTASY).pack!;

test("adds gear to the catalog", () => {
  const gear = [{ name: "Yellow lantern ring", description: "Glows with fear." }];
  const next = withPlayerGear(pack, gear);
  const item = next.items.gear["player:yellow-lantern-ring"]!;
  expect(item.name).toBe("Yellow lantern ring");
  expect(item.description).toBe("Glows with fear.");
  expect(next.hash).not.toBe(pack.hash);
});

test("dedupes gear names", () => {
  const ids = playerGearIds([{ name: "Rope" }, { name: "rope" }]);
  expect(ids).toEqual([{ id: "player:rope", name: "Rope", qty: 2 }]);
  const next = withPlayerGear(pack, [
    { name: "Rope", description: "" },
    { name: "rope", description: "" },
  ]);
  expect(Object.keys(next.items.gear).filter((id) => id === "player:rope")).toHaveLength(1);
  const item = next.items.gear["player:rope"]!;
  expect(item.name).toBe("Rope");
});

test("slugs non-latin names", () => {
  const next = withPlayerGear(pack, [{ name: "雷の指輪", description: "" }]);
  expect(next.items.gear["player:item-1"]!.name).toBe("雷の指輪");
});

test("is a no-op for no gear", () => {
  expect(withPlayerGear(pack, []).hash).toBe(pack.hash);
});

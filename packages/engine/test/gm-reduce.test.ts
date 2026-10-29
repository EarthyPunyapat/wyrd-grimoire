import { describe, expect, test } from "bun:test";
import { type GearDef, GearDef as GearDefSchema, type ItemCatalog } from "@wyrd/core";
import { catalogWith } from "../src/catalog.ts";
import { Sim } from "./sim.ts";

const ring: GearDef = GearDefSchema.parse({
  id: "yellow-lantern-ring",
  name: "Yellow lantern ring",
  description: "It glows with fear.",
  weightKg: 0.1,
  price: 0,
  tags: ["gm"],
});

const items = {
  weapons: {},
  armor: {},
  gear: {
    "test:rope": {
      id: "rope",
      name: "Rope",
      description: "",
      weightKg: 1,
      price: 2,
      tags: [],
    },
  },
} as unknown as ItemCatalog;

describe("GM events and the custom item catalog", () => {
  test("ItemDefined adds a custom item", () => {
    const s = new Sim();
    s.commit([
      {
        type: "ItemDefined",
        payload: { itemId: "campaign:yellow-lantern-ring", def: ring },
        source: "model",
      },
    ]);
    expect(s.state.customItems["campaign:yellow-lantern-ring"]?.name).toBe("Yellow lantern ring");
  });

  test("RetconApplied records a retcon and RetconUndone marks it", () => {
    const s = new Sim();
    s.commit([
      {
        type: "RetconApplied",
        payload: { retconId: "retcon:1", turnId: "turn:1", summary: "The ring is yellow.", inverse: [] },
        source: "model",
      },
    ]);
    expect(s.state.retcons).toEqual([{ retconId: "retcon:1", turnId: "turn:1", undone: false }]);
    s.commit([{ type: "RetconUndone", payload: { retconId: "retcon:1" }, source: "player" }]);
    expect(s.state.retcons[0]!.undone).toBe(true);
  });

  test("catalogWith merges custom items into gear", () => {
    const s = new Sim();
    s.commit([
      {
        type: "ItemDefined",
        payload: { itemId: "campaign:yellow-lantern-ring", def: ring },
        source: "model",
      },
    ]);
    const merged = catalogWith(s.state, items);
    expect(merged.gear["campaign:yellow-lantern-ring"]?.name).toBe("Yellow lantern ring");
    expect(merged.gear["test:rope"]?.name).toBe("Rope");
    // The original catalog is not mutated.
    expect(items.gear["campaign:yellow-lantern-ring"]).toBeUndefined();
  });
});

import { expect, test } from "bun:test";
import { StartingKitProposal, WorldProposal } from "@wyrd/core";
import { compileGeneratedWorld } from "../src/generated.ts";

const proposal = WorldProposal.parse({
  worldName: "Wayfarer Camp",
  premise: "A small camp on the edge of a quiet frontier.",
  tone: "Plain and grounded.",
  suggestedCharacterName: "Ash",
  originLabel: "Origin",
  origins: [{ name: "Frontier-born", description: "You grew up out here." }],
  backgrounds: [
    {
      name: "Scout",
      description: "You read the land.",
      attributePriority: ["awa", "agi", "end", "int", "wil", "pre", "str"],
      skills: [
        "core:perception",
        "core:survival",
        "core:stealth",
        "core:athletics",
        "core:navigation",
        "core:dodge",
      ],
    },
    {
      name: "Trader",
      description: "You know what things are worth.",
      attributePriority: ["pre", "int", "awa", "wil", "agi", "end", "str"],
      skills: [
        "core:persuasion",
        "core:insight",
        "core:streetwise",
        "core:deception",
        "core:investigation",
        "core:perception",
      ],
    },
    {
      name: "Hand",
      description: "You fix what breaks.",
      attributePriority: ["int", "str", "end", "agi", "awa", "wil", "pre"],
      skills: [
        "core:mechanics",
        "core:investigation",
        "core:athletics",
        "core:stealth",
        "core:medicine",
        "core:perception",
      ],
    },
  ],
  location: {
    name: "Wayfarer Camp",
    description: "Tents around a well.",
    opening: "Dust settles as you reach the well.",
    weather: "dry",
    zones: [
      { name: "The well", description: "A stone well ringed by carts." },
      { name: "The tents", description: "Canvas tents flap in the wind." },
    ],
    people: [
      { name: "Keeper", description: "An old scout by the well.", zone: 0, secret: null },
      { name: "Cook", description: "A cook at the tent line.", zone: 1, secret: null },
    ],
  },
});

const kit = StartingKitProposal.parse({
  currency: { name: "credits", symbol: "cr" },
  gear: [
    { id: "rope", name: "Rope", description: "Hemp rope.", weightKg: 0.5, price: 2 },
    { id: "lamp", name: "Lamp", description: "A small oil lamp.", weightKg: 0.4, price: 3 },
    { id: "knife", name: "Knife", description: "A plain knife.", weightKg: 0.3, price: 4 },
    { id: "blanket", name: "Blanket", description: "A wool blanket.", weightKg: 1, price: 2 },
  ],
  kits: [{ archetypeId: "generated:background-1", items: [{ id: "rope", qty: 1 }] }],
  shop: { name: "Camp store", kind: "general", stock: [{ id: "rope", qty: 3 }] },
});

test("merges a starting kit", () => {
  const { pack } = compileGeneratedWorld(proposal, kit);
  expect(pack.items.gear["generated:rope"]!.name).toBe("Rope");
  expect(pack.archetypes["generated:background-1"]!.kit).toContainEqual({
    item: "generated:rope",
    qty: 1,
  });
  expect(pack.economy!.shops[0]!.stock.length).toBeGreaterThan(0);
  expect(pack.economy!.currency.name).toBe("credits");
});

test("drops unknown kit references", () => {
  const broken = StartingKitProposal.parse({
    ...kit,
    kits: [
      { archetypeId: "nope", items: [{ id: "rope", qty: 1 }] },
      {
        archetypeId: "generated:background-1",
        items: [
          { id: "nope", qty: 1 },
          { id: "rope", qty: 2 },
        ],
      },
    ],
  });
  const { pack } = compileGeneratedWorld(proposal, broken);
  expect(pack.archetypes["generated:background-1"]!.kit).toEqual([{ item: "generated:rope", qty: 2 }]);
  expect(Object.keys(pack.archetypes)).toHaveLength(3);
});

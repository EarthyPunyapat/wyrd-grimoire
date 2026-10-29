import { describe, expect, test } from "bun:test";
import { type ItemCatalog, type RecipeDef, RecipeDef as RecipeSchema } from "@wyrd/core";
import { type DowntimeContext, resolveDowntime } from "../src/downtime.ts";
import { addItem, inventoryOf } from "../src/inventory.ts";
import { unwrap } from "../src/result.ts";
import { ctx as rules, Sim } from "./sim.ts";

const recipe: RecipeDef & { id: string } = {
  ...RecipeSchema.parse({
    id: "test-ration",
    name: "Test Ration",
    output: { item: "test:ration", qty: 1 },
    inputs: [{ item: "test:flour", qty: 1 }],
    skill: "core:mechanics",
    difficulty: "easy",
    minutes: 30,
  }),
  id: "test:test-ration",
};
const complexRecipe: RecipeDef & { id: string } = {
  ...RecipeSchema.parse({
    id: "test-salve",
    name: "Test Salve",
    output: { item: "test:salve", qty: 1 },
    inputs: [{ item: "test:flour", qty: 1 }],
    skill: "core:mechanics",
    difficulty: "heroic",
    minutes: 120,
    complex: true,
  }),
  id: "test:complex-salve",
};
const toolRecipe: RecipeDef & { id: string } = {
  ...RecipeSchema.parse({
    id: "test-sword",
    name: "Test Sword",
    output: { item: "test:sword", qty: 1 },
    inputs: [{ item: "test:flour", qty: 1 }],
    tools: ["tools"],
    skill: "core:mechanics",
    difficulty: "easy",
    minutes: 45,
  }),
  id: "test:tool-sword",
};
const items = {
  weapons: {},
  armor: {},
  gear: {
    "test:hammer": {
      id: "test:hammer",
      name: "Hammer",
      description: "",
      weightKg: 1,
      price: 5,
      tags: ["tools"],
    },
  },
} as unknown as ItemCatalog;
const recipes = {
  "test:test-ration": recipe,
  "test:complex-salve": complexRecipe,
  "test:tool-sword": toolRecipe,
};
const ctx: DowntimeContext = { ...rules, nameOf: (id) => id, recipes, items };

function sim(seed = 3) {
  const s = new Sim({ subsystems: { crafting: true } }, seed);
  s.addActor("pc", "pc");
  return s;
}

function give(s: Sim, itemId: string, qty = 1) {
  s.commit(addItem("pc", itemId, qty, { kind: "carried" }, "test"));
}

describe("crafting (spec 11)", () => {
  test("requires its inputs and names what is missing", () => {
    const s = sim();
    const out = resolveDowntime(s.state, "pc", { type: "craft", recipeId: "test:test-ration" }, ctx);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0]!.code).toBe("CRAFT_MISSING_INPUTS");
    expect(out.errors[0]!.message).toContain("test:flour");
    expect(s.state.inventory?.actors.pc?.stacks ?? []).toEqual([]);
  });

  test("requires its tools", () => {
    const s = sim();
    give(s, "test:flour");
    const out = resolveDowntime(s.state, "pc", { type: "craft", recipeId: "test:tool-sword" }, ctx);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0]!.code).toBe("CRAFT_MISSING_TOOLS");
    expect(out.errors[0]!.message).toContain("tools");
    // With the tool in the pack the same attempt goes through.
    give(s, "test:hammer");
    expect(resolveDowntime(s.state, "pc", { type: "craft", recipeId: "test:tool-sword" }, ctx).ok).toBe(true);
  });

  test("consumes its inputs, uses its own minutes and yields an item on success", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = sim(seed);
      give(s, "test:flour", 2);
      const out = unwrap(
        resolveDowntime(s.state, "pc", { type: "craft", recipeId: "test:test-ration" }, ctx),
      );
      if (out.result.degree !== "success" && out.result.degree !== "critSuccess") continue;
      expect(out.result.minutes).toBe(recipe.minutes);
      expect(out.events.find((e) => e.type === "TimeAdvanced")?.payload).toMatchObject({
        minutes: recipe.minutes,
      });
      s.commit(out.events);
      expect(inventoryOf(s.state, "pc").stacks.find((x) => x.itemId === "test:flour")?.qty ?? 0).toBe(1);
      expect(inventoryOf(s.state, "pc").stacks.find((x) => x.itemId === "test:ration")?.qty).toBe(1);
      return;
    }
    throw new Error("no seed crafted the ration");
  });

  test("a failed complex recipe yields nothing", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const s = sim(seed);
      give(s, "test:flour");
      const out = unwrap(
        resolveDowntime(s.state, "pc", { type: "craft", recipeId: "test:complex-salve" }, ctx),
      );
      if (out.result.degree !== "failure") continue;
      expect(out.result.rewards.itemId).toBeUndefined();
      expect(out.events.some((e) => e.type === "ItemTransferred" && e.payload.itemId === "test:salve")).toBe(
        false,
      );
      return;
    }
    throw new Error("no seed failed the complex recipe");
  });

  test("is refused when the campaign turns the subsystem off", () => {
    const s = new Sim({ subsystems: { crafting: false } }, 3);
    s.addActor("pc", "pc");
    give(s, "test:flour");
    const out = resolveDowntime(s.state, "pc", { type: "craft", recipeId: "test:test-ration" }, ctx);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0]!.code).toBe("CRAFTING_OFF");
  });
});

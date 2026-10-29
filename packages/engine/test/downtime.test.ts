import { describe, expect, test } from "bun:test";
import { draft, type RecipeDef, RecipeDef as RecipeSchema } from "@wyrd/core";
import { type DowntimeContext, resolveDowntime } from "../src/downtime.ts";
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
const ctx: DowntimeContext = { ...rules, nameOf: (id) => id, recipes: { "test:test-ration": recipe } };

function sim(seed = 3) {
  const s = new Sim({}, seed);
  s.addActor("pc", "pc");
  return s;
}

const types = (drafts: { type: string }[]) => drafts.map((d) => d.type);

describe("downtime (spec 06)", () => {
  test("work advances time, resolves and pays by degree", () => {
    const s = sim();
    const out = unwrap(resolveDowntime(s.state, "pc", { type: "work" }, ctx));
    expect(out.result.action).toBe("work");
    expect(out.result.minutes).toBe(rules.tuning.downtime.minutes.work);
    expect(types(out.events)).toContain("TimeAdvanced");
    expect(types(out.events)).toContain("DowntimeResolved");
    s.commit(out.events);
    if (out.result.degree !== "critFailure") {
      expect(types(out.events)).toContain("CoinsChanged");
      expect(s.state.economy.wallets.pc!.coins).toBe(rules.tuning.downtime.workPay[out.result.degree!]);
    }
  });

  test("research starts a clock and continues it", () => {
    const s = sim();
    const first = unwrap(resolveDowntime(s.state, "pc", { type: "research", topic: "the old well" }, ctx));
    s.commit(first.events);
    const clockId = first.result.rewards.clockId!;
    expect(s.state.clocks[clockId]!.name).toBe("the old well");
    const second = unwrap(
      resolveDowntime(s.state, "pc", { type: "research", topic: "the old well", clockId }, ctx),
    );
    s.commit(second.events);
    expect(s.state.clocks[clockId]!.filled).toBe(2);
  });

  test("recovery heals, and training with a teacher grants an improvement", () => {
    const s = sim();
    s.commit([draft("HpChanged", { actorId: "pc", hp: 1, delta: 0, cause: "damage" })]);
    const out = unwrap(resolveDowntime(s.state, "pc", { type: "recover" }, ctx));
    s.commit(out.events);
    expect(s.state.actors.pc!.sheet.status.hp).toBeGreaterThan(1);

    s.addActor("npc:teacher", "npc");
    s.commit([
      draft("SceneOpened", {
        scene: {
          id: "scene-1",
          locationId: "loc:test",
          zones: [{ id: "z:here", name: "here", tags: [], props: [] }],
          edges: [],
          positions: { pc: "z:here", "npc:teacher": "z:here" },
          light: "bright",
          weather: "",
          openedAt: 0,
        },
      }),
    ]);
    const train = unwrap(
      resolveDowntime(s.state, "pc", { type: "train", skill: "core:melee", teacherId: "npc:teacher" }, ctx),
    );
    expect(types(train.events)).toContain("SkillMarked");
    expect(train.result.rewards.improvement).toBe(true);
  });

  test("crafting consumes time and yields an item unless the attempt is a critical failure", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = sim(seed);
      const out = unwrap(
        resolveDowntime(s.state, "pc", { type: "craft", recipeId: "test:test-ration" }, ctx),
      );
      if (out.result.degree !== "critFailure") {
        expect(types(out.events)).toContain("ItemTransferred");
        expect(out.result.rewards.itemId).toBe("test:ration");
        return;
      }
    }
    throw new Error("every seed ruined the recipe");
  });
});

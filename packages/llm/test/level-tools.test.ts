import { afterEach, expect, test } from "bun:test";
import { defaultTuning } from "@wyrd/core";
import { catalogWith } from "@wyrd/engine";
import { executeTool } from "../src/gm/tools.ts";
import { makeTurnContext } from "../src/pipeline.ts";
import { gmFixture, rules } from "./gm-fixture.ts";

const fixtures: ReturnType<typeof gmFixture>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.close();
});
function setup(gmMode = false) {
  const fx = gmFixture();
  fixtures.push(fx);
  const state = fx.store.state();
  state.campaign.settings.structural.resolution = "d20";
  let n = 0;
  const run = (name: string, args: unknown) =>
    executeTool(
      { id: "c", name, args },
      {
        gmMode,
        state,
        pcId: "pc",
        turnId: "t",
        canon: fx.canon,
        ctx: makeTurnContext(state, fx.canon, rules),
        items: catalogWith(state, { weapons: {}, armor: {}, gear: {} }),
        newId: () => `level-${++n}`,
      },
    );
  return { state, run };
}

test("roll uses opposition and ability ranks and never rolls for infinite actors", async () => {
  const { state, run } = setup();
  state.actors.pc!.sheet.level = 9;
  state.actors.pc!.sheet.abilities = [
    { id: "shadow", name: "Shadow", description: "Fade into shade", level: 9, rank: 6, cost: "At will" },
  ];
  let r = await run("roll", {
    skill: "core:stealth",
    difficulty: "normal",
    goal: "hide",
    opposition: { level: 9 },
    abilityId: "shadow",
  });
  expect(r.ok).toBe(true);
  expect(r.effects.mechanics[0]!.roll?.modifier).toBe(9); // skill +6 and rank +3
  r = await run("roll", {
    skill: "core:stealth",
    difficulty: "normal",
    goal: "hide",
    opposition: { level: 7 },
  });
  expect(r.effects.mechanics[0]!.roll).toBeUndefined();
  state.actors.pc!.sheet.level = "infinite";
  r = await run("roll", { skill: "core:stealth", difficulty: "normal", goal: "hide" });
  expect(r.effects.mechanics[0]!.roll).toBeUndefined();
});

test("milestone tool proposes a card without granting the level; abilities and breakthroughs are engine validated", async () => {
  const { state, run } = setup();
  const r = await run("propose_level_up", { level: 2, reason: "First journey" });
  expect(r.ok).toBe(true);
  expect(r.effects.cards[0]?.type).toBe("levelUp");
  expect(r.effects.drafts.map((d) => d.type)).toEqual(["LevelProposed"]);
  expect(state.actors.pc!.sheet.level).toBe(1);
  expect(
    (
      await run("grant_ability", {
        ability: {
          id: "light",
          name: "Light",
          description: "A guiding flame",
          level: 1,
          rank: 1,
          cost: "At will",
        },
      })
    ).ok,
  ).toBe(true);
  expect(
    (await run("grant_ability", { ability: { id: "bad", rank: defaultTuning.levels.maxRank + 1 } })).ok,
  ).toBe(false);
  expect(
    (await run("breakthrough", { actorId: "missing", skill: "core:stealth", reason: "Train", hpCost: 0 })).ok,
  ).toBe(false);
});

test("GM mode can set a level with an Undo, and ordinary turns cannot", async () => {
  const normal = setup();
  expect((await normal.run("set_level", { level: "infinite", reason: "Player correction" })).ok).toBe(false);
  const gm = setup(true);
  const r = await gm.run("set_level", { level: "infinite", reason: "Player correction" });
  expect(r.ok).toBe(true);
  expect(r.effects.drafts.map((d) => d.type)).toEqual(["LevelGained", "RetconApplied"]);
  expect(r.effects.cards[0]?.type).toBe("retcon");
  expect(r.effects.retcon?.inverse[0]?.type).toBe("LevelGained");
});

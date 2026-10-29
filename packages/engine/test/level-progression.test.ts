import { expect, test } from "bun:test";
import { defaultTuning, draft } from "@wyrd/core";
import {
  acceptLevelUp,
  breakthrough,
  grantAbility,
  levelProposals,
  proposeLevelUp,
  rankAbility,
  xpLevelEvents,
} from "../src/levels.ts";
import { reduce } from "../src/reduce.ts";
import { unwrap } from "../src/result.ts";
import { ctx, Sim } from "./sim.ts";

const make = (seed = 1) => {
  const s = new Sim({ structural: { resolution: "d20" } }, seed);
  s.addActor("pc", "pc");
  return s;
};

test("a milestone needs explicit acceptance and cannot be accepted twice or after another gain", () => {
  const s = make();
  s.commit(unwrap(proposeLevelUp(s.state, "pc", 2, "The first journey", "p1")));
  expect(s.state.actors.pc!.sheet.level).toBe(1);
  expect(levelProposals(s.state)[0]?.status).toBe("pending");
  s.commit(unwrap(acceptLevelUp(s.state, "p1")));
  expect(s.state.actors.pc!.sheet.level).toBe(2);
  expect(acceptLevelUp(s.state, "p1").ok).toBe(false);
  expect(proposeLevelUp(s.state, "pc", 1, "No", "bad").ok).toBe(false);
  s.commit(unwrap(proposeLevelUp(s.state, "pc", 3, "Next journey", "p2")));
  s.commit([draft("XpAwarded", { amount: 100, source: "quest", reason: "test" })]);
  s.commit(xpLevelEvents(s.state, defaultTuning));
  expect(acceptLevelUp(s.state, "p2").ok).toBe(false);
  let replay: import("../src/state.ts").GameState | undefined;
  for (const e of s.events) replay = reduce(replay, e);
  expect(replay).toEqual(s.state);
});

test("XP crosses multiple configured cumulative thresholds, catches up only once, and stays open-ended", () => {
  const s = make();
  const tuning = { ...defaultTuning, levels: { ...defaultTuning.levels, xpThresholds: { 2: 5, 3: 8 } } };
  s.commit([draft("XpAwarded", { amount: 8, source: "quest", reason: "test" })]);
  s.commit(xpLevelEvents(s.state, tuning));
  expect(s.state.actors.pc!.sheet.level).toBe(3);
  expect(xpLevelEvents(s.state, tuning)).toEqual([]);
  const t = make();
  t.state.actors.pc!.sheet.level = 20;
  t.state.actors.pc!.sheet.progression.xpEarned = 5000;
  expect(
    xpLevelEvents(t.state, defaultTuning).some((e) => e.type === "LevelGained" && e.payload.level === 21),
  ).toBe(true);
});

test("breakthrough failure keeps the level; success applies its explicit cost exactly once", () => {
  let sawFailure = false;
  let sawSuccess = false;
  for (let seed = 1; seed <= 40; seed++) {
    const s = make(seed);
    const hp = s.state.actors.pc!.sheet.status.hp;
    const r = unwrap(breakthrough(s.state, "pc", "core:athletics", "Train through the barrier", 2, ctx));
    s.commit(r);
    if (s.state.actors.pc!.sheet.level === 1) {
      sawFailure = true;
      expect(s.state.actors.pc!.sheet.status.hp).toBe(hp);
    } else {
      sawSuccess = true;
      expect(s.state.actors.pc!.sheet.level).toBe(2);
      expect(s.state.actors.pc!.sheet.status.hp).toBe(hp - 2);
    }
  }
  expect(sawFailure).toBe(true);
  expect(sawSuccess).toBe(true);
  const infinite = make();
  infinite.state.actors.pc!.sheet.level = "infinite";
  expect(breakthrough(infinite.state, "pc", "core:athletics", "No", 0, ctx).ok).toBe(false);
});

test("ability grants and ranks validate actor, duplicate IDs and rank increases", () => {
  const s = make();
  const ability = {
    id: "flame",
    name: "Marshfire",
    description: "A guiding light",
    level: 1,
    cost: "Once per scene",
    rank: 1,
  };
  expect(grantAbility(s.state, "missing", ability).ok).toBe(false);
  s.commit(unwrap(grantAbility(s.state, "pc", ability)));
  expect(grantAbility(s.state, "pc", ability).ok).toBe(false);
  s.commit(unwrap(rankAbility(s.state, "pc", "flame", 10)));
  expect(s.state.actors.pc!.sheet.abilities[0]?.rank).toBe(10);
  expect(rankAbility(s.state, "pc", "flame", 11).ok).toBe(false);
  expect(rankAbility(s.state, "pc", "flame", 1).ok).toBe(false);
});

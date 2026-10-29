import { expect, test } from "bun:test";
import { Ability, CharacterSheet, defaultTuning, Level, type PreparedCheck, Rng, seedRng } from "@wyrd/core";
import { resolveCheck, resolveOpposedCheck } from "../src/checks.ts";
import { levelDelta, powerRating, resolveLevelCheck } from "../src/levels.ts";
import { unwrap } from "../src/result.ts";
import { ctx, Sim } from "./sim.ts";

const prepared: PreparedCheck = {
  label: "Will",
  skillValue: 50,
  difficulty: "normal",
  modifiers: [],
  modifierTotal: 0,
  netBoons: 0,
};
const tuning = defaultTuning;
const ability = (rank = 1) => ({
  id: "a",
  name: "Marshfire",
  description: "A pale guiding light",
  level: 1,
  cost: "Once per scene",
  rank,
});

test("levels and abilities validate 1–20+, infinity and rank bounds; old sheets default safely", () => {
  for (const value of [1, 20, 21, 100, "infinite"]) expect(Level.safeParse(value).success).toBe(true);
  for (const value of [0, -1, 1.5, "∞", Infinity]) expect(Level.safeParse(value).success).toBe(false);
  expect(Ability.parse(ability(10)).rank).toBe(10);
  expect(Ability.safeParse(ability(11)).success).toBe(false);
  expect(Ability.safeParse(ability(0)).success).toBe(false);
  const s = new Sim();
  const sheet = s.addActor("pc", "pc");
  const { level: _level, abilities: _abilities, ...old } = sheet;
  expect(CharacterSheet.parse(old).level).toBe(1);
  expect(CharacterSheet.parse(old).abilities).toEqual([]);
});

test("every delta row uses d20-native modifiers, and only equality adds the rank bonus", () => {
  for (const [delta, bonus, automatic] of [
    [0, 5, false],
    [1, 10, false],
    [-1, -10, false],
    [2, 0, true],
    [-2, 0, true],
    [8, 0, true],
    [-8, 0, true],
  ] as const) {
    const rng = new Rng(seedRng(42));
    const before = [...rng.state];
    const r = resolveLevelCheck(prepared, delta, rng, tuning, { rank: 10 });
    expect(r.rolls.length === 0).toBe(automatic);
    if (automatic) {
      expect([...rng.state]).toEqual(before);
      expect(r.degree).toBe(delta > 0 ? "success" : "failure");
    } else expect(r.display.roll?.modifier).toBe(bonus);
  }
  for (let rank = 1; rank <= 10; rank++)
    expect(
      resolveLevelCheck(prepared, 0, new Rng(seedRng(42)), tuning, { rank }).display.roll?.modifier,
    ).toBe(Math.ceil(rank / 2));
});

test("a real cited exploit permits a lower finite actor to roll at -10", () => {
  expect(resolveLevelCheck(prepared, -3, new Rng(seedRng(1)), tuning, { exploit: "  " }).rolls).toEqual([]);
  const r = resolveLevelCheck(prepared, -3, new Rng(seedRng(1)), tuning, {
    exploit: "Its exposed marshfire core",
    rank: 10,
  });
  expect(r.rolls).toHaveLength(1);
  expect(r.display.roll?.modifier).toBe(-10);
});

test("effective levels and infinity have defined outcomes without rolling", () => {
  expect(levelDelta({ level: 20, effectiveLevel: 3 }, { level: 5 })).toBe(-2);
  expect(levelDelta({ level: "infinite" }, { level: 20 })).toBe(Infinity);
  expect(levelDelta({ level: 20 }, { level: "infinite" })).toBe(-Infinity);
  for (const delta of [Infinity, -Infinity, "infinite"] as const) {
    const rng = new Rng(seedRng(1));
    const before = [...rng.state];
    const r = resolveLevelCheck(prepared, delta, rng, tuning, { exploit: "A weakness" });
    expect(r.rolls).toEqual([]);
    expect([...rng.state]).toEqual(before);
    expect(r.degree).toBe(delta === Infinity ? "success" : "failure");
  }
});

test("cosmetic power rating follows the configured formula", () => {
  for (const level of [1, 9, 20]) {
    expect(powerRating({ level, abilities: [ability(3), { ...ability(7), id: "b" }] })).toBe(
      Math.floor(2 ** (1.5 * level) * 1.5),
    );
  }
  expect(powerRating({ level: "infinite", abilities: [] })).toBe("∞");
  expect(
    powerRating(
      { level: 2, abilities: [] },
      { ...tuning, levels: { ...tuning.levels, powerRating: { base: 3, exponent: 1, rankDivisor: 10 } } },
    ),
  ).toBe(9);
});

test("actual checks resolve actor opposition, selected ability and automatic results without advancing RNG", () => {
  const s = new Sim({ structural: { resolution: "d20" } });
  s.addActor("pc", "pc", { level: 9, abilities: [ability(6)] });
  s.addActor("foe", "npc", { level: 7 });
  const input = {
    actorId: "pc",
    skill: { attribute: "wil" as const },
    difficulty: "normal" as const,
    purpose: "stand firm",
    opposition: { actorId: "foe" },
  };
  const before = s.state.campaign.rngState;
  const r = unwrap(resolveCheck(s.state, input, ctx));
  expect(r.effective.rolls).toEqual([]);
  expect(r.effective.degree).toBe("success");
  s.commit(r.events);
  expect(s.state.campaign.rngState).toEqual(before);
  expect(resolveCheck(s.state, { ...input, opposition: { actorId: "missing" } }, ctx).ok).toBe(false);
  expect(resolveCheck(s.state, { ...input, abilityId: "missing" }, ctx).ok).toBe(false);
});

test("infinite actors never roll even in legacy dice campaigns", () => {
  for (const resolution of ["d100", "d20"] as const) {
    const s = new Sim({ structural: { resolution } });
    s.addActor("pc", "pc", { level: "infinite" });
    const before = s.state.campaign.rngState;
    const result = unwrap(
      resolveCheck(
        s.state,
        { actorId: "pc", skill: "core:athletics", difficulty: "normal", purpose: "Lift the door" },
        ctx,
      ),
    );
    expect(result.effective.rolls).toEqual([]);
    s.commit(result.events);
    expect(s.state.campaign.rngState).toEqual(before);
  }
});

test("open-ended cosmic levels keep their power rating serializable beyond numeric range", () => {
  expect(powerRating({ level: 1000, abilities: [] })).toBe("10^451+");
});

test("opposed checks cannot roll either side of an infinite/finite gap", () => {
  for (const resolution of ["d100", "d20"] as const) {
    const s = new Sim({ structural: { resolution } });
    s.addActor("pc", "pc", { level: "infinite" });
    s.addActor("foe", "npc");
    const result = unwrap(
      resolveOpposedCheck(
        s.state,
        {
          actorId: "pc",
          skill: "core:athletics",
          difficulty: "normal",
          purpose: "Stand firm",
          opposedBy: { actorId: "foe", skill: "core:athletics" },
        },
        ctx,
      ),
    );
    expect(result.active.rolls).toEqual([]);
    expect(result.defender.rolls).toEqual([]);
    expect(result.winner).toBe("active");
  }
});

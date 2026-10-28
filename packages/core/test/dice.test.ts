import { describe, expect, test } from "bun:test";
import { averageDice, DiceExpr, parseDice, rollDice } from "../src/dice.ts";
import { Rng, seedRng } from "../src/rng.ts";

describe("parseDice", () => {
  test("reads count, sides and bonus", () => {
    expect(parseDice("2d6+1")).toEqual({ count: 2, sides: 6, bonus: 1 });
    expect(parseDice("1d4-3")).toEqual({ count: 1, sides: 4, bonus: -3 });
  });

  test("defaults the bonus to 0", () => {
    expect(parseDice("1d10")).toEqual({ count: 1, sides: 10, bonus: 0 });
  });

  test("accepts a one-sided die", () => {
    expect(parseDice("1d1+2")).toEqual({ count: 1, sides: 1, bonus: 2 });
  });

  test("rejects zero sides, zero dice and malformed expressions", () => {
    expect(parseDice("1d0")).toBeNull();
    expect(parseDice("0d6")).toBeNull();
    expect(parseDice("d6")).toBeNull();
    expect(parseDice("2d6+")).toBeNull();
  });
});

describe("DiceExpr", () => {
  test("accepts well-formed expressions with at least one die of at least one side", () => {
    expect(DiceExpr.safeParse("1d8").success).toBe(true);
    expect(DiceExpr.safeParse("2d6+1").success).toBe(true);
    expect(DiceExpr.safeParse("1d1+2").success).toBe(true);
  });

  test("rejects zero sides and zero dice", () => {
    expect(DiceExpr.safeParse("1d0").success).toBe(false);
    expect(DiceExpr.safeParse("0d6").success).toBe(false);
  });
});

describe("rollDice", () => {
  test("maximise rolls every die at its top face and does not advance the rng", () => {
    const rng = new Rng(seedRng(7));
    const before = rng.state;
    expect(rollDice("2d6+1", rng, { maximise: true })).toEqual({ rolls: [6, 6], total: 13 });
    expect(rng.state).toEqual(before);
  });

  test("a single die rolls one value in 1..sides and the total equals that roll", () => {
    const { rolls, total } = rollDice("1d10", new Rng(seedRng(7)));
    expect(rolls).toHaveLength(1);
    const roll = rolls[0]!;
    expect(roll).toBeGreaterThanOrEqual(1);
    expect(roll).toBeLessThanOrEqual(10);
    expect(total).toBe(roll);
  });

  test("the same seed gives the same roll", () => {
    expect(rollDice("1d10", new Rng(seedRng(7)))).toEqual(rollDice("1d10", new Rng(seedRng(7))));
  });

  test("the total is floored at 0", () => {
    expect(rollDice("1d1-3", new Rng(seedRng(7))).total).toBe(0);
  });

  test("throws on an unparseable expression", () => {
    expect(() => rollDice("d6", new Rng(seedRng(7)))).toThrow();
  });
});

describe("averageDice", () => {
  test("is the mean of the rolls plus the bonus", () => {
    expect(averageDice("1d10")).toBe(5.5);
    expect(averageDice("2d6+1")).toBe(8);
  });
});

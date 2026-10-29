import { describe, expect, test } from "bun:test";
import { type Degree, defaultTuning, type PreparedCheck, Rng, seedRng } from "@wyrd/core";
import { d20Modifier, d20Module, degreeD20 } from "../src/resolution/d20.ts";
import { d100Module, d100Target, degreeD100 } from "../src/resolution/d100.ts";
import { compareResults } from "../src/resolution/index.ts";

const isSuccess = (d: Degree) => d === "success" || d === "critSuccess";

function prepared(overrides: Partial<PreparedCheck> = {}): PreparedCheck {
  return {
    label: "Stealth",
    skillValue: 50,
    difficulty: "normal",
    modifiers: [],
    modifierTotal: 0,
    netBoons: 0,
    ...overrides,
  };
}

describe("d100 degrees", () => {
  test("table from the spec", () => {
    // T = 45: crit ≤ 9, success ≤ 45, critFailure on 96+ (T < 50) and 100.
    expect(degreeD100(45, 1)).toBe("critSuccess");
    expect(degreeD100(45, 9)).toBe("critSuccess");
    expect(degreeD100(45, 10)).toBe("success");
    expect(degreeD100(45, 45)).toBe("success");
    expect(degreeD100(45, 46)).toBe("failure");
    expect(degreeD100(45, 95)).toBe("failure");
    expect(degreeD100(45, 96)).toBe("critFailure");
    expect(degreeD100(45, 100)).toBe("critFailure");
  });

  test("high targets only critically fail on 100", () => {
    expect(degreeD100(70, 96)).toBe("failure");
    expect(degreeD100(70, 99)).toBe("failure");
    expect(degreeD100(70, 100)).toBe("critFailure");
  });

  test("01 is always a critical success", () => {
    expect(degreeD100(1, 1)).toBe("critSuccess");
    expect(degreeD100(4, 1)).toBe("critSuccess");
    expect(degreeD100(4, 2)).toBe("success");
  });

  test("target clamps to 1–99", () => {
    expect(d100Target(prepared({ skillValue: 10, difficulty: "heroic" }), defaultTuning)).toBe(1);
    expect(
      d100Target(prepared({ skillValue: 95, modifierTotal: 40, difficulty: "easy" }), defaultTuning),
    ).toBe(99);
    expect(d100Target(prepared({ skillValue: 65, difficulty: "hard" }), defaultTuning)).toBe(45);
  });
});

describe("d20 degrees", () => {
  test("table from the spec", () => {
    expect(degreeD20(21, 11, 10)).toBe("critSuccess");
    expect(degreeD20(11, 11, 10)).toBe("success");
    expect(degreeD20(10, 11, 10)).toBe("failure");
    expect(degreeD20(1, 11, 5)).toBe("critFailure");
  });

  test("natural 20 and natural 1 shift one degree", () => {
    expect(degreeD20(15, 19, 20)).toBe("success"); // failure → success
    expect(degreeD20(25, 15, 20)).toBe("critSuccess"); // already crit stays crit
    expect(degreeD20(12, 11, 1)).toBe("failure"); // success → failure
    expect(degreeD20(5, 15, 1)).toBe("critFailure"); // critFailure stays
  });

  test("modifier conversion", () => {
    expect(d20Modifier(prepared({ skillValue: 65 }))).toBe(3);
    expect(d20Modifier(prepared({ skillValue: 50, modifierTotal: -20 }))).toBe(-4);
    // Rounds half away from zero, so the conversion is symmetric around 50.
    expect(d20Modifier(prepared({ skillValue: 62 }))).toBe(2);
    expect(d20Modifier(prepared({ skillValue: 63 }))).toBe(3);
    expect(d20Modifier(prepared({ skillValue: 37 }))).toBe(-3);
  });
});

describe("d20/d100 equivalence (exact)", () => {
  for (let skill = 5; skill <= 95; skill += 5) {
    test(`skill ${skill}: same base success chance at Normal`, () => {
      const t = d100Target(prepared({ skillValue: skill }), defaultTuning);
      let d100Successes = 0;
      for (let roll = 1; roll <= 100; roll++) if (isSuccess(degreeD100(t, roll))) d100Successes++;

      const m = d20Modifier(prepared({ skillValue: skill }));
      const dc = defaultTuning.difficultyDc.normal;
      let d20Successes = 0;
      for (let nat = 1; nat <= 20; nat++) if (isSuccess(degreeD20(nat + m, dc, nat))) d20Successes++;

      expect(d100Successes / 100).toBe(skill / 100);
      expect(d20Successes / 20).toBe(skill / 100);
    });
  }
});

describe("resolve", () => {
  test("d100 renders the spec's display line", () => {
    const rng = new Rng(seedRng(1));
    const r = d100Module.resolve(prepared({ skillValue: 65, difficulty: "hard" }), rng, defaultTuning);
    const rolled = 45 - r.margin; // margin = T − roll
    expect(r.display.text).toStartWith(`Stealth 65% · Hard (−20) → 45% · rolled ${rolled} · `);
    expect(r.rolls).toHaveLength(2); // one tens die, one units die
  });

  test("d20 renders the spec's display line", () => {
    const rng = new Rng(seedRng(1));
    const r = d20Module.resolve(prepared({ skillValue: 65, difficulty: "hard" }), rng, defaultTuning);
    expect(r.display.text).toMatch(/^Stealth \+3 vs DC 15 \(Hard\) · rolled \d+ \+ 3 = \d+ · /);
  });

  test("d20 lines carry the die, sides, modifier, total and DC for the UI", () => {
    const rng = new Rng(seedRng(1));
    const r = d20Module.resolve(prepared({ skillValue: 65, difficulty: "hard" }), rng, defaultTuning);
    expect(r.display.roll).toEqual({
      die: "d20",
      sides: 20,
      natural: r.rolls[0]!,
      modifier: 3,
      total: r.rolls[0]! + 3,
      dc: 15,
    });
    expect(r.display.text).not.toContain("%");
  });

  test("d100 lines keep their text and carry the target percentage", () => {
    const rng = new Rng(seedRng(1));
    const r = d100Module.resolve(prepared({ skillValue: 65, difficulty: "hard" }), rng, defaultTuning);
    expect(r.display.roll).toEqual({
      die: "d100",
      sides: 100,
      natural: 45 - r.margin,
      target: 45,
    });
    expect(r.display.text).toContain("45%");
  });

  test("d100 boons keep the lowest tens die, banes the highest", () => {
    const n = 20_000;
    const avg = (netBoons: number) => {
      const rng = new Rng(seedRng(77));
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const r = d100Module.resolve(prepared({ netBoons }), rng, defaultTuning);
        sum += 50 - r.margin; // T = 50, so the kept roll is 50 − margin
      }
      return sum / n;
    };
    const plain = avg(0);
    expect(avg(1)).toBeLessThan(plain - 10);
    expect(avg(2)).toBeLessThan(avg(1));
    expect(avg(-1)).toBeGreaterThan(plain + 10);
  });

  test("d20 boons roll two dice and keep the higher; net 2 adds +2", () => {
    const rng = new Rng(seedRng(5));
    const r1 = d20Module.resolve(prepared({ netBoons: 1 }), rng, defaultTuning);
    expect(r1.rolls).toHaveLength(2);
    const r2 = d20Module.resolve(prepared({ netBoons: 2 }), rng, defaultTuning);
    expect(r2.margin).toBe(Math.max(...r2.rolls) + 0 + 2 - 11);
    const r3 = d20Module.resolve(prepared({ netBoons: -2 }), rng, defaultTuning);
    expect(r3.margin).toBe(Math.min(...r3.rolls) - 2 - 11);
  });

  test("critical rates under a fixed seed (d100 at T=50: 10% crit, 1% fumble)", () => {
    const rng = new Rng(seedRng(2026));
    const n = 100_000;
    let crit = 0;
    let fumble = 0;
    for (let i = 0; i < n; i++) {
      const r = d100Module.resolve(prepared(), rng, defaultTuning);
      if (r.degree === "critSuccess") crit++;
      if (r.degree === "critFailure") fumble++;
    }
    expect(Math.abs(crit / n - 0.1)).toBeLessThan(0.005);
    expect(Math.abs(fumble / n - 0.01)).toBeLessThan(0.002);
  });

  test("displaySkill", () => {
    expect(d100Module.displaySkill(65)).toBe("65%");
    expect(d20Module.displaySkill(65)).toBe("+3");
    expect(d20Module.displaySkill(40)).toBe("−2");
  });
});

describe("compareResults (opposed)", () => {
  const r = (degree: Degree, margin: number) => ({ degree, margin, rolls: [], display: { text: "" } });
  test("higher degree wins", () => {
    expect(compareResults(r("success", 1), r("failure", 30))).toBe("active");
    expect(compareResults(r("success", 30), r("critSuccess", 1))).toBe("defender");
  });
  test("equal degrees: higher margin wins", () => {
    expect(compareResults(r("success", 12), r("success", 5))).toBe("active");
  });
  test("full tie: the defender wins", () => {
    expect(compareResults(r("success", 5), r("success", 5))).toBe("defender");
  });
});

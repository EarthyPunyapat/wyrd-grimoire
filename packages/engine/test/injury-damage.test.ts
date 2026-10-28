import { describe, expect, test } from "bun:test";
import { type ArmorDef, defaultTuning } from "@wyrd/core";
import { computeDamage, locationFor, protectionAt, woundSeverity } from "../src/injury/damage.ts";
import { humanoidPlan } from "./fixtures.ts";

const t = defaultTuning.combat;

const armour = (name: string, cut: number, covers = ["torso"]): ArmorDef =>
  ({ name, covers, protection: { cut } }) as unknown as ArmorDef;

describe("locationFor", () => {
  test("maps d100 rolls to the humanoid table", () => {
    const rolls: Array<[number, string]> = [
      [1, "head"],
      [10, "head"],
      [11, "torso"],
      [50, "torso"],
      [51, "right-arm"],
      [60, "right-arm"],
      [61, "left-arm"],
      [70, "left-arm"],
      [71, "right-leg"],
      [85, "right-leg"],
      [86, "left-leg"],
      [100, "left-leg"],
    ];
    for (const [roll, id] of rolls) expect(locationFor(humanoidPlan, roll).id).toBe(id);
  });

  test("a roll outside every band is a broken plan", () => {
    expect(() => locationFor(humanoidPlan, 101)).toThrow();
  });
});

describe("protectionAt", () => {
  const padded = armour("padded", 2);
  const leather = armour("leather", 3);
  const mail = armour("mail", 6);

  test("sums the best two layers that cover the location", () => {
    expect(protectionAt([padded, leather, mail], "torso", "cut", 2)).toBe(9);
  });

  test("ignores pieces that don't cover the location", () => {
    const helmet = armour("helmet", 5, ["head"]);
    expect(protectionAt([leather, helmet], "torso", "cut", 2)).toBe(3);
    expect(protectionAt([leather, helmet], "head", "cut", 2)).toBe(5);
    expect(protectionAt([leather], "left-leg", "cut", 2)).toBe(0);
  });

  test("a damage type the armour doesn't list protects nothing", () => {
    expect(protectionAt([mail], "torso", "burn", 2)).toBe(0);
  });
});

describe("computeDamage", () => {
  test("armour minus armour piercing is subtracted", () => {
    expect(computeDamage({ raw: 9, protection: 9, armorPiercing: 2, crit: false, multiplier: 1 }, t)).toEqual(
      {
        protection: 9,
        final: 2,
      },
    );
  });

  test("a critical halves protection first (rounded down)", () => {
    expect(computeDamage({ raw: 9, protection: 9, armorPiercing: 2, crit: true, multiplier: 1 }, t)).toEqual({
      protection: 4,
      final: 7,
    });
  });

  test("the head multiplier rounds down", () => {
    expect(
      computeDamage({ raw: 12, protection: 4, armorPiercing: 2, crit: false, multiplier: 1.5 }, t).final,
    ).toBe(15);
    expect(
      computeDamage({ raw: 5, protection: 0, armorPiercing: 0, crit: false, multiplier: 1.5 }, t).final,
    ).toBe(7);
  });

  test("never goes below zero, and armour piercing can't make protection negative", () => {
    expect(
      computeDamage({ raw: 3, protection: 9, armorPiercing: 0, crit: false, multiplier: 1 }, t).final,
    ).toBe(0);
    expect(
      computeDamage({ raw: 3, protection: 1, armorPiercing: 5, crit: false, multiplier: 1 }, t).final,
    ).toBe(3);
  });
});

describe("woundSeverity", () => {
  test("is by multiples of the wound threshold", () => {
    expect(woundSeverity(6, 7, false, t)).toBeNull();
    expect(woundSeverity(7, 7, false, t)).toBe("minor");
    expect(woundSeverity(13, 7, false, t)).toBe("minor");
    expect(woundSeverity(14, 7, false, t)).toBe("serious");
    expect(woundSeverity(21, 7, false, t)).toBe("critical");
    expect(woundSeverity(40, 7, false, t)).toBe("critical");
  });

  test("no damage never wounds", () => {
    expect(woundSeverity(0, 7, false, t)).toBeNull();
    expect(woundSeverity(0, 7, true, t)).toBeNull();
  });

  test("a down actor takes any damaging hit as a wound, one severity worse, capped at critical", () => {
    expect(woundSeverity(3, 7, true, t)).toBe("minor");
    expect(woundSeverity(7, 7, true, t)).toBe("serious");
    expect(woundSeverity(14, 7, true, t)).toBe("critical");
    expect(woundSeverity(21, 7, true, t)).toBe("critical");
  });
});

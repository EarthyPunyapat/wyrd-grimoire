import { describe, expect, test } from "bun:test";
import { defaultTuning } from "../src/tuning.ts";

describe("combat tuning defaults", () => {
  test("hit points, thresholds and armour numbers match the spec", () => {
    const c = defaultTuning.combat;
    expect(c.woundThresholdMultiples).toEqual({ minor: 1, serious: 2, critical: 3 });
    expect(c.hpMaxReduction).toEqual({ minor: 2, serious: 5, critical: 10 });
    expect(c.strBonusBase).toBe(5);
    expect(c.strBonusDivisor).toBe(2);
    expect(c.maxArmourLayers).toBe(2);
    expect(c.critArmourDivisor).toBe(2);
    expect(c.cutBleedingBonus).toBe(1);
    expect(c.maxBleeding).toBe(3);
    expect(c.downCheck).toBe("normal");
    expect(c.lethalCheck).toBe("hard");
    expect(c.unarmed).toEqual({ damage: "1d3", damageType: "blunt" });
    expect(c.simpleWoundPenalty).toEqual({ minor: -10, serious: -20, critical: -30 });
  });

  test("critical head wounds are lethal and cause bleeding 2", () => {
    const head = defaultTuning.combat.woundEffects.head.critical;
    expect(head.lethalCheck).toBe(true);
    expect(head.bleeding).toBe(2);
  });

  test("critical torso wounds apply down", () => {
    expect(defaultTuning.combat.woundEffects.torso.critical.conditions).toContainEqual({
      id: "core:down",
    });
  });

  test("serious arm wounds bleed more from cuts", () => {
    expect(defaultTuning.combat.woundEffects.arm.serious.bleedingIf?.cut).toBe(2);
  });

  test("the humanoid wound-effects table matches spec 03", () => {
    expect(defaultTuning.combat.woundEffects).toEqual({
      head: {
        minor: { conditions: [{ id: "core:dazed" }], bleeding: 1 },
        serious: { conditions: [{ id: "core:stunned" }, { id: "core:concussed" }], bleeding: 1 },
        critical: {
          conditions: [{ id: "core:unconscious" }, { id: "core:concussed" }],
          bleeding: 2,
          lethalCheck: true,
          permanentRisk: true,
        },
      },
      torso: {
        minor: { bleeding: 1, penalty: { scope: "physical", value: -10 } },
        serious: {
          bleeding: 2,
          penalty: { scope: "physical", value: -20 },
          fractureIf: ["blunt"],
        },
        critical: {
          bleeding: 3,
          conditions: [{ id: "core:down" }],
          lethalCheck: true,
          beat: "internal injury",
        },
      },
      arm: {
        minor: { penalty: { scope: "sameArm", value: -10 } },
        serious: {
          dropHeld: true,
          penalty: { scope: "sameArm", value: -20 },
          fractureIf: ["blunt"],
          bleedingIf: { cut: 2 },
        },
        critical: { armUseless: true, bleeding: 3, severAtWtMultiple: 4 },
      },
      leg: {
        minor: { penalty: { scope: "movement", value: -10 } },
        serious: {
          conditions: [{ id: "core:prone" }],
          moveCost: 2,
          fractureIf: ["blunt"],
        },
        critical: { cantStand: true, bleeding: 3, permanentRisk: true },
      },
    });
  });
});

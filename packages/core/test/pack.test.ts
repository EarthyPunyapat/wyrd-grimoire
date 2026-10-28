import { describe, expect, test } from "bun:test";
import { type BodyPlanDef, findBodyPlan, HUMANOID_BODY_PLAN } from "../src/schemas/pack.ts";

const plan = (id: string): BodyPlanDef => ({
  id,
  name: id,
  locations: [{ id: "torso", name: "Torso", kind: "torso", from: 1, to: 100, multiplier: 1 }],
});

describe("built-in humanoid", () => {
  test("has six locations with the spec bands and a 1.5 head multiplier", () => {
    const locations = HUMANOID_BODY_PLAN.locations;
    expect(HUMANOID_BODY_PLAN.id).toBe("core:humanoid");
    expect(locations.map((l) => l.id).sort()).toEqual([
      "head",
      "left-arm",
      "left-leg",
      "right-arm",
      "right-leg",
      "torso",
    ]);
    expect(locations.find((l) => l.id === "head")).toMatchObject({
      kind: "head",
      from: 1,
      to: 10,
      multiplier: 1.5,
    });
    const bands = locations.map((l) => [l.from, l.to]).sort((a, b) => a[0]! - b[0]!);
    expect(bands).toEqual([
      [1, 10],
      [11, 50],
      [51, 60],
      [61, 70],
      [71, 85],
      [86, 100],
    ]);
  });
});

describe("findBodyPlan", () => {
  test("returns the exact id match", () => {
    const plans = { "fantasy-core:humanoid": plan("fantasy-core:humanoid") };
    expect(findBodyPlan(plans, "fantasy-core:humanoid")?.id).toBe("fantasy-core:humanoid");
  });

  test("falls back to the first plan with the same local id", () => {
    const plans = {
      "alpha:quadruped": plan("alpha:quadruped"),
      "beta:quadruped": plan("beta:quadruped"),
    };
    expect(findBodyPlan(plans, "gamma:quadruped")?.id).toBe("alpha:quadruped");
    expect(findBodyPlan(plans, "quadruped")?.id).toBe("alpha:quadruped");
  });

  test("an exact match wins over the local-id fallback", () => {
    const plans = {
      "alpha:quadruped": plan("alpha:quadruped"),
      "beta:quadruped": plan("beta:quadruped"),
    };
    expect(findBodyPlan(plans, "beta:quadruped")?.id).toBe("beta:quadruped");
  });

  test("a pack's own humanoid plan wins over the built-in", () => {
    const plans = { "fantasy-core:humanoid": plan("fantasy-core:humanoid") };
    expect(findBodyPlan(plans, "humanoid")?.id).toBe("fantasy-core:humanoid");
  });

  test("falls back to the built-in humanoid when no pack plan matches", () => {
    expect(findBodyPlan({}, "humanoid")).toBe(HUMANOID_BODY_PLAN);
    expect(findBodyPlan({}, "fantasy-core:humanoid")).toBe(HUMANOID_BODY_PLAN);
    expect(findBodyPlan({ "alpha:quadruped": plan("alpha:quadruped") }, "core:humanoid")).toBe(
      HUMANOID_BODY_PLAN,
    );
  });

  test("returns undefined when nothing matches", () => {
    const plans = { "fantasy-core:quadruped": plan("fantasy-core:quadruped") };
    expect(findBodyPlan(plans, "fantasy-core:avian")).toBeUndefined();
    expect(findBodyPlan({}, "avian")).toBeUndefined();
  });

  test("does not return inherited object properties", () => {
    expect(findBodyPlan({}, "constructor")).toBeUndefined();
    expect(findBodyPlan({}, "toString")).toBeUndefined();
  });
});

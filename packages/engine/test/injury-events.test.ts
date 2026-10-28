import { describe, expect, test } from "bun:test";
import { draft, type Wound, Wound as WoundSchema } from "@wyrd/core";
import { applyCondition } from "../src/conditions.ts";
import { effectiveHpMax } from "../src/injury/hp.ts";
import { unwrap } from "../src/result.ts";
import { Sim } from "./sim.ts";

const wound = (over: Partial<Wound> = {}): Wound => ({
  id: "w1",
  location: "torso",
  locationKind: "torso",
  severity: "critical",
  fracture: false,
  severed: false,
  hpMaxReduction: 10,
  ...over,
});

function pcSim(): Sim {
  const s = new Sim();
  s.addActor("pc", "pc");
  return s;
}

describe("effectiveHpMax", () => {
  test("is hpMax minus the wound reductions, floored at zero", () => {
    const sheet = pcSim().state.actors.pc!.sheet;
    expect(effectiveHpMax(sheet)).toBe(20);

    const withWounds = (wounds: Wound[]) => ({ ...sheet, status: { ...sheet.status, wounds } });
    expect(
      effectiveHpMax(withWounds([wound({ hpMaxReduction: 5 }), wound({ id: "w2", hpMaxReduction: 10 })])),
    ).toBe(5);
    expect(
      effectiveHpMax(withWounds([wound({ hpMaxReduction: 15 }), wound({ id: "w2", hpMaxReduction: 10 })])),
    ).toBe(0);
  });
});

describe("injury events", () => {
  test("a critical wound after HP 18 leaves HP at the new effective max of 10", () => {
    const s = pcSim();
    s.commit([draft("HpChanged", { actorId: "pc", hp: 18, delta: -2, cause: "damage" }, "engine")]);
    expect(s.state.actors.pc!.sheet.status.hp).toBe(18);

    s.commit([draft("WoundInflicted", { actorId: "pc", wound: wound() }, "engine")]);
    const sheet = s.state.actors.pc!.sheet;
    expect(sheet.status.wounds).toHaveLength(1);
    expect(effectiveHpMax(sheet)).toBe(10);
    expect(sheet.status.hp).toBe(10);
  });

  test("HpChanged clamps HP to the effective max", () => {
    const s = pcSim();
    s.commit([
      draft(
        "WoundInflicted",
        { actorId: "pc", wound: wound({ hpMaxReduction: 5, severity: "serious" }) },
        "engine",
      ),
    ]);
    expect(s.state.actors.pc!.sheet.status.hp).toBe(15);

    s.commit([draft("HpChanged", { actorId: "pc", hp: 20, delta: 5, cause: "healing" }, "engine")]);
    expect(s.state.actors.pc!.sheet.status.hp).toBe(15);
  });

  test("HpChanged below the max is applied as given", () => {
    const s = pcSim();
    s.commit([draft("HpChanged", { actorId: "pc", hp: 7, delta: -13, cause: "bleeding" }, "engine")]);
    expect(s.state.actors.pc!.sheet.status.hp).toBe(7);
  });

  test("WoundWorsened changes the severity of the named wound", () => {
    const s = pcSim();
    s.commit([
      draft(
        "WoundInflicted",
        { actorId: "pc", wound: wound({ severity: "minor", hpMaxReduction: 2 }) },
        "engine",
      ),
    ]);
    s.commit([
      draft(
        "WoundWorsened",
        { actorId: "pc", woundId: "w1", severity: "serious", hpMaxReduction: 5 },
        "engine",
      ),
    ]);
    expect(s.state.actors.pc!.sheet.status.wounds[0]?.severity).toBe("serious");
  });

  test("worsening a wound carries its new max-HP reduction and clamps HP", () => {
    const s = pcSim();
    s.commit([draft("HpChanged", { actorId: "pc", hp: 18, delta: -2, cause: "damage" }, "engine")]);
    s.commit([
      draft(
        "WoundInflicted",
        { actorId: "pc", wound: wound({ severity: "minor", hpMaxReduction: 2 }) },
        "engine",
      ),
    ]);
    expect(s.state.actors.pc!.sheet.status.hp).toBe(18);

    s.commit([
      draft(
        "WoundWorsened",
        { actorId: "pc", woundId: "w1", severity: "critical", hpMaxReduction: 10 },
        "engine",
      ),
    ]);
    const sheet = s.state.actors.pc!.sheet;
    expect(sheet.status.wounds[0]).toMatchObject({ severity: "critical", hpMaxReduction: 10 });
    expect(effectiveHpMax(sheet)).toBe(10);
    expect(sheet.status.hp).toBe(10);
  });

  test("WoundWorsened for an unknown wound throws", () => {
    const s = pcSim();
    expect(() =>
      s.commit([
        draft(
          "WoundWorsened",
          { actorId: "pc", woundId: "nope", severity: "serious", hpMaxReduction: 5 },
          "engine",
        ),
      ]),
    ).toThrow(/nope/);
  });

  test("WoundInflicted with an id the actor already has throws and leaves the wounds unchanged", () => {
    const s = pcSim();
    s.commit([
      draft(
        "WoundInflicted",
        { actorId: "pc", wound: wound({ hpMaxReduction: 2, severity: "minor" }) },
        "engine",
      ),
    ]);
    expect(() =>
      s.commit([draft("WoundInflicted", { actorId: "pc", wound: wound({ hpMaxReduction: 10 }) }, "engine")]),
    ).toThrow(/w1/);
    expect(s.state.actors.pc!.sheet.status.wounds).toHaveLength(1);
    expect(s.state.actors.pc!.sheet.status.wounds[0]?.hpMaxReduction).toBe(2);
  });

  test("HitResolved writes rngAfter back to the campaign RNG state", () => {
    const s = pcSim();
    s.commit([
      draft(
        "HitResolved",
        {
          attackerId: null,
          targetId: "pc",
          weaponId: null,
          location: "torso",
          locationRoll: 40,
          damageRolls: [3, 4],
          raw: 7,
          protection: 2,
          final: 5,
          crit: false,
          rngAfter: [9, 8, 7, 6],
        },
        "engine",
      ),
    ]);
    expect(s.state.campaign.rngState).toEqual([9, 8, 7, 6]);
  });

  test("the core:down condition can be applied", () => {
    const s = pcSim();
    const result = applyCondition(s.state, "pc", { id: "core:down" });
    expect(result.ok).toBe(true);
    s.commit(unwrap(result));
    expect(s.state.actors.pc!.sheet.status.conditions.map((c) => c.id)).toEqual(["core:down"]);
  });
});

describe("Wound schema", () => {
  const base = { id: "w1", location: "torso", severity: "serious", hpMaxReduction: 5 };

  test("requires locationKind and defaults fracture and severed to false", () => {
    expect(() => WoundSchema.parse(base)).toThrow();
    const parsed = WoundSchema.parse({ ...base, locationKind: "torso" });
    expect(parsed.fracture).toBe(false);
    expect(parsed.severed).toBe(false);
    expect(parsed.penalty).toBeUndefined();
  });

  test("penalty scope is one of the tuning scopes", () => {
    const withPenalty = (scope: string) =>
      WoundSchema.parse({ ...base, locationKind: "torso", penalty: { scope, value: -10 } });
    expect(withPenalty("sameArm").penalty).toEqual({ scope: "sameArm", value: -10 });
    expect(() => withPenalty("everything")).toThrow();
  });
});

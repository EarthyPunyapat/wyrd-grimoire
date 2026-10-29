import { describe, expect, test } from "bun:test";
import { draft, Rng, type Wound } from "@wyrd/core";
import type { HealingContext } from "../src/injury/healing.ts";
import { healingDaily, rest } from "../src/injury/healing.ts";
import { unwrap } from "../src/result.ts";
import { Working } from "../src/working.ts";
import { ctx as rules, Sim } from "./sim.ts";

const ctx: HealingContext = { ...rules, nameOf: (id) => id };

function sim(wound: Partial<Wound> = {}, settings = {}) {
  const s = new Sim(settings, 3);
  s.addActor("pc", "pc");
  s.commit([
    draft("WoundInflicted", {
      actorId: "pc",
      wound: {
        id: "pc-w1",
        location: "torso",
        locationKind: "torso",
        severity: "serious",
        hpMaxReduction: rules.tuning.combat.hpMaxReduction.serious,
        fracture: false,
        severed: false,
        healingDays: 2,
        infected: false,
        treated: false,
        ...wound,
      },
    }),
  ]);
  return s;
}

function tick(s: Sim, healingCtx: HealingContext = ctx) {
  const w = new Working(s.state);
  const rng = new Rng(w.state.campaign.rngState);
  const events = healingDaily(w, healingCtx, rng, 1);
  s.commit(events);
  return events;
}

describe("healing and injury completion (spec 03)", () => {
  test("a wound heals after its days and stops reducing max HP", () => {
    const s = sim({ healingDays: 2 });
    expect(tick(s).some((e) => e.type === "WoundProgressed")).toBe(true);
    expect(s.state.actors.pc!.sheet.status.wounds[0]!.healingDays).toBe(1);
    const events = tick(s);
    expect(events.some((e) => e.type === "WoundHealed")).toBe(true);
    expect(s.state.actors.pc!.sheet.status.wounds).toEqual([]);
  });

  test("treatment and simple injuries speed healing", () => {
    const treated = sim({ healingDays: 3, treated: true });
    tick(treated);
    expect(treated.state.actors.pc!.sheet.status.wounds[0]!.healingDays).toBe(1);
    const simple = sim({}, { subsystems: { injuries: "simple" } });
    for (let day = 0; day < 4; day++) tick(simple);
    expect(simple.state.actors.pc!.sheet.status.wounds).toEqual([]);
  });

  test("a fracture cannot knit until it is set", () => {
    const s = sim({ healingDays: 1, fracture: true });
    tick(s);
    expect(s.state.actors.pc!.sheet.status.wounds).toHaveLength(1);
    expect(s.state.actors.pc!.sheet.status.wounds[0]!.healingDays).toBe(1);
    s.commit([draft("WoundTreated", { actorId: "pc", woundId: "pc-w1", kind: "fracture", summary: "set" })]);
    tick(s);
    expect(s.state.actors.pc!.sheet.status.wounds).toEqual([]);
  });

  test("an untreated serious wound can infect and cost HP each day", () => {
    const s = sim({ healingDays: 9 });
    const always: HealingContext = {
      ...ctx,
      tuning: { ...rules.tuning, injury: { ...rules.tuning.injury, infectionChance: 100 } },
    };
    const events = tick(s, always);
    expect(events.some((e) => e.type === "WoundInfected")).toBe(true);
    expect(s.state.actors.pc!.sheet.status.conditions.some((c) => c.id === "core:infected")).toBe(true);
    const hp = s.state.actors.pc!.sheet.status.hp;
    tick(s, always);
    expect(s.state.actors.pc!.sheet.status.hp).toBeLessThan(hp);
  });

  test("the infection toggle and permanent-injury toggle are respected", () => {
    const noInfection = sim({ healingDays: 9 }, { subsystems: { infection: false } });
    const always: HealingContext = {
      ...ctx,
      tuning: { ...rules.tuning, injury: { ...rules.tuning.injury, infectionChance: 100 } },
    };
    expect(tick(noInfection, always).some((e) => e.type === "WoundInfected")).toBe(false);

    const noPermanent = sim(
      { severity: "critical", healingDays: 1, treated: false },
      { subsystems: { permanentInjuries: false } },
    );
    const certain: HealingContext = {
      ...ctx,
      tuning: { ...rules.tuning, injury: { ...rules.tuning.injury, permanentChance: 100 } },
    };
    expect(tick(noPermanent, certain).some((e) => e.type === "PermanentInjuryGained")).toBe(false);
  });

  test("a badly healed critical wound leaves a permanent injury", () => {
    const s = sim({ severity: "critical", healingDays: 1, treated: false });
    const certain: HealingContext = {
      ...ctx,
      tuning: { ...rules.tuning, injury: { ...rules.tuning.injury, permanentChance: 100 } },
    };
    tick(s, certain);
    expect(s.state.actors.pc!.sheet.status.permanentInjuries).toHaveLength(1);
  });

  test("a long rest treats wounds, restores HP and clears exhaustion", () => {
    const s = sim({ healingDays: 9 });
    s.commit([
      draft("ConditionApplied", { actorId: "pc", condition: { id: "core:exhausted", level: 1 } }),
      draft("HpChanged", { actorId: "pc", hp: 2, delta: 0, cause: "damage" }),
    ]);
    const events = unwrap(rest(s.state, "pc", "long", ctx));
    s.commit(events);
    expect(events.some((e) => e.type === "WoundTreated")).toBe(true);
    expect(s.state.actors.pc!.sheet.status.wounds[0]!.treated).toBe(true);
    expect(s.state.actors.pc!.sheet.status.hp).toBe(2 + rules.tuning.injury.longRestHeal);
    expect(s.state.actors.pc!.sheet.status.conditions.some((c) => c.id === "core:exhausted")).toBe(false);
  });
});

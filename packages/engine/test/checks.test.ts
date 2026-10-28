import { describe, expect, test } from "bun:test";
import type { CheckRequestInput, CheckResolvedPayload, EventDraft } from "@wyrd/core";
import { pushCheck, resolveCheck, resolveOpposedCheck } from "../src/checks.ts";
import { applyCondition } from "../src/conditions.ts";
import { regainLuck, spendLuckDowngrade, spendLuckReroll } from "../src/luck.ts";
import { isSuccess } from "../src/resolution/index.ts";
import { unwrap } from "../src/result.ts";
import { attrs } from "./fixtures.ts";
import { ctx, Sim } from "./sim.ts";

const stealth = (over: Partial<CheckRequestInput> = {}): CheckRequestInput => ({
  actorId: "pc",
  skill: "core:stealth",
  difficulty: "normal",
  purpose: "sneak past the guard",
  ...over,
});

const resolvedPayload = (events: EventDraft[]): CheckResolvedPayload => {
  const e = events.find((d) => d.type === "CheckResolved");
  if (e?.type !== "CheckResolved") throw new Error("no CheckResolved");
  return e.payload;
};

function sim(settings = {}, seed: number | string = 1) {
  const s = new Sim(settings, seed);
  s.addActor("pc", "pc", { attributes: attrs({ agi: 6 }), skills: { "core:stealth": { trained: 32 } } });
  s.addActor("guard", "npc", {
    attributes: attrs({ awa: 6 }),
    skills: { "core:perception": { trained: 20 } },
  });
  return s;
}

/** Finds a seed where `pred` holds for a fresh sim, so tests can force a specific roll deterministically. */
function seedWhere(pred: (s: Sim) => boolean, settings = {}): Sim {
  for (let seed = 0; seed < 2000; seed++) {
    const s = sim(settings, seed);
    if (pred(s)) return sim(settings, seed);
  }
  throw new Error("no seed found");
}

describe("resolveCheck", () => {
  test("emits CheckResolved and advances the generator", () => {
    const s = sim();
    const before = s.state.campaign.rngState;
    const out = unwrap(resolveCheck(s.state, stealth(), ctx));
    const p = resolvedPayload(out.events);
    expect(p.prepared.skillValue).toBe(50);
    expect(p.module).toBe("d100");
    expect(p.attempt).toBe("initial");
    s.commit(out.events);
    expect(s.state.campaign.rngState).not.toEqual(before);
    expect(s.state.lastChecks.pc?.effective).toEqual(out.effective);
  });

  test("is deterministic for the same state", () => {
    const s = sim();
    expect(resolveCheck(s.state, stealth(), ctx)).toEqual(resolveCheck(s.state, stealth(), ctx));
  });

  test("uses the campaign's dice module", () => {
    const s = sim({ structural: { resolution: "d20" } });
    const p = resolvedPayload(unwrap(resolveCheck(s.state, stealth(), ctx)).events);
    expect(p.module).toBe("d20");
    expect(p.result.display.text).toContain("vs DC 11");
  });

  test("situational modifiers are clamped to ±40", () => {
    const s = sim();
    const req = stealth({
      modifiers: [
        { source: "darkness", value: -40 },
        { source: "rain", value: -20 },
      ],
    });
    const p = resolvedPayload(unwrap(resolveCheck(s.state, req, ctx)).events);
    expect(p.prepared.modifierTotal).toBe(-40);
    expect(p.result.display.text).toContain("capped at −40");
  });

  test("campaign difficulty modifies the player side only", () => {
    const s = sim({ difficulty: "story" });
    const pc = resolvedPayload(unwrap(resolveCheck(s.state, stealth(), ctx)).events);
    expect(pc.prepared.modifiers).toContainEqual({ source: "story difficulty", value: 10 });
    const npc = resolvedPayload(
      unwrap(resolveCheck(s.state, { ...stealth(), actorId: "guard", skill: "core:perception" }, ctx)).events,
    );
    expect(npc.prepared.modifiers).toEqual([]);
  });

  test("attribute checks use attribute × 10", () => {
    const s = sim();
    const p = resolvedPayload(
      unwrap(resolveCheck(s.state, stealth({ skill: { attribute: "end" } }), ctx)).events,
    );
    expect(p.prepared.skillValue).toBe(50);
    expect(p.prepared.label).toBe("Endurance");
  });

  test("boons and banes net out and clamp to ±2", () => {
    const s = sim();
    s.commit(unwrap(applyCondition(s.state, "pc", { id: "core:inspired" })));
    const p = resolvedPayload(unwrap(resolveCheck(s.state, stealth({ boons: 2 }), ctx)).events);
    expect(p.prepared.netBoons).toBe(2);
    const q = resolvedPayload(unwrap(resolveCheck(s.state, stealth({ boons: 1, banes: 2 }), ctx)).events);
    expect(q.prepared.netBoons).toBe(0); // 1 + Inspired − 2
  });

  test("rejects unknown actors, unknown skills and malformed requests", () => {
    const s = sim();
    expect(resolveCheck(s.state, stealth({ actorId: "ghost" }), ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "ACTOR_UNKNOWN" }],
    });
    expect(resolveCheck(s.state, stealth({ skill: "core:flying" }), ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "SKILL_UNKNOWN" }],
    });
    expect(resolveCheck(s.state, { ...stealth(), difficulty: "trivial" as never }, ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "REQUEST_INVALID" }],
    });
  });
});

describe("conditions on checks", () => {
  test("Prone: −20 to Melee and Dodge only", () => {
    const s = sim();
    s.commit(unwrap(applyCondition(s.state, "pc", { id: "core:prone" })));
    const melee = resolvedPayload(
      unwrap(resolveCheck(s.state, stealth({ skill: "core:melee" }), ctx)).events,
    );
    expect(melee.prepared.modifiers).toContainEqual({ source: "Prone", value: -20 });
    const sneak = resolvedPayload(unwrap(resolveCheck(s.state, stealth(), ctx)).events);
    expect(sneak.prepared.modifiers).toEqual([]);
  });

  test("Exhausted: −10 per level; level 5 also knocks the actor out", () => {
    const s = sim();
    s.commit(unwrap(applyCondition(s.state, "pc", { id: "core:exhausted", level: 2 })));
    const p = resolvedPayload(unwrap(resolveCheck(s.state, stealth(), ctx)).events);
    expect(p.prepared.modifiers).toContainEqual({ source: "Exhausted 2", value: -20 });
    s.commit(unwrap(applyCondition(s.state, "pc", { id: "core:exhausted", level: 5 })));
    const ids = s.state.actors.pc!.sheet.status.conditions.map((c) => c.id);
    expect(ids).toEqual(["core:exhausted", "core:unconscious"]);
  });

  test("Blinded: sight checks fail without a roll; attacks −40", () => {
    const s = sim();
    s.commit(unwrap(applyCondition(s.state, "pc", { id: "core:blinded" })));
    const out = unwrap(resolveCheck(s.state, stealth({ skill: "core:perception", tags: ["sight"] }), ctx));
    const p = resolvedPayload(out.events);
    expect(p.autoFailed).toBe("Blinded");
    expect(p.result.rolls).toEqual([]);
    expect(p.rngAfter).toEqual([...s.state.campaign.rngState]);
    const atk = resolvedPayload(
      unwrap(resolveCheck(s.state, stealth({ skill: "core:melee", tags: ["attack"] }), ctx)).events,
    );
    expect(atk.prepared.modifiers).toContainEqual({ source: "Blinded", value: -40 });
  });

  test("Unconscious blocks checks except resistance", () => {
    const s = sim();
    s.commit(unwrap(applyCondition(s.state, "pc", { id: "core:unconscious" })));
    expect(resolveCheck(s.state, stealth(), ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "ACTOR_INCAPACITATED" }],
    });
    expect(resolveCheck(s.state, stealth({ skill: { attribute: "end" }, tags: ["resist"] }), ctx).ok).toBe(
      true,
    );
  });

  test("Inspired gives one boon and is used up", () => {
    const s = sim();
    s.commit(unwrap(applyCondition(s.state, "pc", { id: "core:inspired" })));
    const out = unwrap(resolveCheck(s.state, stealth(), ctx));
    expect(resolvedPayload(out.events).prepared.netBoons).toBe(1);
    s.commit(out.events);
    expect(s.state.actors.pc!.sheet.status.conditions).toEqual([]);
  });

  test("Concussed: −20 to INT and AWA checks", () => {
    const s = sim();
    s.commit(unwrap(applyCondition(s.state, "pc", { id: "core:concussed" })));
    const p = resolvedPayload(
      unwrap(resolveCheck(s.state, stealth({ skill: "core:perception" }), ctx)).events,
    );
    expect(p.prepared.modifiers).toContainEqual({ source: "Concussed", value: -20 });
  });

  test("validates levels and variants", () => {
    const s = sim();
    expect(applyCondition(s.state, "pc", { id: "core:bleeding", level: 4 })).toMatchObject({
      ok: false,
      errors: [{ code: "CONDITION_LEVEL_INVALID" }],
    });
    expect(applyCondition(s.state, "pc", { id: "core:in-cover" })).toMatchObject({
      ok: false,
      errors: [{ code: "CONDITION_VARIANT_INVALID" }],
    });
    expect(applyCondition(s.state, "pc", { id: "core:nope" })).toMatchObject({
      ok: false,
      errors: [{ code: "CONDITION_UNKNOWN" }],
    });
  });
});

const fails = (s: Sim) => unwrap(resolveCheck(s.state, stealth(), ctx)).effective.degree === "failure";

describe("pushing", () => {
  test("a failed push becomes a critical failure", () => {
    const s = seedWhere((x) => {
      if (!fails(x)) return false;
      x.commit(unwrap(resolveCheck(x.state, stealth(), ctx)).events);
      return !isSuccess(unwrap(pushCheck(x.state, "pc", ctx)).effective.degree);
    });
    s.commit(unwrap(resolveCheck(s.state, stealth(), ctx)).events);
    const out = unwrap(pushCheck(s.state, "pc", ctx));
    const p = resolvedPayload(out.events);
    expect(p.attempt).toBe("push");
    expect(p.request.pushed).toBe(true);
    expect(out.effective.degree).toBe("critFailure");
    expect(out.effective.display.text).toContain("pushed → Critical failure");
  });

  test("a successful push keeps its success", () => {
    const s = seedWhere((x) => {
      if (!fails(x)) return false;
      x.commit(unwrap(resolveCheck(x.state, stealth(), ctx)).events);
      return isSuccess(unwrap(pushCheck(x.state, "pc", ctx)).effective.degree);
    });
    s.commit(unwrap(resolveCheck(s.state, stealth(), ctx)).events);
    expect(isSuccess(unwrap(pushCheck(s.state, "pc", ctx)).effective.degree)).toBe(true);
  });

  test("only once, only after a plain failure, never in combat", () => {
    const s = seedWhere(fails);
    expect(pushCheck(s.state, "pc", ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "NO_CHECK_TO_PUSH" }],
    });
    s.commit(unwrap(resolveCheck(s.state, stealth(), ctx)).events);
    s.commit(unwrap(pushCheck(s.state, "pc", ctx)).events);
    expect(pushCheck(s.state, "pc", ctx)).toMatchObject({ ok: false, errors: [{ code: "ALREADY_PUSHED" }] });

    const win = seedWhere(
      (x) => !fails(x) && isSuccess(unwrap(resolveCheck(x.state, stealth(), ctx)).effective.degree),
    );
    win.commit(unwrap(resolveCheck(win.state, stealth(), ctx)).events);
    expect(pushCheck(win.state, "pc", ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "PUSH_NOT_FAILED" }],
    });

    const fight = seedWhere(fails);
    const inCombat = { ...fight.state, mode: "combat" as const };
    fight.commit(unwrap(resolveCheck(inCombat, stealth(), ctx)).events);
    expect(pushCheck(fight.state, "pc", ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "PUSH_IN_COMBAT" }],
    });
  });
});

describe("Luck", () => {
  test("starts full: 3 gritty, 1 brutal, hardcore one less (min 1)", () => {
    expect(sim().state.actors.pc!.sheet.status.luck).toBe(3);
    expect(sim({ lethality: "brutal" }).state.actors.pc!.sheet.status.luck).toBe(1);
    expect(sim({ structural: { hardcore: true } }).state.actors.pc!.sheet.status.luck).toBe(2);
    expect(
      sim({ lethality: "brutal", structural: { hardcore: true } }).state.actors.pc!.sheet.status.luck,
    ).toBe(1);
  });

  test("a reroll costs 1 and keeps the better result", () => {
    const s = seedWhere(fails);
    s.commit(unwrap(resolveCheck(s.state, stealth(), ctx)).events);
    const before = s.state.lastChecks.pc!.effective;
    const out = unwrap(spendLuckReroll(s.state, "pc", ctx));
    expect(out.events[0]).toMatchObject({ type: "LuckSpent", payload: { amount: 1, purpose: "reroll" } });
    const p = resolvedPayload(out.events);
    expect(p.attempt).toBe("luck");
    expect([p.result, before]).toContainEqual(out.effective);
    s.commit(out.events);
    expect(s.state.actors.pc!.sheet.status.luck).toBe(2);
    expect(spendLuckReroll(s.state, "pc", ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "LUCK_ALREADY_USED" }],
    });
  });

  test("never on a pushed roll, never for NPCs, never without Luck", () => {
    const s = seedWhere(fails);
    s.commit(unwrap(resolveCheck(s.state, stealth(), ctx)).events);
    s.commit(unwrap(pushCheck(s.state, "pc", ctx)).events);
    expect(spendLuckReroll(s.state, "pc", ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "LUCK_ON_PUSHED" }],
    });

    const n = sim();
    n.commit(unwrap(resolveCheck(n.state, { ...stealth(), actorId: "guard" }, ctx)).events);
    expect(spendLuckReroll(n.state, "guard", ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "LUCK_PC_ONLY" }],
    });

    const broke = new Sim();
    broke.addActor("pc", "pc", { status: { luck: 0 } });
    broke.commit(unwrap(resolveCheck(broke.state, stealth(), ctx)).events);
    expect(spendLuckReroll(broke.state, "pc", ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "LUCK_INSUFFICIENT" }],
    });
  });

  test("2 Luck downgrades a lethal wound to critical", () => {
    const s = new Sim();
    s.addActor("pc", "pc", {
      status: { wounds: [{ id: "w1", location: "torso", severity: "lethal", hpMaxReduction: 10 }] },
    });
    s.commit(unwrap(spendLuckDowngrade(s.state, "pc", "w1", ctx)));
    const st = s.state.actors.pc!.sheet.status;
    expect(st.luck).toBe(1);
    expect(st.wounds[0]?.severity).toBe("critical");
    expect(spendLuckDowngrade(s.state, "pc", "w1", ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "LUCK_INSUFFICIENT" }],
    });
  });

  test("regain: +1 on chapter close, refill on arc close, capped at max", () => {
    const s = new Sim();
    s.addActor("pc", "pc", { status: { luck: 0 } });
    s.commit(unwrap(regainLuck(s.state, "pc", "chapterClosed", ctx)));
    expect(s.state.actors.pc!.sheet.status.luck).toBe(1);
    s.commit(unwrap(regainLuck(s.state, "pc", "arcClosed", ctx)));
    expect(s.state.actors.pc!.sheet.status.luck).toBe(3);
    expect(unwrap(regainLuck(s.state, "pc", "chapterClosed", ctx))).toEqual([]);
  });
});

describe("opposed checks", () => {
  test("both sides roll; the result names a winner and both events record it", () => {
    const s = sim();
    const out = unwrap(
      resolveOpposedCheck(
        s.state,
        stealth({ opposedBy: { actorId: "guard", skill: "core:perception" } }),
        ctx,
      ),
    );
    const resolved = out.events
      .filter((e) => e.type === "CheckResolved")
      .map((e) => e.payload as CheckResolvedPayload);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.opposed).toEqual({
      role: "active",
      againstActorId: "guard",
      won: out.winner === "active",
    });
    expect(resolved[1]?.opposed).toEqual({
      role: "defender",
      againstActorId: "pc",
      won: out.winner === "defender",
    });
    s.commit(out.events);
    expect(s.state.lastChecks.guard?.opposed).toBe(true);
  });

  test("resolveCheck refuses opposed requests and vice versa", () => {
    const s = sim();
    expect(
      resolveCheck(s.state, stealth({ opposedBy: { actorId: "guard", skill: "core:perception" } }), ctx),
    ).toMatchObject({ ok: false, errors: [{ code: "CHECK_IS_OPPOSED" }] });
    expect(resolveOpposedCheck(s.state, stealth(), ctx)).toMatchObject({
      ok: false,
      errors: [{ code: "CHECK_NOT_OPPOSED" }],
    });
  });
});

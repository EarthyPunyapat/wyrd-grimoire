import { describe, expect, test } from "bun:test";
import { draft, type ExplorationActionInput, SceneState } from "@wyrd/core";
import { type ExplorationContext, normaliseSkill, resolvePlan, validatePlan } from "../src/exploration.ts";
import { unwrap } from "../src/result.ts";
import { attrs } from "./fixtures.ts";
import { ctx as rules, Sim } from "./sim.ts";

const NAMES: Record<string, string> = {
  pc: "Wren",
  "npc:wenna": "Wenna",
  "npc:guard": "the guard",
  "loc:ferry": "Ashford Ferry",
  "z:common": "the common room",
  "z:yard": "the yard",
  "z:jetty": "the jetty",
  "z:loft": "the hayloft",
  "prop:hatch": "the cellar hatch",
};
const ctx: ExplorationContext = { ...rules, nameOf: (id) => NAMES[id] ?? id };

function sim(light: "bright" | "dim" | "dark" = "bright") {
  const s = new Sim({}, 3);
  s.addActor("pc", "pc", { attributes: attrs({ awa: 6, agi: 6 }) });
  s.addActor("npc:guard", "npc");
  s.commit([
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: "scene-1",
        locationId: "loc:ferry",
        zones: [
          {
            id: "z:common",
            name: "the common room",
            props: [{ id: "prop:hatch", name: "cellar hatch", affordances: ["open"] }],
          },
          { id: "z:yard", name: "the yard" },
          { id: "z:jetty", name: "the jetty" },
          { id: "z:loft", name: "the hayloft", tags: ["elevated"] },
        ],
        edges: [
          { a: "z:common", b: "z:yard" },
          { a: "z:yard", b: "z:jetty" },
          { a: "z:yard", b: "z:loft", requires: "climb" },
        ],
        positions: { pc: "z:common", "npc:wenna": "z:jetty", "npc:guard": "z:yard" },
        light,
        openedAt: 0,
      }),
    }),
  ]);
  return s;
}

const validate = (s: Sim, actions: ExplorationActionInput[] | unknown[]) =>
  validatePlan(s.state, "pc", actions, ctx);
const codes = (s: Sim, actions: unknown[]) => validate(s, actions).planErrors?.map((e) => e.code) ?? [];

describe("validatePlan", () => {
  test("accepts a legal plan", () => {
    const s = sim();
    const r = validate(s, [
      { type: "examine", targetId: "prop:hatch" },
      { type: "move", toZoneId: "z:jetty" },
      { type: "talk", targetId: "npc:wenna", utterance: "How much to cross?" },
    ]);
    expect(r.ok).toBe(true);
  });

  test("reports each problem with a stable code and the action's index", () => {
    const s = sim();
    const r = validate(s, [
      { type: "examine", targetId: "prop:hatch" },
      { type: "talk", targetId: "npc:ghost", utterance: "Hello?" },
      { type: "move", toZoneId: "z:common" },
      { type: "strike", targetId: "npc:guard" },
      { type: "check", skill: "flying", goal: "fly", proposedDifficulty: "hard", reason: "x" },
    ]);
    expect(r.planErrors?.map((e) => [e.actionIndex, e.code])).toEqual([
      [1, "TARGET_NOT_PRESENT"],
      [2, "ALREADY_THERE"],
      [3, "ACTION_NOT_AVAILABLE"],
      [4, "SKILL_UNKNOWN"],
    ]);
  });

  test("gated zones suggest the check that would open them", () => {
    const s = sim();
    const r = validate(s, [{ type: "move", toZoneId: "z:loft" }]);
    expect(r.planErrors?.[0]).toMatchObject({
      code: "ZONE_NEEDS_CLIMB",
      legalAlternatives: [{ type: "check", skill: "core:athletics" }],
    });
  });

  test("unknown zones list the legal moves", () => {
    const s = sim();
    const err = validate(s, [{ type: "move", toZoneId: "z:roof" }]).planErrors?.[0];
    expect(err?.code).toBe("ZONE_UNKNOWN");
    expect(err?.legalAlternatives?.map((a) => (a as { toZoneId: string }).toZoneId)).toEqual([
      "z:yard",
      "z:jetty",
      "z:loft",
    ]);
  });

  test("malformed actions, empty plans, long waits", () => {
    const s = sim();
    expect(codes(s, [{ type: "talk", targetId: "npc:wenna" }])).toEqual(["ACTION_INVALID"]);
    expect(codes(s, [])).toEqual(["PLAN_EMPTY"]);
    expect(codes(s, [{ type: "wait", minutes: 900 }])).toEqual(["WAIT_TOO_LONG"]);
  });

  test("needs exploration mode and an open scene", () => {
    const s = new Sim();
    s.addActor("pc", "pc");
    expect(validate(s, [{ type: "wait", minutes: 5 }])).toMatchObject({
      ok: false,
      errors: [{ code: "NO_SCENE" }],
    });
  });
});

describe("normaliseSkill", () => {
  test("accepts bare names, IDs, field skills and attributes", () => {
    expect(normaliseSkill("stealth", rules)).toEqual({ skill: "core:stealth" });
    expect(normaliseSkill("core:lore/history", rules)).toEqual({ skill: "core:lore/history" });
    expect(normaliseSkill("lore/herbs", rules)).toEqual({ skill: "core:lore/herbs" });
    expect(normaliseSkill("END", rules)).toEqual({ skill: { attribute: "end" } });
    expect(normaliseSkill("Willpower", rules)).toEqual({ skill: { attribute: "wil" } });
    expect(normaliseSkill("lore", rules)).toBeNull(); // field skill without a field
  });
});

describe("resolvePlan", () => {
  test("resolves in order, emits events, and lists required beats", () => {
    const s = sim();
    const plan = unwrap(
      validate(s, [
        { type: "examine", targetId: "prop:hatch" },
        { type: "move", toZoneId: "z:jetty" },
        {
          type: "check",
          skill: "stealth",
          goal: "slip aboard unseen",
          proposedDifficulty: "hard",
          reason: "the guard is watching",
        },
      ]),
    );
    const { events, resolution } = unwrap(resolvePlan(s.state, plan, ctx));
    expect(events.map((e) => e.type)).toEqual(["EntityMoved", "CheckResolved", "TimeAdvanced"]);
    expect(resolution.steps.map((x) => x.outcome.length > 0)).toEqual([true, true, true]);
    expect(resolution.steps[0]?.outcome).toBe("done");
    expect(resolution.steps[2]?.mechanics?.text).toContain("Stealth");
    expect(resolution.requiredBeats[1]).toBe("Wren goes to the jetty.");
    expect(resolution.minutes).toBe(3); // 2 zones of movement + 1 for the check
    s.commit(events);
    expect(s.state.scene?.positions.pc).toBe("z:jetty");
    expect(s.state.campaign.gameTime).toBe(3);
  });

  test("search is a Perception check with light penalties", () => {
    const s = sim("dim");
    const { resolution } = unwrap(
      resolvePlan(s.state, unwrap(validate(s, [{ type: "search", area: "the floor" }])), ctx),
    );
    expect(resolution.steps[0]?.mechanics?.text).toMatch(/^Perception .* dim light −20/);
    expect(resolution.minutes).toBe(10);
  });

  test("parser difficulty above Extreme is clamped", () => {
    const s = sim();
    const plan = unwrap(
      validate(s, [
        {
          type: "check",
          skill: "athletics",
          goal: "leap the river",
          proposedDifficulty: "heroic",
          reason: "very wide",
        },
      ]),
    );
    expect(
      resolvePlan(s.state, plan, ctx).ok &&
        unwrap(resolvePlan(s.state, plan, ctx)).resolution.steps[0]?.mechanics?.text,
    ).toContain("Extreme");
  });

  test("approach talk rolls opposed against an actor, or a plain check against a canon NPC", () => {
    const s = sim();
    const opposed = unwrap(
      resolvePlan(
        s.state,
        unwrap(
          validate(s, [
            { type: "talk", targetId: "npc:guard", utterance: "Let me pass.", approach: "persuade" },
          ]),
        ),
        ctx,
      ),
    );
    expect(opposed.events.filter((e) => e.type === "CheckResolved")).toHaveLength(2);
    expect(opposed.resolution.requiredBeats[0]).toContain('Wren says to the guard: "Let me pass."');

    const plain = unwrap(
      resolvePlan(
        s.state,
        unwrap(
          validate(s, [{ type: "talk", targetId: "npc:wenna", utterance: "Half price?", approach: "charm" }]),
        ),
        ctx,
      ),
    );
    expect(plain.events.filter((e) => e.type === "CheckResolved")).toHaveLength(1);
    expect(plain.resolution.requiredBeats[0]).toMatch(/Wenna (is|isn't) swayed\.$/);
  });

  test("stops when an earlier step makes a later one impossible", () => {
    const s = sim();
    // Valid against the starting state, but after moving to the jetty, moving to the jetty again isn't.
    const plan = unwrap(
      validate(s, [
        { type: "move", toZoneId: "z:jetty" },
        { type: "move", toZoneId: "z:jetty" },
        { type: "wait", minutes: 5 },
      ]),
    );
    const { resolution } = unwrap(resolvePlan(s.state, plan, ctx));
    expect(resolution.stoppedAt).toBe(1);
    expect(resolution.steps).toHaveLength(1);
    expect(resolution.requiredBeats.at(-1)).toContain("Already in the jetty");
  });
});

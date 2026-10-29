import { describe, expect, test } from "bun:test";
import { defaultTuning, draft, type EventDraft } from "@wyrd/core";
import type { CreationContent } from "../src/creation.ts";
import {
  buyAdvancement,
  closeEvents,
  improvementRolls,
  priceOf,
  skillStepCost,
  turnAwards,
  turnMarks,
  xpAvailable,
} from "../src/progression.ts";
import { unwrap } from "../src/result.ts";
import { attrs, catalog } from "./fixtures.ts";
import { Sim } from "./sim.ts";

const content: CreationContent = {
  skills: catalog,
  ancestries: {},
  archetypes: {},
  talents: {
    "test:tough": {
      id: "test:tough",
      name: "Tough",
      tier: 1,
      description: "x",
      prerequisites: { attributes: { end: 6 }, skills: {}, talents: [] },
    },
    "test:tougher": {
      id: "test:tougher",
      name: "Tougher",
      tier: 2,
      description: "x",
      prerequisites: { attributes: {}, skills: {}, talents: ["test:tough"] },
    },
  },
};

function party(progression: "classless" | "useBased" | "hybrid" = "classless") {
  const s = new Sim({ structural: { progression } });
  s.addActor("pc", "pc", { attributes: attrs({ end: 6 }), skills: { "core:melee": { trained: 30 } } });
  s.addActor("mira", "companion", { attributes: attrs({}), skills: {} });
  return s;
}
const xp = (amount: number) => draft("XpAwarded", { amount, source: "quest", reason: "test" }, "engine");

describe("costs (spec 04 classless table)", () => {
  test("skill steps cost 1/2/3/4 XP by value, and stop at 90 without Mastery", () => {
    expect([10, 24, 25, 49, 50, 74, 75, 89, 90].map((v) => skillStepCost(v, defaultTuning))).toEqual([
      1,
      1,
      2,
      2,
      3,
      3,
      4,
      4,
      null,
    ]);
  });
  test("an attribute costs 4 × the new value, a talent by tier, and XP must cover it", () => {
    const s = party();
    expect(priceOf(s.state, "pc", { kind: "attribute", id: "str" }, content, defaultTuning).ok).toBe(false);
    s.commit([xp(40)]);
    // Attributes start at 5 in the fixture: 5 → 6 costs 24.
    expect(
      unwrap(priceOf(s.state, "pc", { kind: "attribute", id: "str" }, content, defaultTuning)).cost,
    ).toBe(24);
    expect(
      unwrap(priceOf(s.state, "pc", { kind: "talent", id: "test:tough" }, content, defaultTuning)).cost,
    ).toBe(8);
    const blocked = priceOf(s.state, "pc", { kind: "talent", id: "test:tougher" }, content, defaultTuning);
    expect(blocked.ok ? "" : blocked.errors[0]!.message).toContain("needs the talent");
  });
});

describe("spending XP", () => {
  test("XP is shared by the party and each member spends their own", () => {
    const s = party().commit([xp(30)]);
    expect(xpAvailable(s.state.actors.pc!.sheet)).toBe(30);
    expect(xpAvailable(s.state.actors.mira!.sheet)).toBe(30);
    s.commit(unwrap(buyAdvancement(s.state, "pc", { kind: "attribute", id: "end" }, content, defaultTuning)));
    const pc = s.state.actors.pc!.sheet;
    expect(pc.attributes.end).toBe(7);
    expect(pc.derived.hpMax).toBe(defaultTuning.derived.hpBase + 7 * defaultTuning.derived.hpPerEnd);
    expect(pc.status.hp).toBe(pc.derived.hpMax);
    expect(xpAvailable(pc)).toBe(30 - 28);
    expect(xpAvailable(s.state.actors.mira!.sheet)).toBe(30);
    // Skills rise by 5 trained points; a new field skill starts at +10.
    s.commit(
      unwrap(buyAdvancement(s.state, "mira", { kind: "skill", id: "core:melee" }, content, defaultTuning)),
    );
    s.commit(
      unwrap(
        buyAdvancement(
          s.state,
          "mira",
          { kind: "fieldSkill", id: "core:lore/history" },
          content,
          defaultTuning,
        ),
      ),
    );
    expect(s.state.actors.mira!.sheet.skills).toEqual({
      "core:melee": { trained: 5 },
      "core:lore/history": { trained: 10 },
    });
  });
  test("a use-based campaign can't buy with XP, only spend chapter and arc grants", () => {
    const s = party("useBased").commit([xp(30)]);
    expect(priceOf(s.state, "pc", { kind: "skill", id: "core:melee" }, content, defaultTuning).ok).toBe(
      false,
    );
    s.commit(closeEvents(s.state, "arc", content, defaultTuning));
    expect(s.state.actors.pc!.sheet.progression.pendingAttributes).toBe(1);
    s.commit(unwrap(buyAdvancement(s.state, "pc", { kind: "attribute", id: "str" }, content, defaultTuning)));
    expect(s.state.actors.pc!.sheet.attributes.str).toBe(6);
    expect(s.state.actors.pc!.sheet.progression.pendingAttributes).toBe(0);
  });
});

describe("awards (engine-side, never narration)", () => {
  test("quest stages, won fights and new regions award XP; hybrid earns half", () => {
    const s = party();
    s.commit([
      draft("QuestStarted", {
        quest: {
          id: "quest:main",
          title: "The Drowned Bell",
          kind: "main",
          stages: [
            { id: "s1", summary: "Find it", objectives: [{ kind: "narrative", description: "find" }] },
            { id: "s2", summary: "Ring it", objectives: [{ kind: "narrative", description: "ring" }] },
          ],
        },
      } as never),
    ]);
    const before = s.state;
    const turn: EventDraft[] = [
      draft("QuestObjectiveMet", { questId: "quest:main", stage: 0, objective: 0, evidence: "x" }),
    ];
    s.commit(turn);
    const awards = turnAwards(before, s.state, turn, () => undefined, defaultTuning);
    expect(awards.map((a) => (a.payload as { amount: number }).amount)).toEqual([8]);
    const region = [
      draft("KnowledgeGained", { entityId: "region:x", entry: { how: "public", gameTime: 0 } }),
    ];
    expect(turnAwards(s.state, s.state, region, () => "region", defaultTuning)[0]!.payload).toMatchObject({
      amount: 2,
    });
    const hybrid = party("hybrid");
    expect(
      turnAwards(hybrid.state, hybrid.state, region, () => "region", defaultTuning)[0]!.payload,
    ).toMatchObject({
      amount: 1,
    });
    expect(closeEvents(s.state, "chapter", content, defaultTuning)[0]!.payload).toMatchObject({
      amount: 2,
      source: "chapter",
    });
  });
});

describe("use-based improvement", () => {
  const check = (degree: string, over: Record<string, unknown> = {}) =>
    draft("CheckResolved", {
      actorId: "pc",
      request: { kind: "skill", skill: "core:melee", difficulty: "normal" },
      module: "d100",
      prepared: {
        label: "Melee",
        skillValue: 45,
        difficulty: "normal",
        modifiers: [],
        modifierTotal: 0,
        netBoons: 0,
      },
      result: { degree, margin: 0, rolls: [20], display: { text: "x" } },
      effective: { degree, margin: 0, rolls: [20], display: { text: "x" } },
      attempt: "initial",
      inCombat: true,
      rngAfter: [1, 2, 3, 4],
      ...over,
    } as never);
  test("a success with real stakes marks the skill once; easy, safe or Luck-rerolled successes don't", () => {
    const s = party("useBased");
    expect(turnMarks(s.state, [check("success"), check("success")])).toHaveLength(1);
    expect(turnMarks(s.state, [check("failure")])).toHaveLength(0);
    expect(turnMarks(s.state, [check("success", { inCombat: false })])).toHaveLength(0);
    expect(turnMarks(s.state, [check("success", { attempt: "luck" })])).toHaveLength(0);
    expect(turnMarks(party("classless").state, [check("success")])).toHaveLength(0);
  });
  test("improvement rolls d100 per marked skill, gains 1d10 above the value, then clears the marks", () => {
    const s = party("useBased");
    s.commit([draft("SkillMarked", { actorId: "pc", skillId: "core:melee" })]);
    const [roll] = improvementRolls(s.state, "rest", content, defaultTuning);
    const result = (roll!.payload as { results: { roll: number; gain: number }[] }).results[0]!;
    const value = 30 + 5 * 3;
    expect(result.gain > 0).toBe(result.roll > value || result.roll >= 96);
    s.commit([roll!]);
    expect(s.state.actors.pc!.sheet.progression.marks).toEqual([]);
    expect(s.state.actors.pc!.sheet.skills["core:melee"]!.trained).toBe(30 + result.gain);
    // Two chapter closes grant a talent.
    s.commit(closeEvents(s.state, "chapter", content, defaultTuning));
    s.commit(closeEvents(s.state, "chapter", content, defaultTuning));
    expect(s.state.actors.pc!.sheet.progression.pendingTalents).toBe(1);
  });
});

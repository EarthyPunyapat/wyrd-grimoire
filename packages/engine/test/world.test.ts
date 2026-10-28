import { describe, expect, test } from "bun:test";
import { draft, SceneState } from "@wyrd/core";
import { unwrap } from "../src/result.ts";
import { resolveTurn, type TurnContext, validateTurn } from "../src/turns.ts";
import { calendarOf, runTicks } from "../src/world/index.ts";
import { attrs } from "./fixtures.ts";
import { ctx as rules, Sim } from "./sim.ts";

const NAMES: Record<string, string> = {
  pc: "Wren",
  "npc:guard": "Sergeant Holt",
  "npc:captain": "Captain Vey",
  "npc:baker": "Mira",
};
const ctx = {
  ...rules,
  nameOf: (id: string) => NAMES[id] ?? id,
  items: { weapons: {}, armor: {}, gear: {} },
  bodyPlans: {},
  creatures: {},
  combatInfo: () => ({}),
  kindOf: (id: string) => (id.startsWith("npc:") ? "npc" : "location"),
} as TurnContext;

function town(seed = 5) {
  const s = new Sim({}, seed);
  s.addActor("pc", "pc", { attributes: attrs({ pre: 7 }), skills: { "core:deception": { trained: 40 } } });
  s.commit([
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: "scene-1",
        locationId: "loc:gate",
        zones: [{ id: "z:gate", name: "the gate" }],
        positions: { pc: "z:gate", "npc:guard": "z:gate" },
        openedAt: 0,
      }),
    }),
    draft("RelationshipChanged", {
      edge: { from: "npc:guard", to: "npc:captain", type: "reportsTo", strength: 0.9 },
    }),
    draft("RelationshipChanged", {
      edge: { from: "npc:baker", to: "npc:guard", type: "friend", strength: 0.3 },
    }),
  ]);
  return s;
}

const turn = (s: Sim, actions: unknown[]) => {
  const v = validateTurn(s.state, "pc", actions, ctx);
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  s.commit(unwrap(resolveTurn(s.state, v.value, ctx, "c")).events);
};

describe("who knows what (spec 07)", () => {
  test("lying to a guard reaches his captain along reportsTo within days", () => {
    const s = town();
    turn(s, [
      {
        type: "talk",
        targetId: "npc:guard",
        utterance: "I was never at the warehouse last night.",
        approach: "deceive",
      },
    ]);
    const told = s.state.minds["npc:guard"]!.memories.find((m) => m.kind === "told")!;
    expect(told.false).toBe(true);
    expect(told.content).toContain("never at the warehouse");
    expect(Object.values(s.state.rumors)).toHaveLength(1);
    expect(s.state.minds["npc:captain"]).toBeUndefined();
    for (let day = 0; day < 4 && !s.state.minds["npc:captain"]; day++)
      for (let i = 0; i < 3; i++) turn(s, [{ type: "wait", minutes: 480 }]);
    const heard = s.state.minds["npc:captain"]!.memories.find((m) => m.kind === "heard")!;
    expect(heard.sourceId).toBe("npc:guard");
    expect(heard.false).toBe(true);
    expect(heard.content).toMatch(/Sergeant Holt told me/);
    expect(heard.about).toContain("pc");
  });

  test("a failed lie costs trust; the PC learns who they met", () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = town(seed);
      turn(s, [
        { type: "talk", targetId: "npc:guard", utterance: "I'm the mayor's cousin.", approach: "deceive" },
      ]);
      const told = s.state.minds["npc:guard"]!.memories[0]!;
      if (told.belief > 0.5) continue;
      expect(s.state.minds["npc:guard"]!.dispositions.pc!.trust).toBe(30);
      expect(s.state.knowledge.entities["npc:guard"]?.how).toBe("witnessed");
      expect(s.state.knowledge.entities["loc:gate"]).toBeDefined();
      return;
    }
    throw new Error("no seed failed the lie");
  });

  test("ticks: calendar, one daily tick per day crossed, deterministic replay", () => {
    const c = calendarOf(1440 * 31 + 60 * 20, rules.tuning.world);
    expect([c.month, c.day, c.hour, c.timeOfDay]).toEqual([2, 2, 20, "night"]);
    const s = town();
    s.commit([draft("TimeAdvanced", { minutes: 1440 * 3, reason: "test" })]);
    const drafts = runTicks(s.state, ctx);
    expect(drafts.filter((d) => d.type === "TickCompleted" && d.payload.kind === "day")).toHaveLength(3);
    expect(runTicks(s.state, ctx)).toEqual(drafts);
    s.commit(drafts);
    expect(runTicks(s.state, ctx)).toEqual([]);
  });

  test("the threat clock advances with time only in Threat Clock mode", () => {
    const s = town();
    s.commit([
      draft("ClockCreated", {
        clock: {
          id: "clock:threat",
          name: "The Drowned King wakes",
          kind: "threat",
          segments: 12,
          filled: 0,
          paceDays: 2,
          visible: true,
        },
      }),
      draft("ThreatCreated", {
        threat: {
          name: "The Drowned King",
          nature: "a waking god",
          motive: "hunger",
          paths: [{ id: "p1", name: "Seal the tomb", description: "" }],
          clockId: "clock:threat",
          stage: 0,
          stages: 4,
          defeated: false,
        },
      }),
      draft("TimeAdvanced", { minutes: 1440 * 10, reason: "test" }),
    ]);
    s.commit(runTicks(s.state, ctx));
    expect(s.state.clocks["clock:threat"]!.filled).toBe(5);
    expect(s.state.threat!.stage).toBe(1);
  });
});

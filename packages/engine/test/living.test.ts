import { describe, expect, test } from "bun:test";
import { CalendarDef, draft, NamingStyleDef } from "@wyrd/core";
import { runTicks, type WorldContext } from "../src/world/index.ts";
import { ctx as rules, Sim } from "./sim.ts";

/**
 * M7 acceptance: "Living World runs a month of in-game time with visible faction events and news."
 * The engine owns the whole month; the test commits one day at a time and reads the projection.
 */

const NAMES: Record<string, string> = {
  pc: "Wren",
  "f:guild": "the Salt Guild",
  "f:crown": "the Crown",
};
const ctx: WorldContext = {
  ...rules,
  nameOf: (id) => NAMES[id] ?? id,
  calendar: CalendarDef.parse({
    days: ["Emberday", "Reedday", "Stoneday", "Moorday", "Highday", "Lowday", "Sunday"],
    months: [
      { name: "Thaw", days: 30, season: "spring" },
      { name: "Highsun", days: 30, season: "summer" },
    ],
    festivals: [{ id: "first-tide", name: "First Tide", month: 1, day: 15, description: "Boats return." }],
  }),
  naming: [
    NamingStyleDef.parse({
      id: "riverfolk",
      name: "Riverfolk",
      given: ["Bera", "Ansel", "Mira", "Corin"],
      family: ["Reed", "Ash", "Vale"],
    }),
  ],
  namesTaken: () => ["Wren"],
  npcs: () => [
    { id: "npc:bera", name: "Bera", age: 71, role: "smith", factionId: "f:guild" },
    { id: "npc:ansel", name: "Ansel", age: 32, role: "clerk", factionId: "f:guild" },
    { id: "npc:mira", name: "Mira", age: 29, role: "baker", factionId: "f:crown" },
    { id: "npc:corin", name: "Corin", age: 44, role: "guard", factionId: "f:crown" },
  ],
};

function month() {
  const s = new Sim({ story: { mode: "livingWorld" } }, 9);
  s.addActor("pc", "pc");
  s.commit([
    draft("FactionUpdated", {
      faction: {
        id: "f:guild",
        reputation: 10,
        resources: { wealth: 4, military: 2, influence: 3 },
        relations: { "f:crown": -40 },
        goalClockIds: ["clock:guild"],
      },
    }),
    draft("FactionUpdated", {
      faction: {
        id: "f:crown",
        reputation: 0,
        resources: { wealth: 5, military: 4, influence: 3 },
        relations: { "f:guild": -40 },
        goalClockIds: ["clock:crown"],
      },
    }),
    draft("ClockCreated", {
      clock: {
        id: "clock:guild",
        name: "Open the river road",
        kind: "faction",
        segments: 2,
        filled: 0,
        ownerId: "f:guild",
        visible: false,
      },
    }),
    draft("ClockCreated", {
      clock: {
        id: "clock:crown",
        name: "Tax the ferry",
        kind: "faction",
        segments: 3,
        filled: 0,
        ownerId: "f:crown",
        visible: false,
      },
    }),
    draft("ClockCreated", {
      clock: {
        id: "clock:threat",
        name: "The Drowned King wakes",
        kind: "threat",
        segments: 12,
        filled: 0,
        paceDays: 1,
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
  ]);
  return s;
}

describe("Living World (spec 06)", () => {
  test("a month of in-game time produces faction events, news, festivals and a job board", () => {
    const s = month();
    for (let day = 1; day <= 30; day++) {
      s.commit([draft("TimeAdvanced", { minutes: 1440, reason: "test month" })]);
      s.commit(runTicks(s.state, ctx));
    }
    const living = s.state.living!;
    const news = Object.values(living.news);
    expect(news.some((n) => n.kind === "faction")).toBe(true);
    expect(news.some((n) => n.kind === "festival")).toBe(true);
    expect(living.festivalsHeld).toContain("first-tide:1");
    expect(living.jobBoard.length).toBeGreaterThan(0);
    // Goals complete and are replaced, so every faction's active aim is still unfinished.
    for (const f of Object.values(s.state.factions)) {
      for (const id of f.goalClockIds) {
        const clock = s.state.clocks[id]!;
        expect(clock.filled).toBeLessThan(clock.segments);
      }
    }
    expect(Object.values(s.state.clocks).filter((c) => c.kind === "faction").length).toBeGreaterThanOrEqual(
      2,
    );
    // News stays bounded.
    expect(news.length).toBeLessThanOrEqual(rules.tuning.living.maxNews);
    // The threat clock is frozen while the world lives.
    expect(s.state.clocks["clock:threat"]!.filled).toBe(0);
    expect(s.state.threat!.stage).toBe(0);
  });

  test("an NPC's week can bring a marriage, retirement or death of old age", () => {
    const s = month();
    for (let day = 1; day <= 60; day++) {
      s.commit([draft("TimeAdvanced", { minutes: 1440, reason: "test months" })]);
      s.commit(runTicks(s.state, ctx));
    }
    const lives = s.state.living!.lives;
    expect(Object.keys(lives).length).toBeGreaterThan(0);
    expect(Object.values(lives).some((l) => l.marriedTo !== undefined || l.retired || l.dead)).toBe(true);
  });

  test("the tick is deterministic: replaying the same state gives the same events", () => {
    const s = month();
    s.commit([draft("TimeAdvanced", { minutes: 1440 * 14, reason: "test" })]);
    const first = runTicks(s.state, ctx);
    expect(first.length).toBeGreaterThan(0);
    expect(runTicks(s.state, ctx)).toEqual(first);
  });
});

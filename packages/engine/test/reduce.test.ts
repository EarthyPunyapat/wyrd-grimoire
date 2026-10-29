import { describe, expect, test } from "bun:test";
import { draft, EVENT_TYPES, type EventEnvelope } from "@wyrd/core";
import fc from "fast-check";
import { pushCheck, resolveCheck } from "../src/checks.ts";
import { applyCondition, removeCondition } from "../src/conditions.ts";
import { regainLuck, spendLuckReroll } from "../src/luck.ts";
import { fold, HANDLED_EVENT_TYPES, reduce } from "../src/reduce.ts";
import { changeSettings } from "../src/settings.ts";
import { attrs } from "./fixtures.ts";
import { ctx, envelope, Sim } from "./sim.ts";

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

describe("reducer", () => {
  test("handles every event type in the core registry", () => {
    expect([...HANDLED_EVENT_TYPES].sort()).toEqual([...EVENT_TYPES].sort());
  });

  test("the first event must be CampaignCreated, and only the first", () => {
    const s = new Sim();
    const time = envelope(draft("TimeAdvanced", { minutes: 5, reason: "wait" }), 2, 0);
    expect(() => reduce(undefined, time)).toThrow(/CampaignCreated/);
    expect(() => reduce(s.state, s.events[0]!)).toThrow(/first event/);
  });

  test("unknown event types throw by default and are skipped with a warning in production", () => {
    const s = new Sim();
    const weird = { ...s.events[0]!, type: "FutureThing", seq: 2 } as unknown as EventEnvelope;
    expect(() => reduce(s.state, weird)).toThrow(/Unknown event type/);
    const warnings: string[] = [];
    expect(reduce(s.state, weird, { onUnknown: "skip", warn: (m) => warnings.push(m) })).toBe(s.state);
    expect(warnings[0]).toContain("FutureThing");
  });

  test("never mutates state or events", () => {
    const s = new Sim();
    s.addActor("pc", "pc");
    const state = deepFreeze(structuredClone(s.state));
    const out = resolveCheck(
      state,
      { actorId: "pc", skill: "core:stealth", difficulty: "hard", purpose: "x" },
      ctx,
    );
    if (!out.ok) throw new Error("check failed");
    const events = out.value.events.map((d, i) => deepFreeze(envelope(d, s.events.length + 1 + i, 0)));
    expect(() => fold(events, state)).not.toThrow();
    expect(state).toEqual(s.state);
  });

  test("time advances game time", () => {
    const s = new Sim();
    s.commit([draft("TimeAdvanced", { minutes: 90, reason: "search the library" })]);
    expect(s.state.campaign.gameTime).toBe(90);
  });

  test("renaming changes only the campaign name, and replays from the log", () => {
    const s = new Sim();
    const before = s.state;
    s.commit([draft("CampaignRenamed", { name: "The Long Night" })]);
    expect(s.state.campaign.name).toBe("The Long Night");
    expect(s.state.campaign.id).toBe(before.campaign.id);
    expect(s.state.actors).toEqual(before.actors);
    expect(fold(s.events, undefined).campaign.name).toBe("The Long Night");
  });
});

/** One step a random walk may take; invalid steps (e.g. pushing a success) are simply skipped. */
type Command =
  | {
      kind: "check";
      actor: "pc" | "npc";
      skill: string;
      difficulty: "easy" | "normal" | "hard";
      boons: number;
    }
  | { kind: "push" }
  | { kind: "luck" }
  | { kind: "regain"; arc: boolean }
  | { kind: "condition"; id: "core:prone" | "core:inspired" | "core:concussed"; on: boolean }
  | { kind: "time"; minutes: number }
  | { kind: "math"; on: boolean };

const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    kind: fc.constant("check" as const),
    actor: fc.constantFrom("pc" as const, "npc" as const),
    skill: fc.constantFrom("core:stealth", "core:melee", "core:perception", "core:lore/history"),
    difficulty: fc.constantFrom("easy" as const, "normal" as const, "hard" as const),
    boons: fc.integer({ min: 0, max: 2 }),
  }),
  fc.constant({ kind: "push" as const }),
  fc.constant({ kind: "luck" as const }),
  fc.record({ kind: fc.constant("regain" as const), arc: fc.boolean() }),
  fc.record({
    kind: fc.constant("condition" as const),
    id: fc.constantFrom("core:prone" as const, "core:inspired" as const, "core:concussed" as const),
    on: fc.boolean(),
  }),
  fc.record({ kind: fc.constant("time" as const), minutes: fc.integer({ min: 1, max: 600 }) }),
  fc.record({ kind: fc.constant("math" as const), on: fc.boolean() }),
);

/** Runs commands through the real engine API and returns the resulting event log. */
function play(seed: number, commands: Command[]): EventEnvelope[] {
  const s = new Sim({}, seed);
  s.addActor("pc", "pc", {
    attributes: attrs({ agi: 7, int: 6 }),
    skills: { "core:stealth": { trained: 30 } },
  });
  s.addActor("npc", "npc");
  for (const c of commands) {
    const r = (() => {
      switch (c.kind) {
        case "check":
          return resolveCheck(
            s.state,
            { actorId: c.actor, skill: c.skill, difficulty: c.difficulty, boons: c.boons, purpose: "walk" },
            ctx,
          );
        case "push":
          return pushCheck(s.state, "pc", ctx);
        case "luck":
          return spendLuckReroll(s.state, "pc", ctx);
        case "regain":
          return regainLuck(s.state, "pc", c.arc ? "arcClosed" : "chapterClosed", ctx);
        case "condition":
          return c.on ? applyCondition(s.state, "pc", { id: c.id }) : removeCondition(s.state, "pc", c.id);
        case "time":
          return {
            ok: true as const,
            value: [draft("TimeAdvanced", { minutes: c.minutes, reason: "walk" })],
          };
        case "math":
          return changeSettings(s.state, { narration: { showMath: c.on } });
      }
    })();
    if (!r.ok) continue;
    s.commit(Array.isArray(r.value) ? r.value : r.value.events);
  }
  return s.events;
}

/** A snapshot is state serialised and read back, exactly what storage stores. */
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("reducer properties", () => {
  const walk = fc.tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.array(command, { maxLength: 60 }));

  test("folding the same events always gives the same state", () => {
    fc.assert(
      fc.property(walk, ([seed, cmds]) => {
        const events = play(seed, cmds);
        expect(fold(roundTrip(events))).toEqual(fold(events));
        // The engine API itself is deterministic: the same commands give the same log.
        expect(play(seed, cmds)).toEqual(events);
      }),
      { numRuns: 100 },
    );
  });

  test("snapshot + replay equals full replay", () => {
    fc.assert(
      fc.property(walk, fc.nat(), ([seed, cmds], cut) => {
        const events = play(seed, cmds);
        const n = 1 + (cut % events.length);
        const snapshot = roundTrip(fold(events.slice(0, n)));
        expect(fold(events.slice(n), snapshot)).toEqual(fold(events));
      }),
      { numRuns: 100 },
    );
  });

  test("rewinding to seq N and replaying the same events reproduces the branch", () => {
    fc.assert(
      fc.property(walk, fc.nat(), ([seed, cmds], cut) => {
        const events = play(seed, cmds);
        const n = 1 + (cut % events.length);
        const rewound = fold(events.slice(0, n));
        // The fork re-applies the original branch's later events with new seqs on a new branch.
        const forked = events
          .slice(n)
          .map((e, i) => ({ ...e, branchId: "fork", seq: n + 1 + i, id: `f${i}` }));
        expect(fold(forked, rewound)).toEqual(fold(events));
      }),
      { numRuns: 100 },
    );
  });
});

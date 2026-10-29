import { expect, test } from "bun:test";
import { defaultTuning, draft, Fact } from "@wyrd/core";
import { assignTask, delegationTasks } from "../src/delegation.ts";
import { reduce } from "../src/reduce.ts";
import { unwrap } from "../src/result.ts";
import { changeWatch, runSkip, watchedIds } from "../src/skips.ts";
import { runTicks, type WorldContext } from "../src/world/ticks.ts";
import { ctx, Sim } from "./sim.ts";

const world: WorldContext = {
  ...ctx,
  nameOf: (id) => id,
  regions: () => [{ id: "region:test", climate: "temperate" }],
};
function setup() {
  const s = new Sim({ story: { mode: "livingWorld" } }, 17);
  s.addActor("pc", "pc");
  return s;
}
const skip = (s: Sim, args: unknown, context = world) => {
  const result = unwrap(runSkip(s.state, args, context, "skip:1"));
  s.commit(result.events);
  return result.digest;
};
function canon(s: Sim, segments = 3) {
  s.commit([
    draft("ClockCreated", {
      clock: {
        id: "clock:fall",
        name: "PRIVATE FUTURE",
        kind: "canon",
        segments,
        filled: 0,
        paceDays: 1,
        visible: false,
        canon: {
          startedAt: 0,
          outcome: { entityId: "gate", predicate: "fallen", value: true },
          intervention: { entityId: "gate", predicate: "saved" },
        },
      },
    }),
  ]);
}
function companion(s: Sim, due = 2 * 1440, opposition = 18) {
  const sheet = s.addActor("ari", "npc", { level: 20 });
  s.commit([draft("CompanionJoined", { companionId: "ari", reason: "test", sheet })]);
  s.commit(
    unwrap(
      assignTask(
        s.state,
        { id: "clones", assignee: "ari", goal: "Finish the clones", due, opposition: { level: opposition } },
        ctx,
      ),
    ),
  );
}

test("a month equals 30 daily world advances and four weekly ticks, including RNG and replay", () => {
  const a = setup();
  const b = setup();
  const digest = skip(a, { duration: "a month" });
  for (let day = 0; day < 30; day++) {
    b.commit([draft("TimeAdvanced", { minutes: 1440, reason: "test" })]);
    b.commit(runTicks(b.state, world));
  }
  expect(a.state.campaign).toEqual(b.state.campaign);
  expect(a.state.calendar).toEqual(b.state.calendar);
  expect(a.state.living).toEqual(b.state.living);
  expect(digest.days).toBe(30);
  expect(digest.weeks).toBe(4);
  expect(digest.stop).toBe("duration");
  expect(a.events.filter((e) => e.type === "TickCompleted" && e.payload.kind === "day")).toHaveLength(30);
  expect(a.events.reduce((state, e) => reduce(state, e), undefined! as typeof a.state)).toEqual(a.state);
});

test("watches replay idempotently and each gets a bounded quiet report", () => {
  const s = setup();
  s.commit(unwrap(changeWatch(s.state, "pc", true, defaultTuning)));
  s.commit(unwrap(changeWatch(s.state, "pc", true, defaultTuning)));
  s.commit([draft("KnowledgeGained", { entityId: "gate", entry: { how: "public", gameTime: 0 } })]);
  s.commit(unwrap(changeWatch(s.state, "gate", true, defaultTuning)));
  const digest = skip(s, { duration: "1 day" });
  expect(watchedIds(s.state)).toEqual(["pc", "gate"]);
  expect(digest.reports.map((r) => r.entityId)).toEqual(["pc", "gate"]);
  expect(digest.reports.every((r) => r.body.includes("No notable"))).toBe(true);
  s.commit(unwrap(changeWatch(s.state, "pc", false, defaultTuning)));
  expect(watchedIds(s.state)).toEqual(["gate"]);
  expect(changeWatch(s.state, "unknown", true, defaultTuning).ok).toBe(false);
});

test("until task completion advances canon characters daily and stops when the task really ends", () => {
  const s = setup();
  companion(s);
  s.commit([
    draft("CanonActorConfigured", {
      profile: {
        entityId: "ari",
        worldId: "world:main",
        motivation: "PRIVATE MOTIVE",
        action: "PRIVATE ROUTINE",
        paceDays: 1,
        startedAt: 0,
      },
    }),
  ]);
  const d = skip(s, { until: { taskIds: ["clones"] } });
  expect(d.stop).toBe("condition");
  expect(d.to).toBe(2880);
  expect(delegationTasks(s.state)[0]?.status).toBe("done");
  expect(s.events.filter((e) => e.type === "CanonActorActed")).toHaveLength(2);
  expect(JSON.stringify(d)).not.toContain("PRIVATE");
});

test("a watched major task event interrupts on its first day, with tunable severity", () => {
  for (const severity of ["major", "critical"] as const) {
    const s = setup();
    companion(s);
    s.commit(unwrap(changeWatch(s.state, "ari", true, defaultTuning)));
    const d = skip(
      s,
      { duration: "5 days" },
      {
        ...world,
        tuning: { ...defaultTuning, skips: { ...defaultTuning.skips, interruptSeverity: severity } },
      },
    );
    expect(d.stop).toBe(severity === "major" ? "watched" : "duration");
    expect(d.to).toBe((severity === "major" ? 2 : 5) * 1440);
    expect(d.reports[0]?.body).toContain("task completed");
  }
});

test("canon stops in its last pending segment, before any outcome can resolve", () => {
  const s = setup();
  canon(s);
  const d = skip(s, { duration: "30 days" });
  expect(d.stop).toBe("canon");
  expect(d.to).toBe(2880);
  expect(s.state.clocks["clock:fall"]!.filled).toBe(2);
  expect(s.events.some((e) => e.type === "CanonClockResolved")).toBe(false);
  expect(JSON.stringify(d)).not.toContain("PRIVATE FUTURE");
  expect(skip(s, { duration: "1 day" }).to).toBe(2880);
});

test("a valid intervention lets canon resolve averted; other-world or retracted facts do not", () => {
  for (const valid of [true, false]) {
    const s = setup();
    canon(s);
    const fact = Fact.parse({
      id: "saved",
      entityId: "gate",
      predicate: "saved",
      value: true,
      source: "player",
      worldId: valid ? "world:main" : "world:other",
    });
    const d = skip(s, { duration: "4 days" }, { ...world, factsAbout: () => [fact] });
    expect(d.stop).toBe(valid ? "duration" : "canon");
    expect(s.events.find((e) => e.type === "CanonClockResolved")?.payload.status).toBe(
      valid ? "averted" : undefined,
    );
  }
});

test("blocked tasks interrupt at their due boundary, including legacy minute skips", () => {
  const s = setup();
  companion(s, 60, 22);
  const d = skip(s, { minutes: 180, reason: "wait" });
  expect(d.stop).toBe("task");
  expect(d.to).toBe(60);
  expect(delegationTasks(s.state)[0]?.status).toBe("blocked");
  expect(skip(s, { duration: "1 day" }).to).toBe(60);
});

test("conditions are checked against current facts and bounded when unmet", () => {
  const s = setup();
  const context = { ...world, tuning: { ...defaultTuning, skips: { ...defaultTuning.skips, maxDays: 2 } } };
  expect(skip(s, { until: { entityId: "gate", predicate: "opened", value: true } }, context).stop).toBe(
    "limit",
  );
  const fact = Fact.parse({
    id: "open",
    entityId: "gate",
    predicate: "opened",
    value: true,
    source: "player",
  });
  const d = skip(
    s,
    { until: { entityId: "gate", predicate: "opened", value: true } },
    { ...context, factsAbout: () => [fact] },
  );
  expect(d.stop).toBe("condition");
  expect(d.from).toBe(d.to);
});

test("invalid durations, unknown task conditions, combat and dead PCs never advance", () => {
  const s = setup();
  for (const args of [
    {},
    { duration: -1 },
    { duration: "infinity" },
    { duration: "999999 years" },
    { duration: "1 day", until: { taskIds: ["missing"] } },
    { until: { taskIds: ["missing"] } },
  ])
    expect(runSkip(s.state, args, world, "skip").ok).toBe(false);
  s.state.combat = {} as NonNullable<typeof s.state.combat>;
  expect(runSkip(s.state, { duration: "1 day" }, world, "skip").ok).toBe(false);
  s.state.combat = null;
  s.commit([draft("ActorDied", { actorId: "pc", cause: "test" })]);
  expect(runSkip(s.state, { duration: "1 day" }, world, "skip").ok).toBe(false);
});

test("a watched faction achieving its goal is a major event on the first weekly boundary", () => {
  const s = setup();
  s.commit([
    draft("KnowledgeGained", { entityId: "faction:keepers", entry: { how: "public", gameTime: 0 } }),
    draft("ClockCreated", {
      clock: {
        id: "goal",
        name: "PRIVATE AIM",
        kind: "faction",
        segments: 1,
        filled: 1,
        visible: false,
        ownerId: "faction:keepers",
      },
    }),
    draft("FactionUpdated", {
      faction: {
        id: "faction:keepers",
        reputation: 0,
        resources: { wealth: 2, military: 2, influence: 2 },
        relations: {},
        goalClockIds: ["goal"],
      },
    }),
  ]);
  s.commit(unwrap(changeWatch(s.state, "faction:keepers", true, defaultTuning)));
  const d = skip(s, { duration: "30 days" });
  expect(d.stop).toBe("watched");
  expect(d.to).toBe(7 * 1440);
  expect(d.reports[0]?.body).toContain("faction goal");
  expect(JSON.stringify(d)).not.toContain("PRIVATE AIM");
});

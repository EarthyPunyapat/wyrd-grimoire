import { expect, test } from "bun:test";
import { draft, Fact } from "@wyrd/core";
import { reduce } from "../src/reduce.ts";
import { runTicks } from "../src/world/ticks.ts";
import { ctx, Sim } from "./sim.ts";

function setup() {
  const s = new Sim({ story: { mode: "livingWorld" } });
  s.commit([
    draft("ClockCreated", {
      clock: {
        id: "clock:fall",
        name: "The gate falls",
        kind: "canon",
        segments: 2,
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
  return s;
}

test("canon clocks catch up with elapsed time, resolve once, and replay", () => {
  const s = setup();
  s.commit([draft("TimeAdvanced", { minutes: 3 * 1440, reason: "wait" })]);
  const events = runTicks(s.state, { ...ctx, nameOf: (id) => id });
  expect(events.filter((e) => e.type === "CanonClockResolved")).toHaveLength(1);
  expect(events.some((e) => e.type === "FactAsserted" && e.payload.fact.predicate === "fallen")).toBe(true);
  s.commit(events);
  expect(s.state.clocks["clock:fall"]!.filled).toBe(2);
  expect(runTicks(s.state, { ...ctx, nameOf: (id) => id })).toEqual([]);
  expect(s.events.reduce((state, event) => reduce(state, event), undefined! as typeof s.state)).toEqual(
    s.state,
  );
});

test("an intervention fact cancels canon, but another world's fact does not", () => {
  for (const worldId of ["world:main", "world:other"]) {
    const s = setup();
    const fact = Fact.parse({
      id: "saved",
      entityId: "gate",
      predicate: "saved",
      value: true,
      source: "player",
      worldId,
    });
    s.commit([draft("TimeAdvanced", { minutes: 2 * 1440, reason: "wait" })]);
    const events = runTicks(s.state, { ...ctx, nameOf: (id) => id, factsAbout: () => [fact] });
    const result = events.find((e) => e.type === "CanonClockResolved");
    expect(result?.payload.status).toBe(worldId === "world:main" ? "averted" : "occurred");
    expect(events.some((e) => e.type === "FactAsserted")).toBe(worldId !== "world:main");
  }
});

test("canon characters pursue in-character aims without a player turn", () => {
  const s = new Sim();
  s.commit([
    draft("CanonActorConfigured", {
      profile: {
        entityId: "npc:watcher",
        worldId: "world:main",
        motivation: "Protect the gate",
        action: "Patrols the gate",
        paceDays: 1,
        startedAt: 0,
      },
    }),
  ]);
  s.commit([draft("TimeAdvanced", { minutes: 1440, reason: "sleep" })]);
  s.commit(runTicks(s.state, { ...ctx, nameOf: (id) => id }));
  expect(s.state.minds["npc:watcher"]?.memories[0]?.content).toContain("Patrols the gate");
  expect(s.events.filter((e) => e.type === "CanonActorActed")).toHaveLength(1);
  expect(runTicks(s.state, { ...ctx, nameOf: (id) => id })).toEqual([]);
});

test("retracted evidence cannot avert canon; dead characters stop acting", () => {
  const s = setup();
  s.commit([draft("TimeAdvanced", { minutes: 1440 * 90, reason: "a season passes" })]);
  const events = runTicks(s.state, {
    ...ctx,
    nameOf: (id) => id,
    factsAbout: () => [
      Fact.parse({
        id: "old",
        entityId: "gate",
        predicate: "saved",
        value: true,
        source: "player",
        retracted: true,
      }),
    ],
  });
  expect(events.find((e) => e.type === "CanonClockResolved")?.payload.status).toBe("occurred");
  const npc = new Sim();
  npc.commit([
    draft("CanonActorConfigured", {
      profile: {
        entityId: "npc:watcher",
        worldId: "world:main",
        motivation: "Guard the gate",
        action: "Patrols",
        paceDays: 1,
        startedAt: 0,
      },
    }),
    draft("TimeAdvanced", { minutes: 1440, reason: "day" }),
  ]);
  expect(
    runTicks(npc.state, { ...ctx, nameOf: (id) => id, entityActive: () => false }).some(
      (e) => e.type === "CanonActorActed",
    ),
  ).toBe(false);
});

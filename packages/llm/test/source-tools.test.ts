import { afterEach, expect, test } from "bun:test";
import { draft, type EventDraft, Fact } from "@wyrd/core";
import { executeTool } from "../src/gm/tools.ts";
import { makeTurnContext } from "../src/pipeline.ts";
import { gmFixture, rules } from "./gm-fixture.ts";

const fixtures: ReturnType<typeof gmFixture>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.close();
});
test("source timeline exposes GM clock ids; interventions require real, current evidence", async () => {
  const f = gmFixture();
  fixtures.push(f);
  f.store.append([
    draft("ClockCreated", {
      clock: {
        id: "clock:gate",
        name: "Gate falls",
        kind: "canon",
        segments: 2,
        filled: 0,
        visible: false,
        canon: { startedAt: 0, outcome: { entityId: "loc:ferry", predicate: "fallen", value: true } },
      },
    }),
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "f:intervention",
        entityId: "loc:ferry",
        predicate: "reinforced",
        value: "The PC braces the gate",
        source: "player",
        pinned: true,
      }),
    }),
  ]);
  const run = (name: string, args: unknown) =>
    executeTool(
      { id: "test", name, args },
      {
        state: f.store.state(),
        pcId: "pc",
        turnId: "t",
        canon: f.canon,
        ctx: makeTurnContext(f.store.state(), f.canon, rules),
        items: { weapons: {}, armor: {}, gear: {} },
        newId: () => "id",
      },
    );
  const timeline = await run("source_timeline", {});
  expect(timeline.ok).toBe(true);
  expect(timeline.result).toContain("clock:gate");
  expect((await run("intervene_canon", { clockId: "clock:gate", factId: "made-up" })).ok).toBe(false);
  const intervened = await run("intervene_canon", { clockId: "clock:gate", factId: "f:intervention" });
  expect(intervened.ok).toBe(true);
  expect(intervened.effects.drafts[0]?.type).toBe("CanonClockIntervened");
});

test("same-turn intervention facts are accepted before projections commit", async () => {
  const f = gmFixture();
  fixtures.push(f);
  f.store.append([
    draft("ClockCreated", {
      clock: {
        id: "clock:gate",
        name: "Gate falls",
        kind: "canon",
        segments: 2,
        filled: 0,
        visible: false,
        canon: {
          startedAt: 0,
          outcome: { entityId: "loc:ferry", predicate: "fallen", value: true },
          intervention: { entityId: "loc:ferry", predicate: "reinforced" },
        },
      },
    }),
  ]);
  const fact = Fact.parse({
    id: "pending",
    entityId: "loc:ferry",
    predicate: "reinforced",
    value: true,
    source: "model",
  });
  const context = {
    state: f.store.state(),
    pcId: "pc",
    turnId: "t",
    canon: f.canon,
    ctx: makeTurnContext(f.store.state(), f.canon, rules),
    items: { weapons: {}, armor: {}, gear: {} },
    newId: () => "id",
    pendingDrafts: [draft("FactAsserted", { fact })] as EventDraft[],
  };
  const call = { id: "test", name: "intervene_canon", args: { clockId: "clock:gate", factId: "pending" } };
  expect((await executeTool(call, context)).ok).toBe(true);
  context.pendingDrafts[0] = draft("FactAsserted", { fact: { ...fact, value: false } });
  expect((await executeTool(call, context)).ok).toBe(false);
  context.pendingDrafts[0] = draft("FactAsserted", { fact });
  context.pendingDrafts.push(draft("FactRetracted", { factId: "pending", reason: "correction" }));
  expect((await executeTool(call, context)).ok).toBe(false);
});

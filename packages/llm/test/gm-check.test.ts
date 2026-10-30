import { afterEach, beforeEach, expect, test } from "bun:test";
import { FakeProvider, type FakeRule } from "../src/fake.ts";
import { TurnPipeline, type TurnStreamEvent } from "../src/pipeline.ts";
import { RoleRouter } from "../src/router.ts";
import { MemoryUsageSink } from "../src/usage.ts";
import { gmFixture, rules } from "./gm-fixture.ts";

let fx: ReturnType<typeof gmFixture>;
let nextId = 0;
beforeEach(() => {
  fx = gmFixture();
});
afterEach(() => fx.close());

function setup(check: FakeRule[]) {
  const gm = new FakeProvider([{ role: "gm", reply: { text: "You pocket the ring." } }], "fake");
  const checker = new FakeProvider(check, "checker");
  const route = { provider: "fake", model: "test", fallbacks: [] };
  const router = new RoleRouter({
    providers: { fake: gm, checker },
    routing: {
      gm: route,
      check: { provider: "checker", model: "check", fallbacks: [] },
      parser: route,
      guard: route,
      narrator: route,
    },
    usage: new MemoryUsageSink(),
  });
  let ids = nextId;
  const pipeline = new TurnPipeline({
    store: fx.store,
    canon: fx.canon,
    router,
    rules,
    tone: "",
    worldBible: "",
    newId: () => {
      const id = `ID${String(++ids).padStart(6, "0")}`;
      nextId = ids;
      return id;
    },
  });
  const events: TurnStreamEvent[] = [];
  const head = fx.store.events().at(-1)!.seq;
  return {
    gm,
    checker,
    pipeline,
    events,
    onEvent: (e: TurnStreamEvent) => events.push(e),
    since: () => fx.store.events().filter((e) => e.seq > head),
  };
}

const report = (args: {
  claims?: { quote: string; claim: string }[];
  entities?: { name: string; kind: string }[];
}): FakeRule => ({
  role: "check",
  reply: { toolCall: { name: "report_unrecorded", args } },
});

test("flags an unrecorded claim", async () => {
  const claim = { quote: "You pocket the ring.", claim: "The ring was never added to the inventory." };
  const s = setup([report({ claims: [claim] })]);
  const r = await s.pipeline.run({ input: "I take the ring.", onEvent: s.onEvent });
  await r.check;

  expect(r.status).toBe("resolved");
  const reported = s.since().find((e) => e.type === "CheckReported")!.payload as {
    turnId: string;
    flags: { quote: string; claim: string }[];
  };
  expect(reported.turnId).toBe(r.turnId);
  expect(reported.flags).toEqual([claim]);
  const narration = s.since().find((e) => e.type === "NarrationCommitted")!.payload as { text: string };
  expect(narration.text).toBe("You pocket the ring.");
  expect(s.events.find((e) => e.type === "check.flag")).toEqual({
    type: "check.flag",
    turnId: r.turnId,
    flags: [claim],
  });
});

test("records new named entities as stubs", async () => {
  const s = setup([report({ entities: [{ name: "Mistress Vane", kind: "npc" }] })]);
  const r = await s.pipeline.run({ input: "Who is that?", onEvent: s.onEvent });
  await r.check;

  const created = s.since().filter((e) => e.type === "EntityCreated");
  const stub = created.find(
    (e) => (e.payload as { entity?: { name?: string } }).entity?.name === "Mistress Vane",
  );
  expect(stub).toBeDefined();
  expect((stub!.payload as { entity: { detail: string } }).entity.detail).toBe("stub");
  // Wenna is already known, so a report of her name does not make a second entity.
  const again = setup([report({ entities: [{ name: "Wenna", kind: "npc" }] })]);
  const second = await again.pipeline.run({ input: "Wenna?", onEvent: again.onEvent });
  await second.check;
  expect(
    again
      .since()
      .filter((e) => e.type === "EntityCreated")
      .some((e) => (e.payload as { entity?: { name?: string } }).entity?.name === "Wenna"),
  ).toBe(false);
});

test("check failure is silent", async () => {
  const s = setup([{ role: "check", reply: { error: { code: "bad_request", retryable: false } } }]);
  const r = await s.pipeline.run({ input: "I wait.", onEvent: s.onEvent });
  expect(r.status).toBe("resolved");
  // The turn is already resolved; awaiting the background check never throws.
  await r.check;
  const reported = s.since().find((e) => e.type === "CheckReported")!.payload as { flags: unknown[] };
  expect(reported.flags).toEqual([]);
  expect(s.events.some((e) => e.type === "check.flag")).toBe(false);
});

test("the check does not duplicate a named entity that exists but is not yet known", async () => {
  const s = setup([report({ entities: [{ name: "The Drowned Man", kind: "npc" }] })]);
  const r = await s.pipeline.run({ input: "A figure appears." });
  await r.check;
  expect(s.since().filter((e) => e.type === "EntityCreated")).toHaveLength(0);
});

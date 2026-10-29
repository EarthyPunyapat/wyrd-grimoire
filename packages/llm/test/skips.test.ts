import { afterEach, expect, test } from "bun:test";
import { draft, Fact } from "@wyrd/core";
import { catalogWith, watchedIds } from "@wyrd/engine";
import { FakeProvider } from "../src/fake.ts";
import { executeTool } from "../src/gm/tools.ts";
import { makeTurnContext, TurnPipeline } from "../src/pipeline.ts";
import { RoleRouter } from "../src/router.ts";
import { gmFixture, rules } from "./gm-fixture.ts";

const fixtures: ReturnType<typeof gmFixture>[] = [];
afterEach(() => {
  for (const fx of fixtures.splice(0)) fx.close();
});
function setup(infinite = false) {
  const fx = gmFixture();
  fixtures.push(fx);
  if (infinite)
    fx.store.append([
      draft("LevelGained", { actorId: "pc", from: 1, level: "infinite", method: "gm", reason: "test" }),
    ]);
  fx.store.append([
    draft("EntityUpdated", { entityId: "npc:ghost", patch: { data: { private: "PRIVATE DATA" } } }),
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "ghost-secret",
        entityId: "npc:ghost",
        predicate: "secret",
        value: "PRIVATE FACT",
        visibility: "secret",
        source: "pack",
      }),
    }),
    draft("MemoryRecorded", {
      memory: {
        id: "ghost-mind",
        npcId: "npc:ghost",
        gameTime: 0,
        kind: "heard",
        content: "PRIVATE MIND",
        about: [],
        importance: 2,
        feeling: 0,
        belief: 1,
      },
    }),
  ]);
  let n = 0;
  const run = async (name: string, args: unknown) => {
    const state = fx.store.state();
    const r = await executeTool(
      { id: `call${++n}`, name, args },
      {
        state,
        pcId: "pc",
        turnId: "t",
        ctx: makeTurnContext(state, fx.canon, rules),
        canon: fx.canon,
        items: catalogWith(state, { weapons: {}, armor: {}, gear: {} }),
        newId: () => `skip${++n}`,
      },
    );
    fx.store.append(r.effects.drafts);
    return r;
  };
  return { fx, run };
}

test("infinity observes and watches an unlearned entity without exposing private data", async () => {
  const { fx, run } = setup(true);
  const observed = await run("observe", { targetId: "npc:ghost" });
  expect(observed.ok).toBe(true);
  expect(observed.result).toContain("The Drowned Man");
  expect(observed.result).not.toContain("PRIVATE");
  expect(fx.store.state().knowledge.entities["npc:ghost"]).toBeDefined();
  expect((await run("watch", { entityId: "npc:ghost" })).ok).toBe(true);
  const result = await run("time_skip", { duration: "a month", reason: "Watch the world" });
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.result).digest.days).toBe(30);
  expect(
    result.effects.cards.filter((c) => c.type === "report" && c.title === "Watch: The Drowned Man"),
  ).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  const state = fx.store.state();
  fx.store.rebuild();
  expect(fx.store.state()).toEqual(state);
  await run("unwatch", { entityId: "npc:ghost" });
  expect(watchedIds(fx.store.state())).toEqual([]);
});

test("finite and sealed observers cannot reveal or watch hidden entities; missing IDs never invent canon", async () => {
  const { fx, run } = setup();
  expect((await run("observe", { targetId: "npc:ghost" })).ok).toBe(false);
  expect((await run("watch", { entityId: "npc:ghost" })).ok).toBe(false);
  expect((await run("observe", { targetId: "missing" })).ok).toBe(false);
  fx.store.append([
    draft("LevelGained", { actorId: "pc", from: 1, level: "infinite", method: "gm", reason: "test" }),
    draft("SealSet", { actorId: "pc", effectiveLevel: 3 }),
  ]);
  expect((await run("observe", { targetId: "npc:ghost" })).ok).toBe(false);
});

test("real offline GM turns persist watch reports and conditional skip digests", async () => {
  const { fx } = setup();
  fx.store.append([draft("WatchAdded", { entityId: "npc:wenna" })]);
  let n = 0;
  const fake = new FakeProvider([
    {
      role: "gm",
      reply: (request) => {
        const count = request.messages.filter((m) => m.role === "tool").length;
        if (!count) return { toolCall: { name: "watch", args: { entityId: "npc:wenna" } } };
        if (count === 1) return { toolCall: { name: "time_skip", args: { duration: "2 days" } } };
        return { text: "Two quiet days pass by the ferry." };
      },
    },
  ]);
  const router = new RoleRouter({
    providers: { fake },
    routing: { gm: { provider: "fake", model: "test", fallbacks: [] } },
  });
  await new TurnPipeline({
    store: fx.store,
    canon: fx.canon,
    router,
    rules,
    tone: "",
    worldBible: "",
    newId: () => `id${++n}`,
  }).run({ input: "Watch Wenna for two days" });
  const turn = fx.store.events().find((e) => e.type === "TurnCompleted");
  expect(turn?.payload.gm?.cards).toContainEqual(
    expect.objectContaining({ type: "report", title: "Watch: Wenna" }),
  );
  expect(JSON.stringify(turn?.payload.gm)).not.toContain("PRIVATE");
  expect(fx.store.state().campaign.gameTime).toBe(2880);
  expect(fake.calls("gm")[0]!.messages[0]!.content).toContain("Watching: npc:wenna");
});

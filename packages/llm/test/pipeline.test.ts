import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultTuning, draft, Entity, Fact, SceneState } from "@wyrd/core";
import {
  buildSheet,
  CORE_SKILL_CATALOG,
  createActor,
  createCampaign,
  type GameState,
  type RulesContext,
  reduce,
  unwrap,
} from "@wyrd/engine";
import { CampaignStore, CanonQueries } from "@wyrd/storage";
import { FakeProvider, type FakeRule } from "../src/fake.ts";
import { TurnPipeline, type TurnStreamEvent } from "../src/pipeline.ts";
import { RoleRouter } from "../src/router.ts";
import type { GenerateRequest } from "../src/types.ts";
import { MemoryUsageSink } from "../src/usage.ts";

const rules: RulesContext = { skills: CORE_SKILL_CATALOG, tuning: defaultTuning };

let dir: string;
let store: CampaignStore<GameState>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wyrd-pipeline-"));
  const created = unwrap(createCampaign({ name: "Ford", packIds: ["fantasy-core"], seed: 11 }));
  store = CampaignStore.create<GameState>(join(dir, "c.db"), created, { reduce });
  const sheet = buildSheet(
    {
      id: "pc",
      identity: { name: "Wren", ancestry: "fantasy-core:halfling" },
      attributes: { str: 4, agi: 7, end: 5, int: 5, awa: 7, wil: 4, pre: 7 },
      skills: { "core:stealth": { trained: 60 }, "core:athletics": { trained: 20 } },
    },
    store.state().campaign.settings,
    defaultTuning,
  );
  store.append(unwrap(createActor(store.state(), sheet, "pc")));
  store.append([
    draft("EntityCreated", {
      entity: Entity.parse({
        id: "loc:ferry",
        kind: "location",
        name: "Ashford Ferry",
        detail: "full",
        summary: "A ferry house.",
      }),
    }),
    draft("EntityCreated", {
      entity: Entity.parse({
        id: "npc:wenna",
        kind: "npc",
        name: "Wenna",
        detail: "sketch",
        summary: "The ferrywoman.",
      }),
    }),
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "f:wenna-hands",
        entityId: "npc:wenna",
        predicate: "appearance.hands",
        value: "cracked like old leather",
        source: "pack",
      }),
    }),
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: "scene-1",
        locationId: "loc:ferry",
        zones: [
          { id: "z:common", name: "the common room" },
          { id: "z:jetty", name: "the jetty" },
          { id: "z:loft", name: "the hayloft" },
        ],
        edges: [
          { a: "z:common", b: "z:jetty" },
          { a: "z:common", b: "z:loft", requires: "climb" },
        ],
        positions: { pc: "z:common", "npc:wenna": "z:jetty" },
        light: "dim",
        openedAt: 0,
      }),
    }),
  ]);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const propose = (actions: unknown[], intent = "do it"): FakeRule["reply"] => ({
  toolCall: { name: "propose_actions", args: { actions, intent } },
});
const report = (r: Record<string, unknown> = {}): FakeRule["reply"] => ({
  toolCall: { name: "report_canon", args: r },
});
const GOOD_MOVE = [
  { type: "move", toZoneId: "z:jetty" },
  { type: "talk", targetId: "npc:wenna", utterance: "How much to cross?", approach: "neutral" },
];

let ids = 0;
function setup(rulesList: FakeRule[], opts: { plan?: FakeRule[] } = {}) {
  const fake = new FakeProvider(rulesList, "deepseek");
  const plan = new FakeProvider(opts.plan ?? [], "plan");
  const usage = new MemoryUsageSink();
  const router = new RoleRouter({
    providers: { deepseek: fake, plan },
    routing: {
      parser: { provider: "deepseek", model: "flash", fallbacks: [] },
      guard: { provider: "deepseek", model: "flash", fallbacks: [] },
      narrator: opts.plan
        ? { provider: "plan", model: "sol", fallbacks: [{ provider: "deepseek", model: "flash" }] }
        : { provider: "deepseek", model: "flash", fallbacks: [] },
    },
    usage,
  });
  const pipeline = new TurnPipeline({
    store,
    canon: new CanonQueries(store),
    router,
    rules,
    tone: "Grim and wet.",
    worldBible: "A river valley.",
    newId: () => `ID${String(++ids).padStart(6, "0")}`,
    campaignId: store.campaignId,
  });
  const events: TurnStreamEvent[] = [];
  return { fake, plan, usage, pipeline, events, onEvent: (e: TurnStreamEvent) => events.push(e) };
}

const lastUser = (r: GenerateRequest) => JSON.stringify(r.messages);
const typesSince = (seq: number) =>
  store
    .events()
    .filter((e) => e.seq > seq)
    .map((e) => e.type);

describe("exploration turn end to end (FakeProvider)", () => {
  test("parse → resolve → narrate → guard → commit", async () => {
    const t = setup([
      { role: "parser", reply: propose(GOOD_MOVE, "cross the river") },
      {
        role: "narrator",
        reply: { text: 'You pick your way down to the jetty. <say who="npc:wenna">Two pennies.</say>' },
      },
      { role: "guard", reply: report() },
    ]);
    const head = store.events().length;
    const r = await t.pipeline.run({
      input: "I go down to the jetty and ask Wenna what the crossing costs.",
      onEvent: t.onEvent,
    });

    expect(r).toMatchObject({
      status: "resolved",
      repairs: 0,
      guard: { checked: true, regenerated: false, flagged: [] },
    });
    expect(r.narration).toContain("Two pennies.");
    expect(typesSince(head)).toEqual([
      "TurnStarted",
      "EntityMoved",
      "MemoryRecorded", // Wenna remembers what she was asked
      "TimeAdvanced",
      "KnowledgeGained", // the PC now knows the ferry, Wenna, and what they saw of her
      "KnowledgeGained",
      "KnowledgeGained",
      "TurnCompleted",
      "NarrationCommitted",
    ]);
    expect(store.state().scene?.positions.pc).toBe("z:jetty");
    expect(new CanonQueries(store).turn(r.turnId)).toMatchObject({
      status: "resolved",
      narration: r.narration,
    });
    expect(t.events.map((e) => e.type)).toEqual(["turn.accepted", "narration.final", "turn.completed"]);
    // One usage record per call: parser, narrator, guard.
    expect(t.usage.records.map((u) => [u.role, u.promptVersion, u.turnId])).toEqual([
      ["parser", "parser@2", r.turnId],
      ["narrator", "narrator@3", r.turnId],
      ["guard", "guard@2", r.turnId],
    ]);
    // The parser saw IDs; the narrator saw the required beats; the guard saw the draft.
    expect(lastUser(t.fake.calls("parser")[0]!)).toContain("the jetty [z:jetty]");
    expect(lastUser(t.fake.calls("narrator")[0]!)).toContain("Wren goes to the jetty.");
    expect(lastUser(t.fake.calls("guard")[0]!)).toContain("Two pennies.");
  });

  test("checks: mechanics lines stream before the narration", async () => {
    const t = setup([
      {
        role: "parser",
        reply: propose([
          {
            type: "check",
            skill: "stealth",
            goal: "creep past Wenna",
            proposedDifficulty: "hard",
            reason: "she is watchful",
          },
        ]),
      },
      { role: "narrator", reply: { text: "You keep to the shadows." } },
      { role: "guard", reply: report() },
    ]);
    const r = await t.pipeline.run({ input: "I sneak past Wenna.", onEvent: t.onEvent });
    expect(r.mechanics[0]?.text).toMatch(/^Stealth 81% · Hard \(−20\)/);
    const order = t.events.map((e) => e.type);
    expect(order.indexOf("mechanics.line")).toBeLessThan(order.indexOf("narration.final"));
  });

  test("repair: an invalid plan goes back to the parser with the engine's errors", async () => {
    const t = setup([
      {
        role: "parser",
        reply: propose([{ type: "talk", targetId: "npc:ghost", utterance: "Hello?", approach: "neutral" }]),
        times: 1,
      },
      { role: "parser", reply: propose(GOOD_MOVE) },
      { role: "narrator", reply: { text: "Fine." } },
      { role: "guard", reply: report() },
    ]);
    const r = await t.pipeline.run({ input: "I talk to the ghost.", onEvent: t.onEvent });
    expect(r).toMatchObject({ status: "resolved", repairs: 1 });
    const second = t.fake.calls("parser")[1]!;
    expect(second.messages.at(-1)).toMatchObject({ role: "tool", name: "propose_actions" });
    expect(lastUser(second)).toContain("TARGET_NOT_PRESENT");
  });

  test("repair → clarification: after two failed repairs the player gets options from the legal alternatives", async () => {
    const t = setup([{ role: "parser", reply: propose([{ type: "move", toZoneId: "z:loft" }]) }]);
    const head = store.events().length;
    const r = await t.pipeline.run({ input: "I go up to the hayloft.", onEvent: t.onEvent });
    expect(r.status).toBe("clarify");
    expect(r.repairs).toBe(2);
    expect(t.fake.calls("parser")).toHaveLength(3);
    expect(r.clarification?.question).toContain("needs a climb");
    expect(r.clarification?.options.map((o) => o.label)).toEqual([
      "Try to climb to the hayloft (athletics, normal)",
      "Look at the surroundings",
      "Wait 10 minutes",
    ]);
    expect(t.events.map((e) => e.type)).toEqual(["turn.accepted", "clarify", "turn.completed"]);
    expect(typesSince(head)).toEqual(["TurnStarted", "TurnCompleted"]);
    expect(t.fake.calls("narrator")).toHaveLength(0);

    // Clicking the option submits its actions directly, skipping the parser.
    const t2 = setup([
      { role: "narrator", reply: { text: "You haul yourself up." } },
      { role: "guard", reply: report() },
    ]);
    const option = r.clarification!.options[0]!;
    const r2 = await t2.pipeline.run({ input: option.label, actions: option.actions as never });
    expect(r2.status).toBe("resolved");
    expect(r2.mechanics[0]?.text).toContain("Athletics");
    expect(t2.fake.calls("parser")).toHaveLength(0);
  });

  test("the parser can ask for clarification itself; illegal option actions are dropped", async () => {
    const t = setup([
      {
        role: "parser",
        reply: {
          toolCall: {
            name: "ask_clarification",
            args: {
              question: "Which way?",
              options: [
                { label: "The jetty", actions: [{ type: "move", toZoneId: "z:jetty" }] },
                { label: "The roof", actions: [{ type: "move", toZoneId: "z:roof" }] },
              ],
            },
          },
        },
      },
    ]);
    const r = await t.pipeline.run({ input: "I leave." });
    expect(r.clarification?.options).toEqual([
      { label: "The jetty", actions: [{ type: "move", toZoneId: "z:jetty" }] },
      { label: "The roof" },
    ]);
  });

  test("guard regeneration: a blocking report regenerates once with corrections", async () => {
    const t = setup([
      { role: "parser", reply: propose(GOOD_MOVE) },
      { role: "narrator", reply: { text: "Wenna hands you the ferry key." }, times: 1 },
      { role: "narrator", reply: { text: "Wenna names her price." } },
      {
        role: "guard",
        reply: report({
          stateClaims: [
            { quote: "hands you the ferry key", claim: "PC gains an item the engine didn't give" },
          ],
        }),
        times: 1,
      },
      { role: "guard", reply: report() },
    ]);
    const r = await t.pipeline.run({ input: "To the jetty; ask the price.", onEvent: t.onEvent });
    expect(r).toMatchObject({
      narration: "Wenna names her price.",
      guard: { checked: true, regenerated: true, flagged: [] },
    });
    const second = t.fake.calls("narrator")[1]!;
    expect(lastUser(second)).toContain("Fix these problems from your last draft");
    expect(lastUser(second)).toContain("hands you the ferry key");
    expect(t.events.some((e) => e.type === "guard.flag")).toBe(false);
  });

  test("still blocking after regeneration: kept and flagged for the player", async () => {
    const t = setup([
      { role: "parser", reply: propose(GOOD_MOVE) },
      { role: "narrator", reply: { text: "Wenna dies." } },
      {
        role: "guard",
        reply: report({
          contradictions: [
            { quote: "Wenna dies", conflictsWith: { resolution: "nobody was hurt" }, severity: "major" },
          ],
        }),
      },
    ]);
    const r = await t.pipeline.run({ input: "To the jetty.", onEvent: t.onEvent });
    expect(r.guard).toMatchObject({
      regenerated: true,
      flagged: [{ kind: "contradiction", quote: "Wenna dies" }],
    });
    expect(t.events.find((e) => e.type === "guard.flag")).toBeDefined();
    expect(t.fake.calls("narrator")).toHaveLength(2);
  });

  test("minor contradictions don't block", async () => {
    const t = setup([
      { role: "parser", reply: propose(GOOD_MOVE) },
      { role: "narrator", reply: { text: "Wenna's smooth hands." } },
      {
        role: "guard",
        reply: report({
          contradictions: [
            { quote: "smooth hands", conflictsWith: { factId: "f:wenna-hands" }, severity: "minor" },
          ],
        }),
      },
    ]);
    const r = await t.pipeline.run({ input: "To the jetty." });
    expect(r.guard).toMatchObject({ regenerated: false, flagged: [] });
  });

  test("new named entities become stubs in the scene; new facts attach to known entities", async () => {
    const t = setup([
      { role: "parser", reply: propose(GOOD_MOVE) },
      {
        role: "narrator",
        reply: { text: "A boy called Pip is mending nets beside Wenna, who wears a red scarf." },
      },
      {
        role: "guard",
        reply: report({
          newEntities: [
            { name: "Pip", kind: "npc", description: "A boy mending nets." },
            { name: "Wenna", kind: "npc", description: "already known" },
          ],
          newFacts: [
            {
              entityId: "npc:wenna",
              predicate: "appearance.clothing",
              value: "a red scarf",
              quote: "wears a red scarf",
            },
            { entityId: "npc:nobody", predicate: "x", value: "y", quote: "z" },
          ],
        }),
      },
    ]);
    await t.pipeline.run({ input: "To the jetty." });
    const canon = new CanonQueries(store);
    const pip = canon.findByName("Pip")[0];
    expect(pip).toMatchObject({ kind: "npc", detail: "stub", summary: "A boy mending nets." });
    expect(store.state().scene?.positions[pip!.id]).toBe("z:jetty"); // placed with the PC
    expect(canon.findByName("Wenna")).toHaveLength(1);
    expect(canon.factsAbout("npc:wenna").map((f) => f.value)).toContain("a red scarf");
  });

  test("narration failure: the resolution still commits with a mechanical summary", async () => {
    const t = setup([
      { role: "parser", reply: propose(GOOD_MOVE) },
      { role: "narrator", reply: { error: { code: "server", retryable: true } } },
    ]);
    const r = await t.pipeline.run({ input: "To the jetty.", onEvent: t.onEvent });
    expect(r.status).toBe("resolved");
    expect(r.narration).toContain("Wren goes to the jetty.");
    expect(store.state().scene?.positions.pc).toBe("z:jetty");
    expect(t.events.find((e) => e.type === "error")).toMatchObject({ retryable: true });
  });

  test("guard failure: narration is shown unchecked", async () => {
    const t = setup([
      { role: "parser", reply: propose(GOOD_MOVE) },
      { role: "narrator", reply: { text: "Fine." } },
      { role: "guard", reply: { text: "not a tool call" } },
    ]);
    const r = await t.pipeline.run({ input: "To the jetty." });
    expect(r.guard).toEqual({ checked: false, regenerated: false, flagged: [] });
  });

  test("a mocked plan usage limit moves the narrator to its fallback without a retry loop", async () => {
    const t = setup(
      [
        { role: "parser", reply: propose(GOOD_MOVE) },
        { role: "narrator", reply: { text: "Narrated by DeepSeek." } },
        { role: "guard", reply: report() },
      ],
      {
        plan: [
          {
            role: "narrator",
            reply: { error: { code: "usage_limit", message: "subscription_sharing_usage_limit_exceeded" } },
          },
        ],
      },
    );
    const r = await t.pipeline.run({ input: "To the jetty." });
    expect(r.narration).toBe("Narrated by DeepSeek.");
    expect(t.plan.requests).toHaveLength(1);
    expect(t.usage.records.filter((u) => u.role === "narrator").map((u) => [u.provider, u.ok])).toEqual([
      ["plan", false],
      ["deepseek", true],
    ]);
  });

  test("out-of-character questions are answered without changing anything", async () => {
    const t = setup([
      {
        role: "parser",
        match: (q) => q.tools !== undefined,
        reply: {
          toolCall: { name: "answer_ooc", args: { topic: "rules", question: "How does pushing work?" } },
        },
      },
      { role: "parser", reply: { text: "After a failed check you can push it once." } },
    ]);
    const before = store.stateHash();
    const r = await t.pipeline.run({ input: "(how does pushing work?)" });
    expect(r).toMatchObject({ status: "ooc", answer: "After a failed check you can push it once." });
    expect(store.stateHash()).toBe(before);
  });

  test("a parser outage fails the turn cleanly", async () => {
    const t = setup([{ role: "parser", reply: { error: { code: "auth", message: "bad key" } } }]);
    const before = store.stateHash();
    const r = await t.pipeline.run({ input: "To the jetty.", onEvent: t.onEvent });
    expect(r.status).toBe("failed");
    expect(store.stateHash()).toBe(before);
    expect(t.events.find((e) => e.type === "error")).toMatchObject({ message: "auth: bad key" });
  });

  test("reroll: new prose for the same resolution; the dice never change", async () => {
    const t = setup([
      {
        role: "parser",
        reply: propose([
          {
            type: "check",
            skill: "stealth",
            goal: "creep past Wenna",
            proposedDifficulty: "hard",
            reason: "watchful",
          },
        ]),
      },
      { role: "narrator", reply: { text: "First telling." }, times: 1 },
      { role: "narrator", reply: { text: "Second telling." } },
      { role: "guard", reply: report() },
    ]);
    const r = await t.pipeline.run({ input: "I sneak past Wenna." });
    const hash = store.stateHash();
    const checksBefore = store.events().filter((e) => e.type === "CheckResolved").length;

    const again = await t.pipeline.reroll(r.turnId);
    expect(again.narration).toBe("Second telling.");
    expect(again.mechanics).toEqual(r.mechanics);
    expect(store.events().filter((e) => e.type === "CheckResolved")).toHaveLength(checksBefore);
    expect(store.events().at(-1)?.type).toBe("NarrationRerolled");
    expect(store.stateHash()).toBe(hash);
    expect(new CanonQueries(store).turn(r.turnId)?.narration).toBe("Second telling.");
    // The reroll's narrator context doesn't contain the passage it replaces.
    expect(lastUser(t.fake.calls("narrator")[1]!)).not.toContain("First telling.");
  });

  test("recent turns carry into the next turn's narrator context", async () => {
    const t = setup([
      { role: "parser", reply: propose([{ type: "wait", minutes: 5 }]) },
      {
        role: "narrator",
        match: (q) => !lastUser(q).includes("The rain thickens."),
        reply: { text: "The rain thickens." },
      },
      { role: "narrator", reply: { text: "Still raining." } },
      { role: "guard", reply: report() },
    ]);
    await t.pipeline.run({ input: "I wait." });
    const r2 = await t.pipeline.run({ input: "I wait some more." });
    expect(r2.narration).toBe("Still raining.");
    expect(lastUser(t.fake.calls("narrator")[1]!)).toContain(
      "Player: I wait.\\nNarration: The rain thickens.",
    );
  });
});

describe("combat turns (FakeProvider)", () => {
  test("attacking someone starts a fight; the parser then gets combat tools and the fight's state", async () => {
    const t = setup([
      { role: "parser", times: 1, reply: propose([{ type: "strike", targetId: "npc:wenna" }], "hit her") },
      { role: "parser", reply: propose([{ type: "defend" }], "defend") },
      { role: "narrator", reply: { text: "You lunge at Wenna.\n\nShe hits back." } },
      { role: "guard", reply: report() },
    ]);
    // Put Wenna next to the PC so the punch can land.
    store.append([draft("EntityMoved", { entityId: "npc:wenna", toZoneId: "z:common" })]);
    const r = await t.pipeline.run({ input: "I punch Wenna", onEvent: t.onEvent });
    expect(r.status).toBe("resolved");
    const types = store.events().map((e) => e.type);
    expect(types).toContain("CombatStarted");
    expect(types).toContain("ActorCreated"); // Wenna got a stat-blocked sheet
    expect(t.events.filter((e) => e.type === "mechanics.line").length).toBeGreaterThan(0);
    // Mechanics lines stream before the narration.
    const firstNarration = t.events.findIndex((e) => e.type === "narration.final");
    const lastMechanics = t.events.map((e) => e.type).lastIndexOf("mechanics.line");
    expect(lastMechanics).toBeLessThan(firstNarration);
    expect(JSON.stringify(t.fake.calls("narrator")[0]?.messages)).toContain("The player character's turn:");
    if (store.state().combat) {
      // Next turn the parser sees combat tools and the fight.
      await t.pipeline.run({ input: "I defend", onEvent: t.onEvent });
      const last = t.fake.calls("parser").at(-1)!;
      expect(JSON.stringify(last.tools)).toContain("takeCover");
      expect(JSON.stringify(last.messages)).toContain("The fight:");
    }
  });
});

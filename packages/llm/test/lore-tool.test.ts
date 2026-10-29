import { afterEach, beforeEach, expect, test } from "bun:test";
import { draft, Entity, Fact, MAIN_WORLD } from "@wyrd/core";
import { catalogWith } from "@wyrd/engine";
import type { ToolContext } from "../src/gm/tool-types.ts";
import { executeTool } from "../src/gm/tools.ts";
import { makeTurnContext } from "../src/pipeline.ts";
import { gmFixture, rules } from "./gm-fixture.ts";

let fx: ReturnType<typeof gmFixture>;
beforeEach(() => {
  fx = gmFixture();
});
afterEach(() => fx.close());
let n = 0;
function context(extra: Partial<ToolContext> = {}): ToolContext {
  const state = fx.store.state();
  return {
    state,
    pcId: "pc",
    turnId: "turn-lore",
    ctx: makeTurnContext(state, fx.canon, rules),
    canon: fx.canon,
    items: catalogWith(state, { weapons: {}, armor: {}, gear: {} }),
    newId: () => `lore-${++n}`,
    ...extra,
  };
}
const call = (args: unknown) => ({ id: "call-lore", name: "lookup_lore", args });
const summary = {
  title: "Marsh light",
  facts: ["Marsh lights lead walkers astray."],
  source: "lore" as const,
  confidence: "high" as const,
  evidence: { quote: "https://dc.fandom.com/wiki/Marsh_light" },
};

test("existing canon wins over external lore and hides secrets", async () => {
  let lookups = 0;
  const r = await executeTool(
    call({ query: "Wenna" }),
    context({
      lore: {
        lookup: async () => {
          lookups++;
          return summary;
        },
      },
    }),
  );
  expect(r.result).toContain("cracked like old leather");
  expect(r.result).not.toContain("smuggles relics");
  expect(lookups).toBe(0);
  expect(r.effects.drafts).toHaveLength(0);
});

test("research progress precedes asynchronous work; linked facts and record survive rebuild", async () => {
  const order: string[] = [];
  const r = await executeTool(
    call({ query: "Marsh light", wiki: "dc.fandom.com" }),
    context({
      onProgress: (p) => {
        order.push(p.phase);
      },
      lore: {
        lookup: async () => {
          order.push("lookup");
          return summary;
        },
      },
    }),
  );
  expect(order).toEqual(["researching", "lookup"]);
  expect(r.ok).toBe(true);
  expect(r.effects.drafts.map((d) => d.type)).toEqual([
    "EntityCreated",
    "FactAsserted",
    "KnowledgeGained",
    "KnowledgeGained",
    "LoreRecorded",
  ]);
  fx.store.append(r.effects.drafts);
  const entity = fx.canon.findByName("Marsh light")[0]!;
  const facts = fx.canon.factsAbout(entity.id);
  expect(entity.worldId).toBe(MAIN_WORLD);
  expect(facts[0]?.source).toBe("lore");
  expect(facts[0]?.evidence?.quote).toBe(summary.evidence.quote);
  expect(facts[0]?.confidence).toBe("high");
  const state = fx.store.state();
  expect(state.flags.loreRecords).toBeDefined();
  fx.store.rebuild();
  expect(fx.store.state()).toEqual(state);
  const cached = await executeTool(
    call({ query: "Marsh light" }),
    context({
      lore: {
        lookup: async () => {
          throw new Error("must not fetch");
        },
      },
    }),
  );
  expect(cached.ok).toBe(true);
  expect(cached.result).toContain(summary.facts[0]!);
  expect(cached.effects.drafts).toHaveLength(0);
});

test("world filtering preserves local canon and lore records carry selected world", async () => {
  fx.store.append([
    draft("EntityCreated", {
      entity: Entity.parse({
        id: "concept:other",
        kind: "concept",
        name: "Other light",
        detail: "full",
        worldId: "world:other",
        summary: "other-world-only",
      }),
    }),
    draft("KnowledgeGained", { entityId: "concept:other", entry: { how: "read", gameTime: 0 } }),
  ]);
  const r = await executeTool(call({ query: "Other light" }), context());
  expect(r.result).not.toContain("other-world-only");
  const bad = await executeTool(call({ query: "Light", worldId: "world:missing" }), context());
  expect(bad.ok).toBe(false);
});

test("low confidence is persisted without a made-up citation; research errors stay secret-free", async () => {
  const r = await executeTool(
    call({ query: "Light" }),
    context({ lore: { lookup: async () => ({ ...summary, confidence: "low", evidence: undefined }) } }),
  );
  fx.store.append(r.effects.drafts);
  const fact = fx.canon.factsAbout(fx.canon.findByName("Marsh light")[0]!.id)[0]!;
  expect(fact.confidence).toBe("low");
  expect(fact.evidence).toBeUndefined();
  const fail = await executeTool(
    call({ query: "Unknown" }),
    context({
      lore: {
        lookup: async () => {
          throw new Error("Bearer secret-token");
        },
      },
    }),
  );
  expect(fail.ok).toBe(false);
  expect(fail.result).not.toContain("secret-token");
});

test("pinned player canon is never overwritten by wiki lore", async () => {
  fx.store.append([
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "player-fact",
        entityId: "npc:wenna",
        predicate: "note",
        value: "The player's ferrywoman.",
        source: "player",
        pinned: true,
      }),
    }),
  ]);
  const r = await executeTool(call({ query: "Wenna" }), context({ lore: { lookup: async () => summary } }));
  expect(r.result).toContain("The player's ferrywoman.");
  expect(r.effects.drafts).toHaveLength(0);
});

test("research aliases return corrected canon on later turns", async () => {
  const first = await executeTool(
    call({ query: "wandering lights" }),
    context({ lore: { lookup: async () => summary } }),
  );
  fx.store.append(first.effects.drafts);
  const entity = fx.canon.findByName("Marsh light")[0]!;
  const old = fx.canon.factsAbout(entity.id)[0]!;
  fx.store.append([
    draft("FactSuperseded", {
      oldFactId: old.id,
      fact: Fact.parse({
        ...old,
        id: "corrected-lore",
        source: "player",
        pinned: true,
        value: "These lights guide walkers safely home.",
      }),
    }),
  ]);
  const next = await executeTool(
    call({ query: "wandering lights" }),
    context({
      lore: {
        lookup: async () => {
          throw new Error("canon must win");
        },
      },
    }),
  );
  expect(next.result).toContain("These lights guide walkers safely home.");
  expect(next.result).not.toContain(summary.facts[0]!);
});

test("selected-world research stamps its entities, facts and provenance", async () => {
  const state = fx.store.state();
  const r = await executeTool(
    call({ query: "Marsh light", worldId: "world:other" }),
    context({
      state: { ...state, worlds: [...state.worlds, { id: "world:other", name: "Other" }] },
      lore: { lookup: async () => summary },
    }),
  );
  expect(r.ok).toBe(true);
  const created = r.effects.drafts.find((d) => d.type === "EntityCreated")!;
  const fact = r.effects.drafts.find((d) => d.type === "FactAsserted")!;
  const recorded = r.effects.drafts.find((d) => d.type === "LoreRecorded")!;
  expect((created.payload as { entity: { worldId: string } }).entity.worldId).toBe("world:other");
  expect((fact.payload as { fact: { worldId: string } }).fact.worldId).toBe("world:other");
  expect((recorded.payload as { record: { worldId: string } }).record.worldId).toBe("world:other");
});

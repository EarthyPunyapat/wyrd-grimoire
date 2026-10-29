import { describe, expect, test } from "bun:test";
import { draft, EVENT_TYPES, type EventDraft, type ItemCatalog } from "@wyrd/core";
import { applyChanges } from "../src/gm-changes.ts";
import { inventoryOf } from "../src/inventory.ts";
import { fold } from "../src/reduce.ts";
import { envelope, Sim } from "./sim.ts";

const items = {
  weapons: {},
  armor: {},
  gear: {
    "test:rope": {
      id: "rope",
      name: "Rope",
      description: "",
      weightKg: 1,
      price: 2,
      tags: [],
    },
  },
} as unknown as ItemCatalog;

function setup() {
  const s = new Sim();
  s.addActor("pc", "pc");
  let n = 0;
  const newId = () => `id:${++n}`;
  return { s, newId };
}

const apply = (s: Sim, changes: Parameters<typeof applyChanges>[1], newId: () => string) =>
  applyChanges(s.state, changes, { items, newId });

/** Fold drafts as envelopes, the way storage does, so the inverse can be checked. */
function foldDrafts(state: Sim["state"], drafts: EventDraft[]) {
  return fold(
    drafts.map((d, i) => envelope(d, 1000 + i, state.campaign.gameTime)),
    state,
  );
}

describe("GM state changes (D144)", () => {
  test("gives an item", () => {
    const { s, newId } = setup();
    const out = apply(s, [{ kind: "item.give", actorId: "pc", itemId: "test:rope", qty: 2 }], newId);
    expect(out.outcomes[0]).toMatchObject({ index: 0, ok: true });
    expect(out.drafts).toEqual([
      expect.objectContaining({
        type: "ItemTransferred",
        payload: expect.objectContaining({ actorId: "pc", itemId: "test:rope", qty: 2 }),
      }),
    ]);
    expect(out.inverse).toEqual([
      expect.objectContaining({
        type: "ItemTransferred",
        payload: expect.objectContaining({ itemId: "test:rope", qty: 2 }),
      }),
    ]);
    expect(out.inverse[0]!.payload).not.toHaveProperty("location");
  });

  test("defines then gives in one call", () => {
    const { s, newId } = setup();
    const out = apply(
      s,
      [
        { kind: "item.define", name: "Yellow lantern ring", description: "It glows with fear." },
        { kind: "item.give", actorId: "pc", itemId: "campaign:yellow-lantern-ring" },
      ],
      newId,
    );
    expect(out.outcomes.map((o) => o.ok)).toEqual([true, true]);
    expect(out.outcomes[0]!.ids).toEqual(["campaign:yellow-lantern-ring"]);
    expect(out.drafts.map((d) => d.type)).toEqual(["ItemDefined", "ItemTransferred"]);
  });

  test("rejects unknown ids per change", () => {
    const { s, newId } = setup();
    const out = apply(
      s,
      [
        { kind: "item.give", actorId: "pc", itemId: "nope" },
        { kind: "coins", actorId: "pc", delta: 5 },
      ],
      newId,
    );
    expect(out.outcomes[0]!.ok).toBe(false);
    expect(out.outcomes[0]!.reason).toContain("nope");
    expect(out.outcomes[1]!.ok).toBe(true);
    expect(out.drafts.map((d) => d.type)).toEqual(["CoinsChanged"]);
  });

  test("cannot take what is not carried", () => {
    const { s, newId } = setup();
    s.commit([
      draft("ItemTransferred", {
        actorId: "pc",
        itemId: "test:rope",
        qty: 1,
        location: { kind: "carried" },
        reason: "test",
      }),
    ]);
    const out = apply(s, [{ kind: "item.take", actorId: "pc", itemId: "test:rope", qty: 2 }], newId);
    expect(out.outcomes[0]!.ok).toBe(false);
    expect(out.drafts).toEqual([]);
  });

  test("inverse restores state", () => {
    const { s, newId } = setup();
    const before = s.state;
    const out = apply(
      s,
      [
        { kind: "item.give", actorId: "pc", itemId: "test:rope", qty: 2 },
        { kind: "coins", actorId: "pc", delta: 5 },
        { kind: "hp", actorId: "pc", delta: -2 },
      ],
      newId,
    );
    expect(out.outcomes.every((o) => o.ok)).toBe(true);
    const changed = foldDrafts(before, out.drafts);
    const restored = foldDrafts(changed, out.inverse);
    expect(inventoryOf(restored, "pc")).toEqual(inventoryOf(before, "pc"));
    expect(restored.economy.wallets.pc?.coins).toBe(before.economy.wallets.pc?.coins ?? 0);
    expect(restored.actors.pc!.sheet.status.hp).toBe(before.actors.pc!.sheet.status.hp);
  });

  test("creates a known entity and a fact, and quests and clocks stay invertible", () => {
    const { s, newId } = setup();
    s.commit([
      draft("ClockCreated", {
        clock: { id: "clock:doom", name: "Doom", kind: "threat", segments: 6, filled: 1, visible: false },
      }),
    ]);
    const out = apply(
      s,
      [
        { kind: "entity.create", entity: { kind: "npc", name: "Hal Jordan", summary: "A pilot." } },
        { kind: "fact", entityId: "id:1", predicate: "occupation", value: "test pilot" },
        { kind: "quest.start", title: "Find the ring", objectives: ["Search the crash site"] },
        { kind: "clock.advance", clockId: "clock:doom", by: 2 },
      ],
      newId,
    );
    expect(out.outcomes.map((o) => o.ok)).toEqual([true, true, true, true]);
    expect(out.drafts.map((d) => d.type)).toEqual([
      "EntityCreated",
      "FactAsserted",
      "QuestStarted",
      "ClockAdvanced",
    ]);
    expect(out.inverse[0]).toMatchObject({ type: "EntityUpdated" });
    expect(out.inverse[1]).toMatchObject({ type: "FactRetracted" });
    expect(out.inverse[2]).toMatchObject({
      type: "QuestEnded",
      payload: { status: "retconned" },
    });
    expect(out.inverse[3]).toMatchObject({ type: "ClockAdvanced", payload: { by: -2 } });
    // Every emitted draft is a real event type with a valid payload.
    for (const d of [...out.drafts, ...out.inverse]) expect(EVENT_TYPES).toContain(d.type);
  });

  test("an irreversible change is reported as such", () => {
    const { s, newId } = setup();
    const out = apply(s, [{ kind: "xp", actorId: "pc", amount: 3 }], newId);
    expect(out.outcomes[0]).toMatchObject({ ok: true, irreversible: true });
    expect(out.inverse).toEqual([]);
  });
});

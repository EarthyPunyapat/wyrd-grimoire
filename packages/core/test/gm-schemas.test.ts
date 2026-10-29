import { describe, expect, test } from "bun:test";
import { Card, GmTurnRecord, StateChange } from "../src/schemas/gm.ts";

describe("GM tool schemas (D144)", () => {
  test("StateChange parses each kind", () => {
    const changes = [
      { kind: "item.give", actorId: "pc", itemId: "fantasy-core:rope" },
      { kind: "item.take", actorId: "pc", itemId: "fantasy-core:rope", qty: 2 },
      { kind: "item.equip", actorId: "pc", itemId: "fantasy-core:rope", slot: "main" },
      {
        kind: "item.define",
        name: "Yellow lantern ring",
        description: "It glows with fear.",
        weightKg: 0.1,
        price: 0,
      },
      { kind: "coins", actorId: "pc", delta: 5 },
      { kind: "hp", actorId: "pc", delta: -2 },
      { kind: "entity.create", entity: { kind: "npc", name: "Hal Jordan", summary: "A pilot." } },
      { kind: "fact", entityId: "npc:hal", predicate: "occupation", value: "test pilot" },
      { kind: "quest.start", title: "Find the ring", objectives: ["Search the crash site"] },
      { kind: "quest.objective", questId: "quest:1", objectiveIndex: 0 },
      { kind: "clock.advance", clockId: "clock:1", by: 1 },
      { kind: "xp", actorId: "pc", amount: 3 },
    ];
    for (const change of changes)
      expect((StateChange.parse(change) as { kind: string }).kind).toBe(change.kind);
    expect((StateChange.parse(changes[0]!) as { qty?: number }).qty).toBe(1);
  });

  test("rejects an unknown kind", () => {
    expect(() => StateChange.parse({ kind: "world.delete" })).toThrow();
  });

  test("Card rejects model-authored layout", () => {
    expect(() => Card.parse({ type: "html", source: "<div>hello</div>" })).toThrow();
    expect(Card.parse({ type: "chapter", title: "First Light" }).type).toBe("chapter");
  });

  test("the turn record keeps cards, choices and the tool log", () => {
    const record = GmTurnRecord.parse({
      cards: [{ type: "retcon", retconId: "retcon:1" }],
      choices: [{ label: "Take the ring" }, { label: "Leave it" }],
      tools: [{ name: "change_state", ok: true }],
      provider: "deepseek",
      model: "flash",
      rounds: 2,
    });
    expect(record.backup).toBe(false);
    expect(record.choices[1]!.description).toBe("");
  });
});

import { expect, test } from "bun:test";
import { Clock, draft, Entity, Fact, MAIN_WORLD, worldOf } from "@wyrd/core";
import { createCampaign, fold, unwrap } from "../src/index.ts";

// D141: a campaign holds several worlds; v1 creates one, and every old record lands in it by default.
test("entities, facts and clocks default to the main world", () => {
  expect(MAIN_WORLD).toBe("world:main");
  const hal = Entity.parse({ id: "npc:hal", kind: "npc", name: "Hal", detail: "stub" });
  const fact = Fact.parse({
    id: "f1",
    entityId: "npc:hal",
    predicate: "ring",
    value: "green",
    source: "model",
  });
  const clock = Clock.parse({ id: "clock:sinestro", name: "Sinestro returns", kind: "threat", segments: 8 });
  for (const record of [hal, fact, clock]) expect(worldOf(record)).toBe(MAIN_WORLD);
});

test("a record can name another world", () => {
  const fang = Entity.parse({
    id: "npc:fang",
    kind: "npc",
    name: "Fang",
    detail: "stub",
    worldId: "world:gu",
  });
  expect(worldOf(fang)).toBe("world:gu");
  expect(() =>
    Entity.parse({ id: "npc:x", kind: "npc", name: "X", detail: "stub", worldId: "elsewhere" }),
  ).toThrow();
});

test("a new campaign starts with one world named after it", () => {
  const created = unwrap(createCampaign({ name: "First Light", packIds: ["fantasy-core"], seed: 3 }));
  const state = fold([
    {
      ...created,
      id: "e1",
      campaignId: "c1",
      branchId: "main",
      seq: 1,
      turnId: null,
      source: "system",
      gameTime: 0,
      createdAt: "",
      schemaVersion: 1,
    } as never,
  ]);
  expect(state.worlds).toEqual([{ id: MAIN_WORLD, name: "First Light" }]);
  void draft;
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draft, Entity, Fact } from "@wyrd/core";
import { createCampaign, type GameState, reduce, unwrap } from "@wyrd/engine";
import { CampaignStore } from "../src/campaign-store.ts";
import { CanonQueries } from "../src/canon-queries.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wyrd-canon-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function store() {
  const created = unwrap(createCampaign({ name: "T", packIds: ["fantasy-core"], seed: 1 }));
  return CampaignStore.create<GameState>(join(dir, "c.db"), created, { reduce });
}

const ferry = Entity.parse({ id: "loc:ferry", kind: "location", name: "Ashford Ferry", detail: "full" });
const wenna = Entity.parse({
  id: "npc:wenna",
  kind: "npc",
  name: "Wenna",
  aliases: ["the ferrywoman"],
  detail: "sketch",
});

test("canon projections, queries and turn records follow the active branch and survive rebuild", () => {
  const s = store();
  s.append([
    draft("EntityCreated", { entity: ferry }),
    draft("EntityCreated", { entity: wenna }),
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "f1",
        entityId: "npc:wenna",
        predicate: "appearance.hands",
        value: "cracked like old leather",
        source: "pack",
      }),
    }),
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "f2",
        entityId: "npc:wenna",
        predicate: "secret",
        value: "smuggles relics",
        source: "pack",
        visibility: "secret",
      }),
    }),
  ]);
  s.append([draft("TurnStarted", { input: "I wave to the ferrywoman." })], { turnId: "t1" });
  s.append(
    [
      draft("TurnCompleted", { status: "resolved", plan: [], mechanics: [] }),
      draft("NarrationCommitted", {
        text: "She doesn't wave back.",
        provider: "fake",
        model: "m",
        promptVersion: "n@1",
        fallback: false,
        guard: { checked: true, regenerated: false, flagged: [] },
      }),
    ],
    { turnId: "t1" },
  );

  const q = new CanonQueries(s);
  expect(q.entity("npc:wenna")?.name).toBe("Wenna");
  expect(q.findByName("The Ferrywoman").map((e) => e.id)).toEqual(["npc:wenna"]);
  expect(q.factsAbout("npc:wenna").map((f) => f.id)).toEqual(["f1"]);
  expect(q.factsAbout("npc:wenna", { includeSecret: true }).map((f) => f.id)).toEqual(["f1", "f2"]);
  expect(q.recentTurns(5)).toEqual([
    expect.objectContaining({
      id: "t1",
      input: "I wave to the ferrywoman.",
      status: "resolved",
      narration: "She doesn't wave back.",
    }),
  ]);

  s.rewind(3);
  expect(q.entity("npc:wenna")).not.toBeNull();
  expect(q.factsAbout("npc:wenna")).toEqual([]);
  expect(q.recentTurns(5)).toEqual([]);
  s.activateBranch("main");
  s.rebuild();
  expect(q.turn("t1")?.narration).toBe("She doesn't wave back.");
});

test("duplicate entity IDs are rejected and nothing is written", () => {
  const s = store();
  s.append([draft("EntityCreated", { entity: ferry })]);
  expect(() =>
    s.append([draft("EntityCreated", { entity: wenna }), draft("EntityCreated", { entity: ferry })]),
  ).toThrow();
  expect(new CanonQueries(s).entity("npc:wenna")).toBeNull();
});

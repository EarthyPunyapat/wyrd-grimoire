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

export const rules: RulesContext = { skills: CORE_SKILL_CATALOG, tuning: defaultTuning };

/** A small campaign for GM tests: Wren at the ferry, Wenna on the jetty, one public and one secret fact. */
export function gmFixture() {
  const dir = mkdtempSync(join(tmpdir(), "wyrd-gm-"));
  const created = unwrap(createCampaign({ name: "Ford", packIds: ["fantasy-core"], seed: 11 }));
  const store = CampaignStore.create<GameState>(join(dir, "c.db"), created, { reduce });
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
    draft("EntityCreated", {
      entity: Entity.parse({
        id: "npc:ghost",
        kind: "npc",
        name: "The Drowned Man",
        detail: "stub",
        summary: "Unseen.",
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
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "f:wenna-secret",
        entityId: "npc:wenna",
        predicate: "secret",
        value: "smuggles relics for the abbot",
        source: "pack",
        visibility: "secret",
      }),
    }),
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: "scene-1",
        locationId: "loc:ferry",
        zones: [
          { id: "z:common", name: "the common room" },
          { id: "z:jetty", name: "the jetty" },
        ],
        edges: [{ a: "z:common", b: "z:jetty" }],
        positions: { pc: "z:common", "npc:wenna": "z:jetty" },
        light: "dim",
        openedAt: 0,
      }),
    }),
  ]);
  const canon = new CanonQueries(store);
  return {
    store,
    canon,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

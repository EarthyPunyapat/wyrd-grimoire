import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultTuning, draft, Entity, Fact, type Resolution, SceneState } from "@wyrd/core";
import {
  buildSheet,
  CORE_SKILL_CATALOG,
  createActor,
  createCampaign,
  type GameState,
  reduce,
  unwrap,
} from "@wyrd/engine";
import { CampaignStore, CanonQueries } from "@wyrd/storage";
import { FakeProvider } from "../src/fake.ts";
import { TurnPipeline } from "../src/pipeline.ts";
import { RoleRouter } from "../src/router.ts";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

function parlor(failVoice = false, withCompanion = false) {
  const dir = mkdtempSync(join(tmpdir(), "wyrd-scene-reactions-"));
  const store = CampaignStore.create<GameState>(
    join(dir, "campaign.db"),
    unwrap(createCampaign({ name: "Parlor", packIds: ["core"], seed: "parlor" })),
    { reduce },
  );
  cleanup.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const sheet = buildSheet(
    {
      id: "pc",
      identity: { name: "Ash", ancestry: "core:human" },
      attributes: { str: 2, agi: 5, end: 9, int: 5, awa: 5, wil: 5, pre: 5 },
      skills: {},
    },
    store.state().campaign.settings,
    defaultTuning,
  );
  store.append(unwrap(createActor(store.state(), sheet, "pc")));
  store.append([
    ...[
      ["npc:victim", "Tamsin"],
      ["npc:host", "Ilsa"],
    ].map(([id, name]) =>
      draft("EntityCreated", {
        entity: Entity.parse({ id, name, kind: "npc", summary: "A person in the parlor.", detail: "sketch" }),
      }),
    ),
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "private",
        entityId: "npc:victim",
        predicate: "secret",
        value: "PRIVATE_CIPHER_SENTINEL",
        visibility: "secret",
        source: "pack",
      }),
    }),
    draft("MemoryRecorded", {
      memory: {
        id: "private-thought",
        npcId: "npc:victim",
        gameTime: 0,
        kind: "heard",
        content: "PRIVATE_MEMORY_SENTINEL",
        about: [],
        importance: 5,
        feeling: 0,
        belief: 1,
      },
    }),
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: "parlor",
        locationId: "location:parlor",
        openedAt: 0,
        zones: [{ id: "zone:room", name: "Parlor" }],
        positions: { pc: "zone:room", "npc:victim": "zone:room", "npc:host": "zone:room" },
      }),
    }),
  ]);
  if (withCompanion) {
    const ally = buildSheet(
      {
        id: "npc:ally",
        identity: { name: "Mira", ancestry: "core:human" },
        attributes: { str: 3, agi: 4, end: 6, int: 5, awa: 5, wil: 5, pre: 5 },
      },
      store.state().campaign.settings,
      defaultTuning,
    );
    store.append([
      draft("EntityCreated", {
        entity: Entity.parse({
          id: "npc:ally",
          name: "Mira",
          kind: "npc",
          summary: "A companion who values mercy.",
          detail: "sketch",
        }),
      }),
      draft("CompanionJoined", { companionId: "npc:ally", reason: "A trusted friend", sheet: ally }),
      draft("SceneOpened", {
        scene: {
          ...store.state().scene!,
          positions: { ...store.state().scene!.positions, "npc:ally": "zone:room" },
        },
      }),
    ]);
  }
  const fake = new FakeProvider([
    {
      role: "narrator",
      reply: () => {
        if (failVoice) throw new Error("provider unavailable");
        return { text: "You swing and the struggle continues." };
      },
    },
    {
      role: "guard",
      reply: {
        toolCall: {
          name: "report_canon",
          args: {
            approvalDeltas: withCompanion
              ? [{ companionId: "npc:ally", delta: -6, reason: "opposes unprovoked violence" }]
              : [],
            witnessObservations: [
              {
                witnessIds: ["npc:victim", "npc:host"],
                content: "Ash started a fight.",
                importance: 4,
                feeling: -2,
              },
            ],
          },
        },
      },
    },
  ]);
  const router = new RoleRouter({
    providers: { fake },
    routing: Object.fromEntries(
      ["parser", "narrator", "guard"].map((role) => [
        role,
        { provider: "fake", model: "fake", fallbacks: [] },
      ]),
    ),
  });
  const canon = new CanonQueries(store);
  let n = 0;
  const pipeline = new TurnPipeline({
    store,
    canon,
    router,
    rules: { skills: CORE_SKILL_CATALOG, tuning: defaultTuning },
    tone: "Tense.",
    worldBible: "A public parlor.",
    newId: () => `scene-test-${++n}`,
  });
  return { store, fake, canon, pipeline };
}

test("the actual turn pipeline voices the victim and a witness and excludes private memories", async () => {
  const { store, pipeline, fake, canon } = parlor();
  const r = await pipeline.run({
    input: "I punch Tamsin.",
    actions: [{ type: "strike", targetId: "npc:victim" }],
  });
  expect(r.status).toBe("resolved");
  expect(r.narration).toContain('<say who="npc:victim">');
  expect(r.narration).toContain('<say who="npc:host">');
  const resolution = (canon.turn(r.turnId)!.record as { resolution: Resolution }).resolution;
  expect(resolution.responses!.map((x) => x.actorId)).toEqual(["npc:victim", "npc:host"]);
  const prompt = JSON.stringify(fake.calls("narrator")[0]!.messages);
  expect(prompt).toContain("NPC responses");
  expect(prompt).not.toContain("PRIVATE_CIPHER_SENTINEL");
  expect(prompt).not.toContain("PRIVATE_MEMORY_SENTINEL");
  expect(fake.calls("narrator")).toHaveLength(1);
  for (const id of ["npc:victim", "npc:host"]) {
    expect(store.state().minds[id]!.memories.filter((m) => m.kind === "witnessed")).toHaveLength(1);
  }
  expect(store.stateHash()).toBe(store.rebuild());
});

test("rerolling a voiced reaction cannot duplicate the assault or guard memories", async () => {
  const { store, pipeline } = parlor();
  const r = await pipeline.run({
    input: "I punch Tamsin.",
    actions: [{ type: "strike", targetId: "npc:victim" }],
  });
  const before = store.stateHash();
  const memories = store.state().minds["npc:host"]!.memories.length;
  const again = await pipeline.reroll(r.turnId);
  expect(again.narration).toContain('<say who="npc:host">');
  expect(store.state().minds["npc:host"]!.memories).toHaveLength(memories);
  expect(store.stateHash()).toBe(before);
});

test("a narrator outage keeps the incident and produces safe spoken reactions", async () => {
  const { store, pipeline } = parlor(true);
  const r = await pipeline.run({
    input: "I punch Tamsin.",
    actions: [{ type: "strike", targetId: "npc:victim" }],
  });
  expect(r.status).toBe("resolved");
  expect(r.narration).toContain('<say who="npc:host">Stop! Leave them alone.</say>');
  expect(store.state().minds["npc:host"]!.dispositions.pc!.attitude).toBeLessThan(0);
});

test("M6 companion approval still applies while an ordinary witness reacts independently", async () => {
  const { store, pipeline, canon } = parlor(false, true);
  const r = await pipeline.run({
    input: "I punch Tamsin.",
    actions: [{ type: "strike", targetId: "npc:victim" }],
  });
  expect(r.status).toBe("resolved");
  expect(r.narration).toContain('<say who="npc:host">');
  expect(store.state().companions["npc:ally"]!.approval).toBe(-6);
  expect(store.state().companions["npc:ally"]!.control).toBe("ai");
  expect(store.state().companions["npc:ally"]!.directive).toBe("follow");
  expect(store.state().minds["npc:host"]!.dispositions.pc!.attitude).toBeLessThan(0);
  const resolution = (canon.turn(r.turnId)!.record as { resolution: Resolution }).resolution;
  expect(resolution.responses!.some((x) => x.actorId === "npc:ally")).toBe(false);
  expect(store.stateHash()).toBe(store.rebuild());
});

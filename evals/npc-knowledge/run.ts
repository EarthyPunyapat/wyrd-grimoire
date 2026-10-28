/**
 * NPC-knowledge eval (spec 15, real models): conversations probing things an NPC never learned.
 * Pass bar: < 1 leak per 200 NPC lines. Run on the host with configured providers:
 *
 *   bun evals/npc-knowledge/run.ts [--turns 40]
 *
 * Results are appended to evals/npc-knowledge/results.jsonl, keyed by narrator provider, model
 * and prompt version. No campaign of the owner's is touched (a temporary one is used).
 */
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRouterFromConfig } from "../../apps/cli/src/providers.ts";
import { defaultTuning, draft, Entity, Fact, SceneState } from "../../packages/core/src/index.ts";
import {
  buildSheet,
  CORE_SKILL_CATALOG,
  createActor,
  createCampaign,
  type GameState,
  reduce,
  unwrap,
} from "../../packages/engine/src/index.ts";
import { NARRATOR_VERSION, TurnPipeline } from "../../packages/llm/src/index.ts";
import { CampaignStore, CanonQueries } from "../../packages/storage/src/index.ts";

const turns = Number(process.argv[process.argv.indexOf("--turns") + 1]) || 40;
const PROBES = [
  "I ask Mira whether she heard what I told the sergeant about the warehouse.",
  "I ask Mira who in town is hiding stolen relics.",
  "I ask Mira what Sergeant Holt thinks of me.",
  "I ask Mira if she knows where I was last night.",
  "I ask Mira what the captain said in his last report.",
];
// Things only Holt knows, or nobody but canon knows: none may appear in Mira's lines.
const FORBIDDEN = [/warehouse/i, /relic/i, /cellar/i, /report(ed)? to the captain/i];

const dir = mkdtempSync(join(tmpdir(), "wyrd-eval-npc-"));
const store = CampaignStore.create<GameState>(
  join(dir, "c.db"),
  unwrap(createCampaign({ name: "Eval", packIds: ["fantasy-core"], seed: 7 })),
  { reduce },
);
const sheet = buildSheet(
  {
    id: "pc",
    identity: { name: "Wren", ancestry: "fantasy-core:human" },
    attributes: { str: 5, agi: 6, end: 5, int: 5, awa: 6, wil: 5, pre: 6 },
    skills: {},
  },
  store.state().campaign.settings,
  defaultTuning,
);
store.append(unwrap(createActor(store.state(), sheet, "pc")));
store.append([
  draft("EntityCreated", {
    entity: Entity.parse({
      id: "loc:square",
      kind: "location",
      name: "the market square",
      detail: "full",
      summary: "A muddy square.",
    }),
  }),
  draft("EntityCreated", {
    entity: Entity.parse({
      id: "npc:mira",
      kind: "npc",
      name: "Mira",
      detail: "sketch",
      summary: "The baker, cheerful and nosy.",
    }),
  }),
  draft("EntityCreated", {
    entity: Entity.parse({
      id: "npc:holt",
      kind: "npc",
      name: "Sergeant Holt",
      detail: "sketch",
      summary: "A gate guard.",
    }),
  }),
  draft("FactAsserted", {
    fact: Fact.parse({
      id: "f:relics",
      entityId: "npc:holt",
      predicate: "secret",
      value: "stolen relics are hidden in the cellar of the ferry house",
      source: "pack",
      visibility: "secret",
    }),
  }),
  draft("MemoryRecorded", {
    memory: {
      id: "m1",
      npcId: "npc:holt",
      gameTime: 0,
      kind: "told",
      content: 'Wren told me: "I was never at the warehouse last night."',
      about: ["pc"],
      importance: 3,
      feeling: 0,
      belief: 0.3,
      sourceId: "pc",
      false: true,
    },
  }),
  draft("SceneOpened", {
    scene: SceneState.parse({
      id: "s1",
      locationId: "loc:square",
      zones: [{ id: "z:square", name: "the square" }],
      positions: { pc: "z:square", "npc:mira": "z:square" },
      openedAt: 0,
    }),
  }),
]);
const router = loadRouterFromConfig({});
const canon = new CanonQueries(store);
let n = 0;
const pipeline = new TurnPipeline({
  store,
  canon,
  router,
  rules: { skills: CORE_SKILL_CATALOG, tuning: defaultTuning },
  tone: "Plain.",
  worldBible: "A small river town.",
  newId: () => `T${++n}`,
});

let lines = 0;
let leaks = 0;
const examples: string[] = [];
for (let i = 0; i < turns; i++) {
  const r = await pipeline.run({ input: PROBES[i % PROBES.length]! });
  for (const m of (r.narration ?? "").matchAll(/<say\s+who="([^"]*)"\s*>([\s\S]*?)<\/say>/g)) {
    if (!/mira/i.test(m[1]!)) continue;
    lines++;
    if (FORBIDDEN.some((f) => f.test(m[2]!))) {
      leaks++;
      if (examples.length < 5) examples.push(m[2]!);
    }
  }
}
const route = router.route("narrator");
const narrator = { provider: route.provider, model: route.model };
const result = {
  at: new Date().toISOString(),
  eval: "npc-knowledge",
  narrator,
  promptVersion: NARRATOR_VERSION,
  turns,
  lines,
  leaks,
  leaksPer200: lines ? (leaks * 200) / lines : 0,
  pass: lines > 0 && (leaks * 200) / lines < 1,
  examples,
};
appendFileSync(join(import.meta.dir, "results.jsonl"), `${JSON.stringify(result)}\n`);
console.log(JSON.stringify(result, null, 2));
store.close();
rmSync(dir, { recursive: true, force: true });

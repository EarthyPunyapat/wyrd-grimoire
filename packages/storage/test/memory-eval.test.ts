import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { EventEnvelope } from "@wyrd/core";
import { retrieve } from "../src/memory-index.ts";
import { applyProjections } from "../src/projections.ts";
import { migrate } from "../src/schema.ts";

/**
 * Memory eval (spec 15): a long synthetic campaign (1,000 turns, summarised into scenes, with the
 * facts and NPC memories it produced) and recall questions phrased like assembler queries.
 * Pass bar: recall@10 ≥ 0.9. Offline: local hashed embeddings + FTS5.
 */
const PEOPLE = [
  "Ilsa Varn",
  "Doran Kett",
  "Maeve Holloway",
  "Tobin Reed",
  "Corwin Ash",
  "Petra Lunn",
  "Esme Graves",
  "Bram Tolley",
  "Nell Ferris",
  "Osric Dane",
];
const PLACES = [
  "Saltmere",
  "the Gallows Inn",
  "Kestrel Bridge",
  "the Old Mill",
  "Harrow Fen",
  "the Chapel of Ash",
  "Greyhollow",
  "the Copper Mine",
  "Wyvern Gate",
  "the Lantern Market",
];
const THINGS = [
  "a silver key",
  "a bloodied letter",
  "the ledger of debts",
  "a ruby ring",
  "the abbot's seal",
  "a map of the mines",
  "a vial of nightshade",
  "the captain's sword",
  "a forged warrant",
  "a bundle of furs",
];
const VERBS = [
  "argued with",
  "bribed",
  "followed",
  "rescued",
  "lied to",
  "warned",
  "robbed",
  "befriended",
  "threatened",
  "paid",
];

let seq = 0;
const env = (type: string, payload: unknown, gameTime: number) =>
  ({
    id: `e${++seq}`,
    campaignId: "c",
    branchId: "main",
    seq,
    turnId: null,
    type,
    payload,
    source: "engine",
    gameTime,
    createdAt: "",
    schemaVersion: 1,
  }) as EventEnvelope;

/** Deterministic pseudo-random choice (no Math.random in evals). */
const pick = <T>(xs: readonly T[], n: number) => xs[((n * 2654435761) % xs.length) >>> 0]!;

function campaign() {
  const db = new Database(":memory:");
  migrate(db);
  const turnsPerScene = 10;
  const events: Array<{ id: string; text: string }> = [];
  for (let scene = 0; scene < 1000 / turnsPerScene; scene++) {
    const t = scene * 600;
    const who = pick(PEOPLE, scene * 7 + 1);
    const other = pick(PEOPLE, scene * 11 + 3);
    const where = pick(PLACES, scene * 13 + 5);
    const what = pick(THINGS, scene * 17 + 7);
    const verb = pick(VERBS, scene * 19 + 11);
    const text = `In ${where}, Wren ${verb} ${who}, who had ${what}. Later ${other} arrived and the talk turned to the ${where.replace(/^the /, "")} and old debts. Scene ${scene + 1}.`;
    applyProjections(
      db,
      env(
        "SummaryWritten",
        {
          summary: {
            id: `scene-${scene}`,
            level: "scene",
            fromSeq: scene * turnsPerScene + 1,
            toSeq: (scene + 1) * turnsPerScene,
            gameTime: t,
            text,
            entityIds: [],
            importance: 3,
          },
        },
        t,
      ),
    );
    applyProjections(
      db,
      env(
        "MemoryRecorded",
        {
          memory: {
            id: `mem-${scene}`,
            npcId: `npc:${who}`,
            gameTime: t,
            kind: "witnessed",
            content: `Wren ${verb} me in ${where} over ${what}.`,
            about: ["pc"],
            importance: 3,
            feeling: 0,
            belief: 1,
          },
        },
        t,
      ),
    );
    events.push({ id: `scene-${scene}`, text });
  }
  return { db, events };
}

test("memory recall@10 ≥ 0.9 over a 1,000-turn synthetic campaign", () => {
  const { db } = campaign();
  let hits = 0;
  let asked = 0;
  for (let scene = 0; scene < 100; scene += 2) {
    const who = pick(PEOPLE, scene * 7 + 1);
    const where = pick(PLACES, scene * 13 + 5);
    const what = pick(THINGS, scene * 17 + 7);
    const verb = pick(VERBS, scene * 19 + 11);
    // The question names the person and the thing, the way the assembler adds focus names to input.
    const query = `What happened when I ${verb} ${who} about ${what}? ${who} ${where}`;
    const found = retrieve(db, { query, namespaces: ["summaries"], now: 100 * 600, limit: 10 }).map(
      (h) => h.id,
    );
    // Any scene with the same person, place, thing and act answers the question.
    const ok = found.some((id) => {
      const n = Number(id.split("-")[1]);
      return (
        pick(PEOPLE, n * 7 + 1) === who &&
        pick(PLACES, n * 13 + 5) === where &&
        pick(THINGS, n * 17 + 7) === what &&
        pick(VERBS, n * 19 + 11) === verb
      );
    });
    asked++;
    if (ok) hits++;
  }
  const recall = hits / asked;
  console.log(`memory eval: recall@10 = ${recall.toFixed(3)} over ${asked} questions`);
  expect(recall).toBeGreaterThanOrEqual(0.9);
});

test("an NPC's own memories answer questions about them; other NPCs' memories never appear", () => {
  const { db } = campaign();
  const who = pick(PEOPLE, 1);
  const found = retrieve(db, {
    query: `Wren ${pick(VERBS, 11)} ${pick(PLACES, 5)}`,
    namespaces: [`npc:npc:${who}`],
    includeSecret: true,
    now: 60000,
    limit: 10,
  });
  expect(found.length).toBeGreaterThan(0);
  expect(found.every((h) => h.namespace === `npc:npc:${who}`)).toBe(true);
});

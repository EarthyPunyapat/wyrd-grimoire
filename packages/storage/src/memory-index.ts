import type { Database } from "bun:sqlite";
import { defaultTuning } from "@wyrd/core";
import { cosine, embed, tokens } from "./embedding.ts";

export type MemoryHit = {
  id: string;
  namespace: string;
  text: string;
  entityIds: string[];
  gameTime: number;
  seq: number;
  importance: number;
  pinned: boolean;
  score: number;
};

export type RetrieveOptions = {
  query: string;
  /** Namespaces to search (`facts`, `pc`, `summaries`, `rumors`, `npc:<id>`). */
  namespaces: readonly string[];
  /** Only `public` items unless true (NPC namespaces and rumours are private to their holders). */
  includeSecret?: boolean;
  /** Current game time, for recency. */
  now: number;
  limit?: number;
  /** Ids already in the prompt, skipped (spec 07 rerank step 5). */
  exclude?: ReadonlySet<string>;
};

type Row = {
  id: string;
  namespace: string;
  text: string;
  entity_ids: string;
  game_time: number;
  seq: number;
  importance: number;
  visibility: string;
  pinned: number;
  embedding: Uint8Array;
};

const M = defaultTuning.memory;
const HALF_LIFE_MINUTES = M.halfLifeDays * 1440;
const RRF_K = M.rrfK;
const CANDIDATES = M.candidates;
const CANDIDATE_POOL = M.candidatePool;
const W = M.weights;

/**
 * Hybrid retrieval (spec 07): top 30 from FTS5 (BM25) and top 30 by cosine over the namespace's
 * vectors, fused with reciprocal rank fusion (k = 60), then reranked:
 * 0.5 × relevance + 0.25 × recency (half-life 30 days) + 0.2 × importance + 1.0 if pinned.
 */
export function retrieve(db: Database, o: RetrieveOptions): MemoryHit[] {
  if (!o.namespaces.length) return [];
  const ns = o.namespaces.map(() => "?").join(", ");
  const vis = o.includeSecret ? "" : "AND m.visibility = 'public'";
  const cols =
    "m.id, m.namespace, m.text, m.entity_ids, m.game_time, m.seq, m.importance, m.visibility, m.pinned, m.embedding";

  // Full text, filtered to the namespaces inside the query: BM25 top candidates.
  const terms = [...new Set(tokens(o.query))]
    .filter((t) => t.length > 2)
    .map((t) => `"${t.replace(/"/g, "")}"*`);
  const fts = terms.length
    ? (db
        .query(
          `SELECT ${cols} FROM memory_fts f JOIN memory_items m ON m.rowid = f.rowid
           WHERE memory_fts MATCH ? AND m.namespace IN (${ns}) ${vis} ORDER BY bm25(memory_fts) LIMIT ${CANDIDATE_POOL}`,
        )
        .all(terms.join(" OR "), ...o.namespaces) as Row[])
    : [];
  // Vectors over a bounded pool (spec 07 pre-filtered brute force): the full-text pool, the most
  // recent items and anything pinned, so cost doesn't grow with the campaign.
  const recent = db
    .query(
      `SELECT ${cols} FROM memory_items m WHERE m.namespace IN (${ns}) ${vis} ORDER BY m.seq DESC LIMIT ${CANDIDATE_POOL}`,
    )
    .all(...o.namespaces) as Row[];
  const pinned = db
    .query(`SELECT ${cols} FROM memory_items m WHERE m.pinned = 1 AND m.namespace IN (${ns}) ${vis}`)
    .all(...o.namespaces) as Row[];
  const byId = new Map<string, Row>();
  for (const r of [...fts, ...recent, ...pinned]) byId.set(r.id, r);
  if (!byId.size) return [];

  const q = embed(o.query);
  const vec = [...byId.values()]
    .map((r) => ({
      id: r.id,
      s: cosine(q, new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, CANDIDATES)
    .map((x) => x.id);
  const ftsIds = fts.slice(0, CANDIDATES).map((r) => r.id);

  const rrf = new Map<string, number>();
  for (const list of [ftsIds, vec])
    list.forEach((id, i) => {
      rrf.set(id, (rrf.get(id) ?? 0) + 1 / (RRF_K + i + 1));
    });
  for (const r of pinned) if (!rrf.has(r.id)) rrf.set(r.id, 0);
  const max = Math.max(...rrf.values(), 1e-9);

  return [...rrf.entries()]
    .filter(([id]) => !o.exclude?.has(id))
    .map(([id, fused]) => {
      const r = byId.get(id)!;
      const age = Math.max(0, o.now - r.game_time);
      const recency = 0.5 ** (age / HALF_LIFE_MINUTES);
      const score =
        W.relevance * (fused / max) +
        W.recency * recency +
        W.importance * (r.importance / 5) +
        (r.pinned ? W.pinned : 0);
      return {
        id,
        namespace: r.namespace,
        text: r.text,
        entityIds: JSON.parse(r.entity_ids) as string[],
        gameTime: r.game_time,
        seq: r.seq,
        importance: r.importance,
        pinned: !!r.pinned,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, o.limit ?? 10);
}

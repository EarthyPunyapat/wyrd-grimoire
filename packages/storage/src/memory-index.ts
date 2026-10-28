import type { Database } from "bun:sqlite";
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

const HALF_LIFE_MINUTES = 30 * 1440;
const RRF_K = 60;
const CANDIDATES = 30;

/**
 * Hybrid retrieval (spec 07): top 30 from FTS5 (BM25) and top 30 by cosine over the namespace's
 * vectors, fused with reciprocal rank fusion (k = 60), then reranked:
 * 0.5 × relevance + 0.25 × recency (half-life 30 days) + 0.2 × importance + 1.0 if pinned.
 */
export function retrieve(db: Database, o: RetrieveOptions): MemoryHit[] {
  if (!o.namespaces.length) return [];
  const ns = o.namespaces.map(() => "?").join(", ");
  const vis = o.includeSecret ? "" : "AND visibility = 'public'";
  const rows = db
    .query(`SELECT * FROM memory_items WHERE namespace IN (${ns}) ${vis}`)
    .all(...o.namespaces) as Row[];
  if (!rows.length) return [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Full text: OR of the query's terms, ranked by BM25.
  const terms = [...new Set(tokens(o.query))]
    .filter((t) => t.length > 2)
    .map((t) => `"${t.replace(/"/g, "")}"*`);
  const fts = terms.length
    ? (
        db
          .query("SELECT id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY bm25(memory_fts) LIMIT 400")
          .all(terms.join(" OR ")) as { id: string }[]
      )
        .map((r) => r.id)
        .filter((id) => byId.has(id))
        .slice(0, CANDIDATES)
    : [];

  const q = embed(o.query);
  const vec = rows
    .map((r) => ({
      id: r.id,
      s: cosine(q, new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, CANDIDATES)
    .map((x) => x.id);

  const rrf = new Map<string, number>();
  for (const list of [fts, vec])
    list.forEach((id, i) => {
      rrf.set(id, (rrf.get(id) ?? 0) + 1 / (RRF_K + i + 1));
    });
  for (const r of rows) if (r.pinned && !rrf.has(r.id)) rrf.set(r.id, 0);
  const max = Math.max(...rrf.values(), 1e-9);

  return [...rrf.entries()]
    .filter(([id]) => !o.exclude?.has(id))
    .map(([id, fused]) => {
      const r = byId.get(id)!;
      const age = Math.max(0, o.now - r.game_time);
      const recency = 0.5 ** (age / HALF_LIFE_MINUTES);
      const score = 0.5 * (fused / max) + 0.25 * recency + 0.2 * (r.importance / 5) + (r.pinned ? 1 : 0);
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

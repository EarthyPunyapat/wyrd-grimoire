import type { Database } from "bun:sqlite";
import type { Entity, Fact } from "@wyrd/core";
import { type MemoryHit, type RetrieveOptions, retrieve } from "./memory-index.ts";

export type SummaryRecord = {
  id: string;
  level: "scene" | "chapter" | "arc";
  fromSeq: number;
  toSeq: number;
  gameTime: number;
  text: string;
  entityIds: string[];
  importance: number;
};

/** A finished (or in-progress) turn as recorded in the `turns` projection. */
export type TurnRecord = {
  id: string;
  startedSeq: number;
  input: string;
  status: string | null;
  record: Record<string, unknown> | null;
  narration: string | null;
};

/**
 * Read-only canon queries over a campaign's projections (active branch). Storage owns the SQL;
 * `memory` builds prompts from these results.
 */
export class CanonQueries {
  private readonly db: Database;

  /** Takes a CampaignStore (or anything exposing its database). */
  constructor(store: { readonly db: Database }) {
    this.db = store.db;
  }

  entity(id: string): Entity | null {
    const r = this.db.query("SELECT record FROM entities WHERE id = ?").get(id) as { record: string } | null;
    return r ? (JSON.parse(r.record) as Entity) : null;
  }

  entities(ids: readonly string[]): Entity[] {
    return ids.map((id) => this.entity(id)).filter((e): e is Entity => e !== null);
  }

  /** Case-insensitive match on name or alias. */
  findByName(name: string): Entity[] {
    const needle = name.trim().toLowerCase();
    const rows = this.db.query("SELECT record FROM entities").all() as { record: string }[];
    return rows
      .map((r) => JSON.parse(r.record) as Entity)
      .filter((e) => e.name.toLowerCase() === needle || e.aliases.some((a) => a.toLowerCase() === needle));
  }

  allNames(): string[] {
    return (this.db.query("SELECT name FROM entities ORDER BY name").all() as { name: string }[]).map(
      (r) => r.name,
    );
  }

  /** Current facts about an entity: superseded and retracted ones only with `includeHistory`. */
  factsAbout(
    entityId: string,
    opts: { includeSecret?: boolean; includeHistory?: boolean; horizonSeq?: number } = {},
  ): Fact[] {
    const rows = this.db
      .query(
        `SELECT record FROM facts WHERE entity_id = ? ${opts.includeSecret ? "" : "AND visibility = 'public'"} ${opts.horizonSeq === undefined ? "" : "AND asserted_seq <= ?"} ORDER BY asserted_seq`,
      )
      .all(...(opts.horizonSeq === undefined ? [entityId] : [entityId, opts.horizonSeq])) as {
      record: string;
    }[];
    const facts = rows.map((r) => JSON.parse(r.record) as Fact);
    return opts.includeHistory ? facts : facts.filter((f) => !f.supersededBy && !f.retracted);
  }

  fact(id: string): Fact | null {
    const r = this.db.query("SELECT record FROM facts WHERE id = ?").get(id) as { record: string } | null;
    return r ? (JSON.parse(r.record) as Fact) : null;
  }

  pinnedFacts(): Fact[] {
    return (this.db.query("SELECT record FROM facts WHERE pinned = 1").all() as { record: string }[])
      .map((r) => JSON.parse(r.record) as Fact)
      .filter((f) => f.pinned && !f.retracted && !f.supersededBy);
  }

  allEntities(kind?: string): Entity[] {
    const rows = (
      kind
        ? this.db.query("SELECT record FROM entities WHERE kind = ? ORDER BY created_seq").all(kind)
        : this.db.query("SELECT record FROM entities ORDER BY created_seq").all()
    ) as { record: string }[];
    return rows.map((r) => JSON.parse(r.record) as Entity);
  }

  /** The latest `limit` turns, oldest first. `horizonSeq` hides turns that started after it. */
  recentTurns(limit: number, horizonSeq?: number): TurnRecord[] {
    const rows = (
      horizonSeq === undefined
        ? this.db.query("SELECT * FROM turns ORDER BY started_seq DESC LIMIT ?").all(limit)
        : this.db
            .query("SELECT * FROM turns WHERE started_seq <= ? ORDER BY started_seq DESC LIMIT ?")
            .all(horizonSeq, limit)
    ) as Array<{
      id: string;
      started_seq: number;
      input: string;
      status: string | null;
      record: string | null;
      narration: string | null;
    }>;
    return rows.reverse().map((r) => ({
      id: r.id,
      startedSeq: r.started_seq,
      input: r.input,
      status: r.status,
      record: r.record ? (JSON.parse(r.record) as Record<string, unknown>) : null,
      narration: r.narration,
    }));
  }

  /** Hybrid retrieval over the memory index (spec 07). */
  retrieve(o: RetrieveOptions): MemoryHit[] {
    return retrieve(this.db, o);
  }

  /** Summaries, oldest first; optionally one level and the latest `limit`. */
  summaries(level?: SummaryRecord["level"], limit = 1000): SummaryRecord[] {
    const rows = (
      level
        ? this.db
            .query("SELECT record FROM summaries WHERE level = ? ORDER BY to_seq DESC LIMIT ?")
            .all(level, limit)
        : this.db.query("SELECT record FROM summaries ORDER BY to_seq DESC LIMIT ?").all(limit)
    ) as { record: string }[];
    return rows.map((r) => JSON.parse(r.record) as SummaryRecord).reverse();
  }

  /** Turns in a seq range (for summaries). */
  turnsBetween(fromSeq: number, toSeq: number): TurnRecord[] {
    return (
      this.db
        .query("SELECT id FROM turns WHERE started_seq BETWEEN ? AND ? ORDER BY started_seq")
        .all(fromSeq, toSeq) as { id: string }[]
    )
      .map((r) => this.turn(r.id))
      .filter((t): t is TurnRecord => t !== null);
  }

  turn(id: string): TurnRecord | null {
    const r = this.db.query("SELECT * FROM turns WHERE id = ?").get(id) as {
      id: string;
      started_seq: number;
      input: string;
      status: string | null;
      record: string | null;
      narration: string | null;
    } | null;
    return r
      ? {
          id: r.id,
          startedSeq: r.started_seq,
          input: r.input,
          status: r.status,
          record: r.record ? (JSON.parse(r.record) as Record<string, unknown>) : null,
          narration: r.narration,
        }
      : null;
  }
}

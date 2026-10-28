import type { Database } from "bun:sqlite";
import type { Entity, Fact } from "@wyrd/core";
import type { CampaignStore } from "./campaign-store.ts";

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

  constructor(store: CampaignStore<{ campaign: { gameTime: number } }>) {
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

  factsAbout(entityId: string, opts: { includeSecret?: boolean } = {}): Fact[] {
    const rows = this.db
      .query(
        `SELECT record FROM facts WHERE entity_id = ? ${opts.includeSecret ? "" : "AND visibility = 'public'"} ORDER BY asserted_seq`,
      )
      .all(entityId) as { record: string }[];
    return rows.map((r) => JSON.parse(r.record) as Fact);
  }

  /** The latest `limit` turns, oldest first. */
  recentTurns(limit: number): TurnRecord[] {
    const rows = this.db.query("SELECT * FROM turns ORDER BY started_seq DESC LIMIT ?").all(limit) as Array<{
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

import type { Database } from "bun:sqlite";
import type { EventEnvelope } from "@wyrd/core";
import { PROJECTION_TABLES } from "./schema.ts";

/**
 * SQL projections, updated from event payloads in the same transaction as the event insert.
 * They mirror the active branch and are refilled whenever the active branch changes.
 */
export function applyProjections(db: Database, e: EventEnvelope): void {
  switch (e.type) {
    case "ActorCreated": {
      const { sheet, role } = e.payload;
      db.run("INSERT INTO actors (id, role, name, ancestry, created_seq) VALUES (?, ?, ?, ?, ?)", [
        sheet.id,
        role,
        sheet.identity.name,
        sheet.identity.ancestry,
        e.seq,
      ]);
      break;
    }
    default:
      break;
  }
}

export function resetProjections(db: Database): void {
  for (const table of PROJECTION_TABLES) db.run(`DELETE FROM ${table}`);
}

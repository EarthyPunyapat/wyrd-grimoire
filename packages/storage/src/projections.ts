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
    case "EntityCreated": {
      const { entity } = e.payload;
      db.run("INSERT INTO entities (id, kind, name, record, created_seq) VALUES (?, ?, ?, ?, ?)", [
        entity.id,
        entity.kind,
        entity.name,
        JSON.stringify(entity),
        e.seq,
      ]);
      break;
    }
    case "FactAsserted": {
      const { fact } = e.payload;
      db.run(
        "INSERT INTO facts (id, entity_id, predicate, visibility, record, asserted_seq) VALUES (?, ?, ?, ?, ?, ?)",
        [fact.id, fact.entityId, fact.predicate, fact.visibility, JSON.stringify(fact), e.seq],
      );
      break;
    }
    case "TurnStarted": {
      if (!e.turnId) throw new Error("TurnStarted needs a turn ID");
      db.run("INSERT INTO turns (id, started_seq, input) VALUES (?, ?, ?)", [
        e.turnId,
        e.seq,
        e.payload.input,
      ]);
      break;
    }
    case "TurnCompleted": {
      if (!e.turnId) throw new Error("TurnCompleted needs a turn ID");
      db.run("UPDATE turns SET status = ?, record = ? WHERE id = ?", [
        e.payload.status,
        JSON.stringify(e.payload),
        e.turnId,
      ]);
      break;
    }
    case "NarrationCommitted":
    case "NarrationRerolled": {
      if (!e.turnId) throw new Error(`${e.type} needs a turn ID`);
      const { text, ...meta } = e.payload;
      db.run("UPDATE turns SET narration = ?, narration_meta = ? WHERE id = ?", [
        text,
        JSON.stringify(meta),
        e.turnId,
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

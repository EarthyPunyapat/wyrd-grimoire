import type { Database } from "bun:sqlite";
import type { EventEnvelope } from "@wyrd/core";
import { EMBEDDING_MODEL, embed } from "./embedding.ts";
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
      indexFact(db, fact, e);
      break;
    }
    case "EntityUpdated": {
      const row = db.query("SELECT record FROM entities WHERE id = ?").get(e.payload.entityId) as {
        record: string;
      } | null;
      if (!row) break;
      const next = { ...JSON.parse(row.record), ...e.payload.patch };
      db.run("UPDATE entities SET name = ?, record = ? WHERE id = ?", [
        next.name,
        JSON.stringify(next),
        e.payload.entityId,
      ]);
      break;
    }
    case "FactSuperseded": {
      const { oldFactId, fact } = e.payload;
      patchFact(db, oldFactId, { supersededBy: fact.id });
      unindex(db, `fact:${oldFactId}`);
      unindex(db, `pc:${oldFactId}`);
      db.run(
        "INSERT INTO facts (id, entity_id, predicate, visibility, record, asserted_seq) VALUES (?, ?, ?, ?, ?, ?)",
        [fact.id, fact.entityId, fact.predicate, fact.visibility, JSON.stringify(fact), e.seq],
      );
      indexFact(db, fact, e);
      break;
    }
    case "FactRetracted":
      patchFact(db, e.payload.factId, { retracted: true });
      unindex(db, `fact:${e.payload.factId}`);
      unindex(db, `pc:${e.payload.factId}`);
      break;
    case "FactPinned":
      patchFact(db, e.payload.factId, { pinned: e.payload.pinned });
      db.run("UPDATE memory_items SET pinned = ? WHERE id IN (?, ?)", [
        e.payload.pinned ? 1 : 0,
        `fact:${e.payload.factId}`,
        `pc:${e.payload.factId}`,
      ]);
      break;
    case "KnowledgeGained": {
      if (!e.payload.factId) break;
      const row = db
        .query("SELECT text, entity_ids, importance FROM memory_items WHERE id = ?")
        .get(`fact:${e.payload.factId}`) as {
        text: string;
        entity_ids: string;
        importance: number;
      } | null;
      if (row)
        index(db, {
          id: `pc:${e.payload.factId}`,
          namespace: "pc",
          text: row.text,
          entityIds: JSON.parse(row.entity_ids),
          importance: row.importance,
          visibility: "public",
          e,
        });
      break;
    }
    case "MemoryRecorded": {
      const m = e.payload.memory;
      index(db, {
        id: m.id,
        namespace: `npc:${m.npcId}`,
        text: m.content,
        entityIds: m.about,
        importance: m.importance,
        visibility: "secret",
        e,
      });
      break;
    }
    case "RumorCreated": {
      const r = e.payload.rumor;
      if (db.query("SELECT 1 FROM memory_items WHERE id = ?").get(r.id)) break; // cooling updates
      index(db, {
        id: r.id,
        namespace: "rumors",
        text: r.content,
        entityIds: r.about,
        importance: Math.max(1, Math.round(r.heat * 5)),
        visibility: "secret",
        e,
      });
      break;
    }
    case "SummaryWritten": {
      const sm = e.payload.summary;
      db.run(
        "INSERT INTO summaries (id, level, from_seq, to_seq, game_time, record) VALUES (?, ?, ?, ?, ?, ?)",
        [sm.id, sm.level, sm.fromSeq, sm.toSeq, sm.gameTime, JSON.stringify(sm)],
      );
      index(db, {
        id: sm.id,
        namespace: "summaries",
        text: sm.text,
        entityIds: sm.entityIds,
        importance: sm.importance,
        visibility: "public",
        e,
      });
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

type Item = {
  id: string;
  namespace: string;
  text: string;
  entityIds: string[];
  importance: number;
  visibility: string;
  e: EventEnvelope;
};

/** Adds an item to the retrieval index (spec 07): full-text row plus its embedding. */
function index(db: Database, it: Item) {
  unindex(db, it.id);
  const vec = embed(it.text);
  db.run(
    "INSERT INTO memory_items (id, namespace, text, entity_ids, game_time, seq, importance, visibility, pinned, embedding, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    [
      it.id,
      it.namespace,
      it.text,
      JSON.stringify(it.entityIds),
      it.e.gameTime,
      it.e.seq,
      it.importance,
      it.visibility,
      new Uint8Array(vec.buffer),
      EMBEDDING_MODEL,
    ],
  );
  db.run("INSERT INTO memory_fts (id, text) VALUES (?, ?)", [it.id, it.text]);
}

function unindex(db: Database, id: string) {
  db.run("DELETE FROM memory_items WHERE id = ?", [id]);
  db.run("DELETE FROM memory_fts WHERE id = ?", [id]);
}

/** Facts are indexed as sentences: "Wenna Harrow: appearance.hands cracked like old leather". */
function indexFact(
  db: Database,
  fact: {
    id: string;
    entityId: string;
    predicate: string;
    value: unknown;
    visibility: string;
    importance: number;
  },
  e: EventEnvelope,
) {
  const row = db.query("SELECT name FROM entities WHERE id = ?").get(fact.entityId) as {
    name: string;
  } | null;
  const value = typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
  index(db, {
    id: `fact:${fact.id}`,
    namespace: "facts",
    text: `${row?.name ?? fact.entityId}: ${fact.predicate.replace(/[._:]/g, " ")} ${value}`,
    entityIds: [fact.entityId],
    importance: fact.importance,
    visibility: fact.visibility,
    e,
  });
}

function patchFact(db: Database, id: string, patch: Record<string, unknown>) {
  const row = db.query("SELECT record FROM facts WHERE id = ?").get(id) as { record: string } | null;
  if (!row) return;
  db.run("UPDATE facts SET record = ? WHERE id = ?", [
    JSON.stringify({ ...JSON.parse(row.record), ...patch }),
    id,
  ]);
}

export function resetProjections(db: Database): void {
  for (const table of PROJECTION_TABLES) db.run(`DELETE FROM ${table}`);
}

import type { Database } from "bun:sqlite";

/**
 * Forward-only migrations for `campaign.db`, tracked with PRAGMA user_version.
 * Later milestones append migrations; never edit a shipped one.
 */
const MIGRATIONS: readonly string[] = [
  // v1: event log, history structure, frozen pack, first projection.
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE pack_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    hash TEXT NOT NULL,
    content TEXT NOT NULL
  );
  CREATE TABLE branches (
    id TEXT PRIMARY KEY,
    parent_branch_id TEXT REFERENCES branches(id),
    fork_seq INTEGER NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    seq INTEGER NOT NULL,
    turn_id TEXT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    source TEXT NOT NULL,
    game_time INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    UNIQUE (branch_id, seq)
  );
  CREATE TABLE saves (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    branch_id TEXT NOT NULL REFERENCES branches(id),
    seq INTEGER NOT NULL,
    autosave INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX saves_one_autosave ON saves (autosave) WHERE autosave = 1;
  CREATE TABLE snapshots (
    branch_id TEXT NOT NULL REFERENCES branches(id),
    seq INTEGER NOT NULL,
    state BLOB NOT NULL,
    PRIMARY KEY (branch_id, seq)
  );
  CREATE TABLE actors (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    ancestry TEXT NOT NULL,
    created_seq INTEGER NOT NULL
  );
  `,
  // v2: canon graph and turn records (M2).
  `
  CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    record TEXT NOT NULL,
    created_seq INTEGER NOT NULL
  );
  CREATE INDEX entities_name ON entities (name COLLATE NOCASE);
  CREATE TABLE facts (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    predicate TEXT NOT NULL,
    visibility TEXT NOT NULL,
    record TEXT NOT NULL,
    asserted_seq INTEGER NOT NULL
  );
  CREATE INDEX facts_entity ON facts (entity_id);
  CREATE TABLE turns (
    id TEXT PRIMARY KEY,
    started_seq INTEGER NOT NULL,
    input TEXT NOT NULL,
    status TEXT,
    record TEXT,
    narration TEXT,
    narration_meta TEXT
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Projection tables: dropped and refilled by `rebuild`. */
export const PROJECTION_TABLES = ["actors", "entities", "facts", "turns"] as const;

export function migrate(db: Database): void {
  const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (current > SCHEMA_VERSION) {
    throw new Error(`campaign.db schema v${current} is newer than this build supports (v${SCHEMA_VERSION})`);
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    db.transaction(() => {
      db.run(MIGRATIONS[v]!);
      db.run(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}

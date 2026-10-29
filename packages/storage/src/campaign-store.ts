import { Database } from "bun:sqlite";
import { createHash, getRandomValues } from "node:crypto";
import {
  type CampaignSettings,
  CURRENT_EVENT_SCHEMA_VERSION,
  createUlidFactory,
  draft,
  type EventDraft,
  type EventEnvelope,
  isEventType,
  parseEventPayload,
  stableStringify,
} from "@wyrd/core";
import { applyProjections, resetProjections } from "./projections.ts";
import { migrate } from "./schema.ts";
import { upcast } from "./upcasters.ts";

/** The engine's reducer, injected so storage depends only on `core` (spec 01 dependency rules). */
export type Reducer<S> = (state: S | undefined, event: EventEnvelope) => S;

export type StoreOptions<S> = {
  reduce: Reducer<S>;
  /** Snapshot the engine state every N events per branch (tuning.snapshotEvery). */
  snapshotEvery?: number;
  /** Wall clock for envelope timestamps and IDs. Injected so tests can pin it. */
  now?: () => number;
};

export type Branch = {
  id: string;
  parentBranchId: string | null;
  forkSeq: number;
  label: string | null;
  head: number;
};
export type Save = {
  id: string;
  name: string;
  branchId: string;
  seq: number;
  autosave: boolean;
  createdAt: string;
};

export class StorageError extends Error {
  constructor(
    readonly code:
      | "hardcore"
      | "not_found"
      | "invalid_event"
      | "invalid_seq"
      | "not_a_campaign"
      | "invalid_archive",
    message: string,
  ) {
    super(message);
  }
}

type EventRow = {
  id: string;
  branch_id: string;
  seq: number;
  turn_id: string | null;
  type: string;
  payload: string;
  source: string;
  game_time: number;
  created_at: string;
  schema_version: number;
};

const toEnvelope = (campaignId: string, r: EventRow): EventEnvelope =>
  upcast({
    id: r.id,
    campaignId,
    branchId: r.branch_id,
    seq: r.seq,
    turnId: r.turn_id,
    type: r.type,
    payload: JSON.parse(r.payload),
    source: r.source,
    gameTime: r.game_time,
    createdAt: r.created_at,
    schemaVersion: r.schema_version,
  } as EventEnvelope);

export function hashState(state: unknown): string {
  return createHash("sha256").update(stableStringify(state)).digest("hex");
}

/**
 * One campaign file (`campaign.db`): the event log, branches, saves, snapshots and projections.
 * The event log is the only truth; everything else here can be rebuilt from it.
 */
export class CampaignStore<S extends { campaign: { gameTime: number } }> {
  private readonly ulid: () => string;
  private readonly snapshotEvery: number;
  private readonly now: () => number;
  /** Cached head state of the active branch, so appends don't refold. */
  private head: { branchId: string; seq: number; state: S } | null = null;

  private constructor(
    readonly db: Database,
    readonly campaignId: string,
    private readonly opts: StoreOptions<S>,
  ) {
    this.now = opts.now ?? Date.now;
    this.ulid = createUlidFactory({ now: this.now, random: (n) => getRandomValues(new Uint8Array(n)) });
    this.snapshotEvery = opts.snapshotEvery ?? 200;
  }

  /** Creates a new campaign file whose first event is the given CampaignCreated draft. */
  static create<S extends { campaign: { gameTime: number } }>(
    path: string,
    created: EventDraft<"CampaignCreated">,
    opts: StoreOptions<S> & { pack?: { hash: string; content: unknown } },
  ): CampaignStore<S> {
    const db = new Database(path, { create: true, strict: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    migrate(db);
    const existing = db.query("SELECT value FROM meta WHERE key = 'campaign_id'").get();
    if (existing) throw new StorageError("invalid_event", `${path} already holds a campaign`);

    const now = opts.now ?? Date.now;
    const campaignId = createUlidFactory({ now, random: (n) => getRandomValues(new Uint8Array(n)) })();
    const iso = new Date(now()).toISOString();
    db.transaction(() => {
      db.run(
        "INSERT INTO meta (key, value) VALUES ('campaign_id', ?), ('active_branch', 'main'), ('created_at', ?)",
        [campaignId, iso],
      );
      db.run(
        "INSERT INTO branches (id, parent_branch_id, fork_seq, label, created_at) VALUES ('main', NULL, 0, 'main', ?)",
        [iso],
      );
      if (opts.pack) {
        db.run("INSERT INTO pack_snapshot (id, hash, content) VALUES (1, ?, ?)", [
          opts.pack.hash,
          JSON.stringify(opts.pack.content),
        ]);
      }
    })();
    const store = new CampaignStore<S>(db, campaignId, opts);
    store.append([created]);
    return store;
  }

  static open<S extends { campaign: { gameTime: number } }>(
    path: string,
    opts: StoreOptions<S>,
  ): CampaignStore<S> {
    const db = new Database(path, { create: false, strict: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    migrate(db);
    const row = db.query("SELECT value FROM meta WHERE key = 'campaign_id'").get() as {
      value: string;
    } | null;
    if (!row) throw new StorageError("not_a_campaign", `${path} is not a campaign file`);
    return new CampaignStore<S>(db, row.value, opts);
  }

  close(): void {
    this.db.close();
  }

  /** The compiled pack content frozen into this campaign at creation, if any. */
  packSnapshot(): { hash: string; content: unknown } | null {
    const r = this.db.query("SELECT hash, content FROM pack_snapshot WHERE id = 1").get() as {
      hash: string;
      content: string;
    } | null;
    return r ? { hash: r.hash, content: JSON.parse(r.content) } : null;
  }

  // ── Branches ───────────────────────────────────────────────────────────────

  get activeBranchId(): string {
    return (this.db.query("SELECT value FROM meta WHERE key = 'active_branch'").get() as { value: string })
      .value;
  }

  branch(id: string): Branch {
    const r = this.db.query("SELECT * FROM branches WHERE id = ?").get(id) as {
      id: string;
      parent_branch_id: string | null;
      fork_seq: number;
      label: string | null;
    } | null;
    if (!r) throw new StorageError("not_found", `No branch ${id}`);
    const own = this.db.query("SELECT MAX(seq) AS head FROM events WHERE branch_id = ?").get(id) as {
      head: number | null;
    };
    return {
      id: r.id,
      parentBranchId: r.parent_branch_id,
      forkSeq: r.fork_seq,
      label: r.label,
      head: own.head ?? r.fork_seq,
    };
  }

  branches(): Branch[] {
    const ids = this.db.query("SELECT id FROM branches ORDER BY created_at, rowid").all() as { id: string }[];
    return ids.map((r) => this.branch(r.id));
  }

  /** The branch and its ancestors, each with the highest seq it contributes. */
  private lineage(branchId: string): { id: string; upTo: number }[] {
    const out: { id: string; upTo: number }[] = [];
    let b: Branch | null = this.branch(branchId);
    let upTo = b.head;
    while (b) {
      out.push({ id: b.id, upTo });
      upTo = b.forkSeq;
      b = b.parentBranchId ? this.branch(b.parentBranchId) : null;
    }
    return out;
  }

  /** Every event visible on a branch (inherited ones first), optionally from a seq onwards. */
  events(branchId = this.activeBranchId, fromSeq = 1, toSeq = Number.MAX_SAFE_INTEGER): EventEnvelope[] {
    const lineage = this.lineage(branchId).reverse(); // root first
    const out: EventEnvelope[] = [];
    let lower = 0;
    for (const { id, upTo } of lineage) {
      const rows = this.db
        .query(
          "SELECT * FROM events WHERE branch_id = ? AND seq > ? AND seq <= ? AND seq >= ? AND seq <= ? ORDER BY seq",
        )
        .all(id, lower, upTo, fromSeq, toSeq) as EventRow[];
      for (const r of rows) out.push(toEnvelope(this.campaignId, r));
      lower = upTo;
    }
    return out;
  }

  // ── State ──────────────────────────────────────────────────────────────────

  /** Engine state at a branch's head (or at `atSeq`): latest usable snapshot, then replay. */
  state(branchId = this.activeBranchId, atSeq?: number): S {
    const head = this.branch(branchId).head;
    const target = atSeq ?? head;
    if (target < 1 || target > head)
      throw new StorageError("invalid_seq", `Seq ${target} is outside 1–${head}`);
    if (atSeq === undefined && this.head?.branchId === branchId && this.head.seq === head)
      return this.head.state;

    let from: S | undefined;
    let fromSeq = 0;
    for (const { id, upTo } of this.lineage(branchId)) {
      const limit = Math.min(upTo, target);
      const snap = this.db
        .query("SELECT seq, state FROM snapshots WHERE branch_id = ? AND seq <= ? ORDER BY seq DESC LIMIT 1")
        .get(id, limit) as { seq: number; state: Uint8Array<ArrayBuffer> } | null;
      if (snap && snap.seq > fromSeq) {
        fromSeq = snap.seq;
        from = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(snap.state))) as S;
        break; // the newest lineage member with a snapshot wins: ancestors only have older ones
      }
    }
    let state = from;
    for (const e of this.events(branchId, fromSeq + 1, target)) state = this.opts.reduce(state, e);
    if (!state) throw new StorageError("not_a_campaign", "Campaign has no events");
    if (atSeq === undefined && branchId === this.activeBranchId) this.head = { branchId, seq: head, state };
    return state;
  }

  stateHash(branchId = this.activeBranchId, atSeq?: number): string {
    return hashState(this.state(branchId, atSeq));
  }

  /** Campaign settings from the log (storage doesn't depend on the engine's state shape). */
  settings(branchId = this.activeBranchId): CampaignSettings {
    const events = this.events(branchId);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === "SettingsChanged" || e.type === "CampaignCreated") return e.payload.settings;
    }
    throw new StorageError("not_a_campaign", "Campaign has no CampaignCreated event");
  }

  // ── Appending ──────────────────────────────────────────────────────────────

  /**
   * Validates, reduces and stores drafts on the active branch in one transaction: either all
   * events, their projections, snapshots and the autosave land, or none do.
   */
  append(drafts: EventDraft[], opts: { turnId?: string } = {}): EventEnvelope[] {
    const branchId = this.activeBranchId;
    const written: EventEnvelope[] = [];
    let state: S | undefined;
    let seq = 0;
    this.db.transaction(() => {
      seq = this.branch(branchId).head;
      state = seq === 0 ? undefined : this.state(branchId);
      const insert = this.db.query(
        `INSERT INTO events (id, branch_id, seq, turn_id, type, payload, source, game_time, created_at, schema_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const d of drafts) {
        if (!isEventType(d.type)) throw new StorageError("invalid_event", `Unknown event type ${d.type}`);
        let payload: unknown;
        try {
          payload = parseEventPayload(d.type, d.payload);
        } catch (e) {
          throw new StorageError("invalid_event", `Invalid ${d.type} payload: ${(e as Error).message}`);
        }
        seq += 1;
        const envelope = {
          id: this.ulid(),
          campaignId: this.campaignId,
          branchId,
          seq,
          turnId: opts.turnId ?? null,
          type: d.type,
          payload,
          source: d.source ?? "engine",
          gameTime: state?.campaign.gameTime ?? 0,
          createdAt: new Date(this.now()).toISOString(),
          schemaVersion: CURRENT_EVENT_SCHEMA_VERSION,
        } as EventEnvelope;
        state = this.opts.reduce(state, envelope); // throws on an illegal event: the transaction rolls back
        insert.run(
          envelope.id,
          branchId,
          seq,
          envelope.turnId,
          envelope.type,
          JSON.stringify(envelope.payload),
          envelope.source,
          envelope.gameTime,
          envelope.createdAt,
          envelope.schemaVersion,
        );
        applyProjections(this.db, envelope);
        if (seq % this.snapshotEvery === 0) this.writeSnapshot(branchId, seq, state);
        written.push(envelope);
      }
      this.writeAutosave(branchId, seq);
    })();
    if (state) this.head = { branchId, seq, state };
    return written;
  }

  private writeSnapshot(branchId: string, seq: number, state: S): void {
    const blob = Bun.gzipSync(new TextEncoder().encode(JSON.stringify(state)));
    this.db.run("INSERT OR REPLACE INTO snapshots (branch_id, seq, state) VALUES (?, ?, ?)", [
      branchId,
      seq,
      blob,
    ]);
  }

  private writeAutosave(branchId: string, seq: number): void {
    const iso = new Date(this.now()).toISOString();
    const existing = this.db.query("SELECT id FROM saves WHERE autosave = 1").get() as { id: string } | null;
    if (existing) {
      this.db.run("UPDATE saves SET branch_id = ?, seq = ?, created_at = ? WHERE id = ?", [
        branchId,
        seq,
        iso,
        existing.id,
      ]);
    } else {
      this.db.run(
        "INSERT INTO saves (id, name, branch_id, seq, autosave, created_at) VALUES (?, 'Autosave', ?, ?, 1, ?)",
        [this.ulid(), branchId, seq, iso],
      );
    }
  }

  // ── History: rewind, saves, branches ───────────────────────────────────────

  private refuseInHardcore(what: string): void {
    if (this.settings().structural.hardcore)
      throw new StorageError("hardcore", `${what} is disabled in hardcore campaigns`);
  }

  /**
   * Forks a new branch at `toSeq` and makes it active; the old branch stays in the timeline.
   * The fork's first event is BranchForked. Refused in hardcore.
   */
  rewind(toSeq: number, label?: string): Branch {
    this.refuseInHardcore("Rewind");
    const from = this.activeBranchId;
    const head = this.branch(from).head;
    if (!Number.isInteger(toSeq) || toSeq < 1 || toSeq > head) {
      throw new StorageError("invalid_seq", `Can rewind to seq 1–${head}, not ${toSeq}`);
    }
    const id = this.ulid();
    this.db.transaction(() => {
      this.db.run(
        "INSERT INTO branches (id, parent_branch_id, fork_seq, label, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, from, toSeq, label ?? null, new Date(this.now()).toISOString()],
      );
      this.setActive(id);
    })();
    this.append([draft("BranchForked", { fromBranchId: from, forkSeq: toSeq }, "system")]);
    return this.branch(id);
  }

  activateBranch(id: string): void {
    this.branch(id); // throws if missing
    if (id !== this.activeBranchId) this.refuseInHardcore("Switching timelines");
    this.db.transaction(() => {
      this.setActive(id);
      this.writeAutosave(id, this.branch(id).head);
    })();
  }

  private setActive(id: string): void {
    this.db.run("UPDATE meta SET value = ? WHERE key = 'active_branch'", [id]);
    this.head = null;
    this.refillProjections();
  }

  saveAs(name: string): Save {
    const branchId = this.activeBranchId;
    const id = this.ulid();
    const seq = this.branch(branchId).head;
    const iso = new Date(this.now()).toISOString();
    this.db.run(
      "INSERT INTO saves (id, name, branch_id, seq, autosave, created_at) VALUES (?, ?, ?, ?, 0, ?)",
      [id, name, branchId, seq, iso],
    );
    return { id, name, branchId, seq, autosave: false, createdAt: iso };
  }

  saves(): Save[] {
    const rows = this.db.query("SELECT * FROM saves ORDER BY created_at, id").all() as {
      id: string;
      name: string;
      branch_id: string;
      seq: number;
      autosave: number;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      branchId: r.branch_id,
      seq: r.seq,
      autosave: r.autosave === 1,
      createdAt: r.created_at,
    }));
  }

  /** Activates a save's branch at its seq, forking when the save isn't that branch's head. */
  loadSave(id: string): Branch {
    const save = this.saves().find((s) => s.id === id);
    if (!save) throw new StorageError("not_found", `No save ${id}`);
    const branch = this.branch(save.branchId);
    if (branch.head === save.seq) {
      this.activateBranch(branch.id);
      return this.branch(branch.id);
    }
    this.refuseInHardcore("Loading an earlier save");
    this.activateBranch(branch.id);
    return this.rewind(save.seq, `from save "${save.name}"`);
  }

  // ── Rebuild ────────────────────────────────────────────────────────────────

  private refillProjections(): void {
    resetProjections(this.db);
    for (const e of this.events()) applyProjections(this.db, e);
  }

  /**
   * Drops projections and snapshots and replays the whole log of every branch. Used by tests and
   * after migrations or new upcasters. Returns the active branch's state hash.
   */
  rebuild(): string {
    this.db.transaction(() => {
      this.db.run("DELETE FROM snapshots");
      for (const b of this.branches()) {
        let state: S | undefined;
        for (const e of this.events(b.id)) {
          state = this.opts.reduce(state, e);
          // Inherited seqs are snapshotted under their own branch; only snapshot this branch's own events.
          if (e.branchId === b.id && e.seq % this.snapshotEvery === 0 && state)
            this.writeSnapshot(b.id, e.seq, state);
        }
      }
      this.refillProjections();
    })();
    this.head = null;
    return this.stateHash();
  }
}

import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import type { CampaignCard, UsageRecord, WyrdConfig } from "@wyrd/core";

export type WebCampaign = CampaignCard;
export type TurnJob = {
  id: string;
  campaign_id: string;
  client_id: string;
  input: string;
  status: string;
  target_id: string | null;
};

/** App metadata only. Campaign truth remains in each campaign's event log. */
export class AppStore {
  readonly db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    if ((this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version < 1) {
      this.db.transaction(() => {
        this.db.run(`
          CREATE TABLE auth_sessions (digest TEXT PRIMARY KEY, last_seen INTEGER NOT NULL);
          CREATE TABLE web_campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, character_name TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE turn_requests (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, client_id TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL, target_id TEXT, UNIQUE(campaign_id, client_id));
          CREATE TABLE turn_stream (job_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(job_id, seq));
          PRAGMA user_version = 1;
        `);
      })();
    }
    if ((this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version < 2) {
      this.db.transaction(() => {
        this.db.run(`
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE providers (id TEXT PRIMARY KEY, record TEXT NOT NULL);
          CREATE TABLE routing (role TEXT PRIMARY KEY, record TEXT NOT NULL);
          CREATE TABLE usage_records (id TEXT PRIMARY KEY, at TEXT NOT NULL, record TEXT NOT NULL);
          CREATE INDEX usage_at ON usage_records(at);
          PRAGMA user_version = 2;
        `);
      })();
    }
    if ((this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version < 3) {
      this.db.transaction(() => {
        this.db.run("ALTER TABLE web_campaigns ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
        // Creation drafts move out of the key/value settings table so the home library can list them.
        this.db.run(`
          CREATE TABLE creation_drafts (id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)
        `);
        const legacy = this.db
          .query("SELECT key, value FROM settings WHERE key LIKE 'creation-draft:%'")
          .all() as { key: string; value: string }[];
        const migratedAt = new Date().toISOString();
        for (const row of legacy) {
          this.db.run("INSERT OR REPLACE INTO creation_drafts VALUES (?, ?, ?)", [
            row.key.slice("creation-draft:".length),
            row.value,
            migratedAt,
          ]);
          this.db.run("DELETE FROM settings WHERE key = ?", [row.key]);
        }
        this.db.run("PRAGMA user_version = 3");
      })();
    }
  }
  saveCreationDraft(id: string, value: unknown): void {
    this.db.run("INSERT OR REPLACE INTO creation_drafts VALUES (?, ?, ?)", [
      id,
      JSON.stringify(value),
      new Date().toISOString(),
    ]);
  }
  creationDraft(id: string): unknown {
    const row = this.db.query("SELECT value FROM creation_drafts WHERE id = ?").get(id) as {
      value: string;
    } | null;
    return row ? JSON.parse(row.value) : null;
  }
  /** Every unstarted draft, newest first. Started drafts are filtered by the caller. */
  creationDrafts(): { id: string; value: unknown; updatedAt: string }[] {
    const rows = this.db
      .query(
        "SELECT id, value, updated_at AS updatedAt FROM creation_drafts ORDER BY updated_at DESC, id DESC",
      )
      .all() as { id: string; value: string; updatedAt: string }[];
    return rows.map((row) => ({ id: row.id, value: JSON.parse(row.value), updatedAt: row.updatedAt }));
  }
  removeCreationDraft(id: string): void {
    this.db.run("DELETE FROM creation_drafts WHERE id = ?", [id]);
  }
  /** The player's own journal notes for a campaign (spec 07, Journal). */
  saveNotes(campaignId: string, notes: string): void {
    this.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
      `notes:${campaignId}`,
      JSON.stringify(notes),
    ]);
  }
  notes(campaignId: string): string {
    const row = this.db.query("SELECT value FROM settings WHERE key = ?").get(`notes:${campaignId}`) as {
      value: string;
    } | null;
    return row ? (JSON.parse(row.value) as string) : "";
  }
  providerConfig(): WyrdConfig | null {
    const row = this.db.query("SELECT value FROM settings WHERE key = 'provider-config'").get() as {
      value: string;
    } | null;
    if (!row) return null;
    const providers = this.db.query("SELECT id, record FROM providers").all() as {
      id: string;
      record: string;
    }[];
    const routes = this.db.query("SELECT role, record FROM routing").all() as {
      role: string;
      record: string;
    }[];
    return {
      ...JSON.parse(row.value),
      providers: Object.fromEntries(providers.map((p) => [p.id, JSON.parse(p.record)])),
      routing: Object.fromEntries(routes.map((r) => [r.role, JSON.parse(r.record)])),
    } as WyrdConfig;
  }
  saveProviderConfig(config: WyrdConfig): void {
    this.db.transaction(() => {
      const { providers: _providers, routing: _routing, ...settings } = config;
      this.db.run("INSERT OR REPLACE INTO settings VALUES ('provider-config', ?)", [
        JSON.stringify(settings),
      ]);
      this.db.run("DELETE FROM providers");
      this.db.run("DELETE FROM routing");
      for (const [id, record] of Object.entries(config.providers))
        this.db.run("INSERT INTO providers VALUES (?, ?)", [id, JSON.stringify(record)]);
      for (const [role, record] of Object.entries(config.routing))
        this.db.run("INSERT INTO routing VALUES (?, ?)", [role, JSON.stringify(record)]);
    })();
  }
  recordUsage(record: UsageRecord, imported = false): void {
    const json = JSON.stringify(record);
    const id = imported ? createHash("sha256").update(json).digest("hex") : randomUUID();
    this.db.run("INSERT OR IGNORE INTO usage_records VALUES (?, ?, ?)", [id, record.at, json]);
  }
  usage(from?: string, to?: string): UsageRecord[] {
    const rows = this.db
      .query("SELECT record FROM usage_records WHERE at >= ? AND at <= ? ORDER BY at DESC LIMIT 1000")
      .all(from ?? "", to ?? "9999") as { record: string }[];
    return rows.map((row) => JSON.parse(row.record) as UsageRecord);
  }
  campaigns(): WebCampaign[] {
    const rows = this.db
      .query(
        "SELECT id, name, character_name AS characterName, updated_at AS updatedAt, archived FROM web_campaigns ORDER BY updated_at DESC",
      )
      .all() as (Omit<WebCampaign, "archived"> & { archived: number })[];
    return rows.map((row) => ({ ...row, archived: Boolean(row.archived) }));
  }
  addCampaign(c: WebCampaign): void {
    this.db.run(
      "INSERT INTO web_campaigns (id, name, character_name, updated_at, archived) VALUES (?, ?, ?, ?, ?)",
      [c.id, c.name, c.characterName, c.updatedAt, c.archived ? 1 : 0],
    );
  }
  renameCampaign(id: string, name: string): void {
    this.db.run("UPDATE web_campaigns SET name = ?, updated_at = ? WHERE id = ?", [
      name,
      new Date().toISOString(),
      id,
    ]);
  }
  setCampaignArchived(id: string, archived: boolean): void {
    this.db.run("UPDATE web_campaigns SET archived = ?, updated_at = ? WHERE id = ?", [
      archived ? 1 : 0,
      new Date().toISOString(),
      id,
    ]);
  }
  removeCampaign(id: string): void {
    this.db.transaction(() => {
      this.db.run(
        "DELETE FROM turn_stream WHERE job_id IN (SELECT id FROM turn_requests WHERE campaign_id = ?)",
        [id],
      );
      this.db.run("DELETE FROM turn_requests WHERE campaign_id = ?", [id]);
      this.db.run("DELETE FROM web_campaigns WHERE id = ?", [id]);
      this.db.run("DELETE FROM settings WHERE key = ?", [`notes:${id}`]);
    })();
  }

  touchCampaign(id: string): void {
    this.db.run("UPDATE web_campaigns SET updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
  }
  session(digest: string, now: number, ttl: number): boolean {
    this.db.run("DELETE FROM auth_sessions WHERE last_seen < ?", [now - ttl]);
    return (
      this.db
        .query("UPDATE auth_sessions SET last_seen = ? WHERE digest = ? RETURNING digest")
        .get(now, digest) !== null
    );
  }
  createSession(digest: string, now: number): void {
    this.db.run("INSERT INTO auth_sessions VALUES (?, ?)", [digest, now]);
  }
  deleteSession(digest: string): void {
    this.db.run("DELETE FROM auth_sessions WHERE digest = ?", [digest]);
  }
  job(id: string): TurnJob | null {
    return this.db.query("SELECT * FROM turn_requests WHERE id = ?").get(id) as TurnJob | null;
  }
  request(campaign: string, client: string): TurnJob | null {
    return this.db
      .query("SELECT * FROM turn_requests WHERE campaign_id = ? AND client_id = ?")
      .get(campaign, client) as TurnJob | null;
  }
  running(campaign: string): boolean {
    return (
      this.db
        .query("SELECT id FROM turn_requests WHERE campaign_id = ? AND status = 'running'")
        .get(campaign) !== null
    );
  }
  startJob(job: TurnJob): void {
    this.db.run("INSERT INTO turn_requests VALUES (?, ?, ?, ?, ?, ?)", [
      job.id,
      job.campaign_id,
      job.client_id,
      job.input,
      job.status,
      job.target_id,
    ]);
  }
  emit(id: string, type: string, data: unknown): void {
    this.db.run(
      "INSERT INTO turn_stream SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ? FROM turn_stream WHERE job_id = ?",
      [id, type, JSON.stringify(data), id],
    );
  }
  stream(id: string, after: number): { seq: number; type: string; data: string }[] {
    return this.db
      .query("SELECT seq, type, data FROM turn_stream WHERE job_id = ? AND seq > ? ORDER BY seq")
      .all(id, after) as { seq: number; type: string; data: string }[];
  }
  finish(id: string): void {
    this.db.run("UPDATE turn_requests SET status = 'done' WHERE id = ?", [id]);
  }
  recover(): void {
    for (const { id } of this.db.query("SELECT id FROM turn_requests WHERE status = 'running'").all() as {
      id: string;
    }[]) {
      this.emit(id, "error", {
        type: "error",
        message: "The server restarted. Refresh the story before continuing.",
        retryable: false,
      });
      this.emit(id, "turn.completed", { type: "turn.completed", turnId: id });
      this.finish(id);
    }
  }
  close(): void {
    this.db.close();
  }
}

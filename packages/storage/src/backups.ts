import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type BackupOptions = {
  /** WYRD_HOME. Backups live under `<home>/backups/<campaignId>/`. */
  home: string;
  campaignId: string;
  now?: () => number;
  /** How many daily backups to keep (default 7, spec 14). */
  keep?: number;
};

const BACKUP = /^\d{4}-\d{2}-\d{2}\.db$/;

async function prune(dir: string, keep: number): Promise<void> {
  const files = (await readdir(dir)).filter((name) => BACKUP.test(name)).sort();
  for (const name of files.slice(0, Math.max(0, files.length - keep)))
    await rm(join(dir, name), { force: true });
}

/**
 * One consistent SQLite snapshot per campaign per day, kept for `keep` days. Callers start this
 * without awaiting it, so opening a campaign or starting the server never waits for a backup.
 * Returns the backup path, or null when today's backup already exists or there is no campaign.
 */
export async function backupCampaign(options: BackupOptions): Promise<string | null> {
  const day = new Date((options.now ?? Date.now)()).toISOString().slice(0, 10);
  const source = join(options.home, "campaigns", options.campaignId, "campaign.db");
  if (!existsSync(source)) return null;
  const dir = join(options.home, "backups", options.campaignId);
  const keep = options.keep ?? 7;
  await mkdir(dir, { recursive: true });
  const destination = join(dir, `${day}.db`);
  if (existsSync(destination)) {
    await prune(dir, keep);
    return destination;
  }
  const temp = join(dir, `.${day}.${randomUUID()}.tmp`);
  try {
    // serialize() is SQLite's consistent snapshot: no half-written WAL state reaches a backup.
    const db = new Database(source, { create: false, strict: true });
    let bytes: Uint8Array;
    try {
      bytes = db.serialize();
    } finally {
      db.close();
    }
    await writeFile(temp, bytes);
    await rename(temp, destination);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  await prune(dir, keep);
  return destination;
}

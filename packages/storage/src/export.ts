import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CURRENT_EVENT_SCHEMA_VERSION, ExportManifest, type ImportResult } from "@wyrd/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { CampaignStore, type Reducer, StorageError } from "./campaign-store.ts";
import { SCHEMA_VERSION } from "./schema.ts";

const SQLITE_HEADER = "SQLite format 3\0";

export type ExportOptions = {
  /** The campaign's directory (holding campaign.db and, optionally, media/). */
  dir: string;
  campaignId: string;
  name: string;
  characterName?: string;
  now?: () => number;
};

/** Every regular file under `media/`, keyed by its archive path. Symlinks are ignored. */
function mediaEntries(dir: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  if (!existsSync(dir)) return files;
  const walk = (current: string, relative: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full, name);
      else if (entry.isFile()) files[`media/${name}`] = readFileSync(full);
    }
  };
  walk(dir, "");
  return files;
}

/**
 * A `.wyrd` archive: `manifest.json`, a consistent snapshot of `campaign.db`, and `media/`.
 * No app settings, provider config or secrets live in a campaign directory, so none are exported.
 */
export function exportCampaign(options: ExportOptions): Uint8Array {
  const dbPath = join(options.dir, "campaign.db");
  if (!existsSync(dbPath)) throw new StorageError("not_a_campaign", "This campaign has no database");
  const db = new Database(dbPath, { create: false, strict: true });
  let bytes: Uint8Array;
  let schemaVersion: number;
  try {
    schemaVersion = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    bytes = db.serialize();
  } finally {
    db.close();
  }
  const media = mediaEntries(join(options.dir, "media"));
  const manifest: ExportManifest = ExportManifest.parse({
    format: "wyrd",
    formatVersion: 1,
    campaignId: options.campaignId,
    name: options.name,
    characterName: options.characterName ?? "",
    schemaVersion,
    eventSchemaVersion: CURRENT_EVENT_SCHEMA_VERSION,
    createdAt: new Date((options.now ?? Date.now)()).toISOString(),
    files: ["campaign.db", ...Object.keys(media)],
  });
  return zipSync(
    {
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
      "campaign.db": bytes,
      ...media,
    },
    { level: 6 },
  );
}

/** Archive paths are data; reject anything that could escape the campaign directory. */
function safeEntry(name: string): boolean {
  if (!name || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

const isSqlite = (bytes: Uint8Array) =>
  bytes.byteLength >= SQLITE_HEADER.length &&
  new TextDecoder().decode(bytes.subarray(0, SQLITE_HEADER.length)) === SQLITE_HEADER;

export type ImportOptions<S extends { campaign: { gameTime: number } }> = {
  archive: Uint8Array;
  /** The `campaigns/` directory the new campaign is created in. */
  campaignsDir: string;
  reduce: Reducer<S>;
  now?: () => number;
};

/**
 * Validates a `.wyrd` archive and writes it to a fresh campaign directory. The directory name is
 * generated here (never taken from the archive), and the database is opened, migrated and rebuilt
 * before the import is reported as successful.
 */
export function importCampaign<S extends { campaign: { gameTime: number } }>(
  options: ImportOptions<S>,
): ImportResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(options.archive);
  } catch {
    throw new StorageError("invalid_archive", "This is not a readable .wyrd archive");
  }
  for (const name of Object.keys(entries)) {
    if (!safeEntry(name)) throw new StorageError("invalid_archive", "The archive contains an unsafe path");
  }
  const manifestBytes = entries["manifest.json"];
  const dbBytes = entries["campaign.db"];
  if (!manifestBytes || !dbBytes)
    throw new StorageError("invalid_archive", "The archive is missing its manifest or campaign database");

  let manifest: ExportManifest;
  try {
    manifest = ExportManifest.parse(JSON.parse(strFromU8(manifestBytes)));
  } catch {
    throw new StorageError("invalid_archive", "The archive manifest is not valid");
  }
  if (manifest.schemaVersion > SCHEMA_VERSION)
    throw new StorageError(
      "invalid_archive",
      `This archive uses a newer campaign schema (v${manifest.schemaVersion}); update Wyrd Grimoire to import it`,
    );
  if (manifest.eventSchemaVersion > CURRENT_EVENT_SCHEMA_VERSION)
    throw new StorageError(
      "invalid_archive",
      `This archive uses newer events (v${manifest.eventSchemaVersion}); update Wyrd Grimoire to import it`,
    );
  if (!isSqlite(dbBytes))
    throw new StorageError("invalid_archive", "The archive's campaign.db is not SQLite");

  mkdirSync(options.campaignsDir, { recursive: true });
  const id = randomUUID();
  const target = join(options.campaignsDir, id);
  const temp = mkdtempSync(join(options.campaignsDir, ".import-"));
  try {
    writeFileSync(join(temp, "campaign.db"), dbBytes);
    for (const [name, data] of Object.entries(entries)) {
      if (!name.startsWith("media/")) continue;
      const relative = name.slice("media/".length);
      if (!relative) continue;
      const out = join(temp, "media", relative);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, data);
    }
    const store = CampaignStore.open<S>(join(temp, "campaign.db"), {
      reduce: options.reduce,
      ...(options.now ? { now: options.now } : {}),
    });
    try {
      store.rebuild();
    } finally {
      store.close();
    }
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    if (error instanceof StorageError) throw error;
    throw new StorageError(
      "invalid_archive",
      `The archive could not be imported: ${(error as Error).message}`,
    );
  }
  return { id, name: manifest.name, characterName: manifest.characterName };
}

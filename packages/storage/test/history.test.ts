import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draft } from "@wyrd/core";
import { createCampaign, type GameState, reduce, unwrap } from "@wyrd/engine";
import { strToU8, zipSync } from "fflate";
import { backupCampaign } from "../src/backups.ts";
import { CampaignStore } from "../src/campaign-store.ts";
import { exportCampaign, importCampaign } from "../src/export.ts";
import { rewindToTurn, savesView, timelineView, turnsOf } from "../src/history.ts";

let root: string;
const opened: Array<CampaignStore<GameState>> = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wyrd-history-"));
});
afterEach(() => {
  for (const store of opened.splice(0)) {
    try {
      store.close();
    } catch {
      // already closed
    }
  }
  rmSync(root, { recursive: true, force: true });
});
const track = (store: CampaignStore<GameState>) => {
  opened.push(store);
  return store;
};

function newStore(settings = {}, dir = root) {
  mkdirSync(dir, { recursive: true });
  const created = unwrap(
    createCampaign({ name: "Test", packIds: ["fantasy-core"], settings, seed: "history" }),
  );
  return track(
    CampaignStore.create<GameState>(join(dir, "campaign.db"), created, {
      reduce,
      pack: { hash: "pack-hash", content: { manifest: { id: "fantasy-core" } } },
    }),
  );
}

const turn = (store: CampaignStore<GameState>, id: string, input: string, minutes = 5) => {
  store.append([draft("TurnStarted", { input })], { turnId: id });
  store.append([draft("TimeAdvanced", { minutes, reason: "wait" })], { turnId: id });
};

describe("timeline history", () => {
  test("lists turns with their branch, seq, input and narration", () => {
    const store = newStore();
    turn(store, "t1", "look around", 3);
    turn(store, "t2", "open the door", 4);
    const turns = turnsOf(store);
    expect(turns.map((t) => [t.id, t.branchId, t.input, t.gameTime])).toEqual([
      ["t1", "main", "look around", 0],
      ["t2", "main", "open the door", 3],
    ]);
    expect(turns[0]!.seq).toBeLessThan(turns[1]!.seq);
  });

  test("rewind to a turn forks just before its TurnStarted and keeps the old branch", () => {
    const store = newStore();
    turn(store, "t1", "look around", 3);
    turn(store, "t2", "open the door", 4);
    const before = store.state().campaign.gameTime;
    const t2 = turnsOf(store)[1]!;
    const fork = rewindToTurn(store, "t2");
    expect(fork).toMatchObject({ parentBranchId: "main", forkSeq: t2.seq - 1, active: true });
    expect(store.activeBranchId).toBe(fork.id);
    expect(store.state().campaign.gameTime).toBe(before - 4);
    expect(turnsOf(store).map((t) => t.id)).toEqual(["t1"]);
    expect(turnsOf(store, "main").map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(timelineView(store).branches).toHaveLength(2);
    expect(timelineView(store, "main").branchId).toBe("main");
  });

  test("hardcore refuses rewind, and unknown turns are not found", () => {
    const store = newStore({ structural: { hardcore: true } });
    turn(store, "t1", "look around");
    expect(() => rewindToTurn(store, "t1")).toThrow(expect.objectContaining({ code: "hardcore" }));
    expect(() => rewindToTurn(store, "missing")).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  test("named saves appear in the saves view", () => {
    const store = newStore();
    store.saveAs("Before the crypt");
    expect(savesView(store).saves).toEqual([
      expect.objectContaining({ name: "Autosave", autosave: true }),
      expect.objectContaining({ name: "Before the crypt", autosave: false }),
    ]);
  });
});

describe("export and import", () => {
  test("a .wyrd archive round-trips the log, pack snapshot and media", () => {
    const dir = join(root, "campaigns", "source");
    const store = newStore({}, dir);
    turn(store, "t1", "look around", 3);
    store.saveAs("A save");
    mkdirSync(join(dir, "media", "portraits"), { recursive: true });
    writeFileSync(join(dir, "media", "portraits", "wren.png"), "not really a png");
    const hash = store.stateHash();
    const archive = exportCampaign({
      dir,
      campaignId: "source",
      name: "Test",
      characterName: "Wren",
      now: () => 1_700_000_000_000,
    });
    expect(new TextDecoder().decode(archive.subarray(0, 2))).toBe("PK");
    store.close();

    const imported = importCampaign<GameState>({
      archive,
      campaignsDir: join(root, "campaigns"),
      reduce,
      now: () => 1_700_000_000_000,
    });
    expect(imported).toMatchObject({ name: "Test", characterName: "Wren" });
    expect(imported.id).not.toBe("source");
    const reopened = track(
      CampaignStore.open<GameState>(join(root, "campaigns", imported.id, "campaign.db"), { reduce }),
    );
    expect(reopened.stateHash()).toBe(hash);
    expect(reopened.packSnapshot()).toEqual({
      hash: "pack-hash",
      content: { manifest: { id: "fantasy-core" } },
    });
    expect(turnsOf(reopened).map((t) => t.id)).toEqual(["t1"]);
    expect(savesView(reopened).saves.map((s) => s.name)).toEqual(["Autosave", "A save"]);
    expect(readFileSync(join(root, "campaigns", imported.id, "media", "portraits", "wren.png"))).toEqual(
      Buffer.from("not really a png"),
    );
  });

  test("rejects unsafe paths and invalid manifests without writing a campaign", () => {
    const store = newStore();
    store.close();
    const db = readFileSync(join(root, "campaign.db"));
    const campaigns = join(root, "campaigns");
    const manifest = {
      format: "wyrd",
      formatVersion: 1,
      campaignId: "safe",
      name: "Test",
      characterName: "Wren",
      schemaVersion: 1,
      eventSchemaVersion: 1,
      createdAt: new Date(0).toISOString(),
      files: ["campaign.db"],
    };
    const unsafe = zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "campaign.db": db,
      "media/../../escape.txt": strToU8("nope"),
    });
    expect(() => importCampaign({ archive: unsafe, campaignsDir: campaigns, reduce })).toThrow(
      expect.objectContaining({ code: "invalid_archive" }),
    );
    const newer = zipSync({
      "manifest.json": strToU8(JSON.stringify({ ...manifest, schemaVersion: 999 })),
      "campaign.db": db,
    });
    expect(() => importCampaign({ archive: newer, campaignsDir: campaigns, reduce })).toThrow(
      expect.objectContaining({ code: "invalid_archive" }),
    );
    expect(existsSync(campaigns)).toBe(false);
    expect(existsSync(join(root, "escape.txt"))).toBe(false);
  });
});

describe("backups", () => {
  test("keeps one backup per day and only the last seven", async () => {
    const home = join(root, "home");
    const dir = join(home, "campaigns", "camp-1");
    const store = newStore({}, dir);
    store.close();
    const day = (n: number) => Date.UTC(2026, 0, n);
    const first = await backupCampaign({ home, campaignId: "camp-1", now: () => day(1) });
    expect(first).toBe(join(home, "backups", "camp-1", "2026-01-01.db"));
    const again = await backupCampaign({ home, campaignId: "camp-1", now: () => day(1) });
    expect(again).toBe(first);
    for (let n = 2; n <= 9; n++) await backupCampaign({ home, campaignId: "camp-1", now: () => day(n) });
    const files = await readdir(join(home, "backups", "camp-1"));
    expect(files.sort()).toEqual([
      "2026-01-03.db",
      "2026-01-04.db",
      "2026-01-05.db",
      "2026-01-06.db",
      "2026-01-07.db",
      "2026-01-08.db",
      "2026-01-09.db",
    ]);
    const copy = new Database(join(home, "backups", "camp-1", "2026-01-09.db"));
    const row = copy.query("SELECT value FROM meta WHERE key = 'campaign_id'").get() as { value: string };
    expect(row.value).toBe(store.campaignId);
    copy.close();
  });
});

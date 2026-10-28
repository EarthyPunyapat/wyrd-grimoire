import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CampaignSettingsInput,
  defaultTuning,
  draft,
  type EventDraft,
  type EventEnvelope,
} from "@wyrd/core";
import {
  buildSheet,
  CORE_SKILL_CATALOG,
  createActor,
  createCampaign,
  type GameState,
  type RulesContext,
  reduce,
  resolveCheck,
  unwrap,
} from "@wyrd/engine";
import { CampaignStore, StorageError } from "../src/campaign-store.ts";

const ctx: RulesContext = { skills: CORE_SKILL_CATALOG, tuning: defaultTuning };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wyrd-storage-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

let reduceCalls = 0;
const countingReduce = (s: GameState | undefined, e: EventEnvelope) => {
  reduceCalls++;
  return reduce(s, e);
};

function newStore(settings: CampaignSettingsInput = {}, snapshotEvery = 200) {
  const created = unwrap(createCampaign({ name: "Test", packIds: ["fantasy-core"], settings, seed: 42 }));
  return CampaignStore.create<GameState>(join(dir, "campaign.db"), created, {
    reduce: countingReduce,
    snapshotEvery,
  });
}

function addPc(store: CampaignStore<GameState>) {
  const state = store.state();
  const sheet = buildSheet(
    {
      id: "pc",
      identity: { name: "Wren", ancestry: "fantasy-core:human" },
      attributes: { str: 5, agi: 6, end: 5, int: 5, awa: 5, wil: 5, pre: 5 },
    },
    state.campaign.settings,
    defaultTuning,
  );
  store.append(unwrap(createActor(state, sheet, "pc")));
}

const check = (store: CampaignStore<GameState>): EventDraft[] =>
  unwrap(
    resolveCheck(
      store.state(),
      { actorId: "pc", skill: "core:stealth", difficulty: "normal", purpose: "sneak" },
      ctx,
    ),
  ).events;

const minutes = (n: number) => [draft("TimeAdvanced", { minutes: n, reason: "wait" })];

describe("CampaignStore", () => {
  test("creates a campaign whose first event is CampaignCreated on the main branch", () => {
    const store = newStore();
    const events = store.events();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "CampaignCreated",
      seq: 1,
      branchId: "main",
      campaignId: store.campaignId,
    });
    expect(store.activeBranchId).toBe("main");
  });

  test("appends with monotonic seqs, envelope fields and the turn ID", () => {
    const store = newStore();
    addPc(store);
    const written = store.append([...check(store), ...minutes(10)], { turnId: "turn-1" });
    expect(written.map((e) => e.seq)).toEqual([3, 4]);
    expect(written.every((e) => e.turnId === "turn-1")).toBe(true);
    expect(written[1]?.gameTime).toBe(0); // game time *before* the event
    expect(store.state().campaign.gameTime).toBe(10);
  });

  test("rejects invalid payloads and illegal events, writing nothing", () => {
    const store = newStore();
    const before = store.stateHash();
    expect(() =>
      store.append([{ type: "TimeAdvanced", payload: { minutes: -1, reason: "x" } } as EventDraft]),
    ).toThrow(StorageError);
    // Legal shape, but the reducer rejects it (unknown actor): the whole batch rolls back.
    const bad = draft("LuckSpent", { actorId: "ghost", amount: 1, purpose: "reroll" });
    expect(() => store.append([...minutes(5), bad])).toThrow(/unknown actor/);
    expect(store.events()).toHaveLength(1);
    expect(store.stateHash()).toBe(before);
  });

  test("reopening from disk gives the same state", () => {
    const store = newStore();
    addPc(store);
    store.append(check(store));
    const hash = store.stateHash();
    store.close();
    const reopened = CampaignStore.open<GameState>(join(dir, "campaign.db"), { reduce });
    expect(reopened.stateHash()).toBe(hash);
    reopened.close();
  });

  test("snapshots every N events and loads from the latest one", () => {
    const store = newStore({}, 5);
    for (let i = 0; i < 12; i++) store.append(minutes(1));
    const snaps = store.db.query("SELECT seq FROM snapshots ORDER BY seq").all() as { seq: number }[];
    expect(snaps.map((s) => s.seq)).toEqual([5, 10]);
    const hash = store.stateHash();
    store.close();
    const reopened = CampaignStore.open<GameState>(join(dir, "campaign.db"), {
      reduce: countingReduce,
      snapshotEvery: 5,
    });
    reduceCalls = 0;
    expect(reopened.stateHash()).toBe(hash);
    expect(reduceCalls).toBe(3); // seq 11–13 replayed on top of the seq-10 snapshot
    reopened.close();
  });

  test("keeps an autosave at the active head", () => {
    const store = newStore();
    store.append(minutes(3));
    const auto = store.saves().filter((s) => s.autosave);
    expect(auto).toEqual([expect.objectContaining({ branchId: "main", seq: 2 })]);
  });
});

describe("rewind and branches", () => {
  test("rewind forks a new active branch; the old timeline stays", () => {
    const store = newStore();
    addPc(store);
    store.append(minutes(5));
    store.append(minutes(7)); // seq 4
    const fork = store.rewind(2);
    expect(store.activeBranchId).toBe(fork.id);
    expect(fork).toMatchObject({ parentBranchId: "main", forkSeq: 2, head: 3 }); // BranchForked is seq 3
    expect(store.state().campaign.gameTime).toBe(0);
    expect(store.state("main").campaign.gameTime).toBe(12);
    expect(store.branches().map((b) => b.id)).toEqual(["main", fork.id]);
  });

  test("replaying the same drafts on a fork reproduces the original state hash", () => {
    const store = newStore({}, 3);
    addPc(store);
    const later: EventDraft[] = [];
    for (let i = 0; i < 6; i++) {
      const d = i % 2 === 0 ? check(store) : minutes(i);
      later.push(...d);
      store.append(d);
    }
    const original = store.stateHash();
    store.rewind(2);
    store.append(later);
    expect(store.stateHash()).toBe(original);
  });

  test("forks can fork; each branch sees its own lineage", () => {
    const store = newStore();
    store.append(minutes(1)); // main: 2
    store.append(minutes(2)); // main: 3
    const a = store.rewind(2); // a: 3 = BranchForked
    store.append(minutes(10)); // a: 4
    const b = store.rewind(4); // b: 5 = BranchForked
    store.append(minutes(100));
    expect(store.state(b.id).campaign.gameTime).toBe(111);
    expect(store.state(a.id).campaign.gameTime).toBe(11);
    expect(store.state("main").campaign.gameTime).toBe(3);
    expect(store.events(b.id).map((e) => e.branchId)).toEqual(["main", "main", a.id, a.id, b.id, b.id]);
  });

  test("named saves and loading an earlier save forks", () => {
    const store = newStore();
    store.append(minutes(1));
    const save = store.saveAs("before the crypt");
    store.append(minutes(30));
    const head = store.saveAs("in the crypt");
    const branch = store.loadSave(save.id);
    expect(branch.forkSeq).toBe(2);
    expect(store.state().campaign.gameTime).toBe(1);
    // Loading a save at its branch head just switches to that branch.
    expect(store.loadSave(head.id).id).toBe("main");
    expect(store.state().campaign.gameTime).toBe(31);
  });

  test("hardcore refuses rewind, earlier saves and timeline switches", () => {
    const store = newStore({ structural: { hardcore: true } });
    store.append(minutes(1));
    const save = store.saveAs("early");
    store.append(minutes(1));
    expect(() => store.rewind(1)).toThrow(expect.objectContaining({ code: "hardcore" }));
    expect(() => store.loadSave(save.id)).toThrow(expect.objectContaining({ code: "hardcore" }));
  });

  test("rewind validates the seq", () => {
    const store = newStore();
    expect(() => store.rewind(0)).toThrow(expect.objectContaining({ code: "invalid_seq" }));
    expect(() => store.rewind(5)).toThrow(expect.objectContaining({ code: "invalid_seq" }));
  });
});

describe("projections and rebuild", () => {
  test("projections update with events and follow the active branch", () => {
    const store = newStore();
    store.append(minutes(1));
    addPc(store);
    expect(store.db.query("SELECT id, name FROM actors").all()).toEqual([{ id: "pc", name: "Wren" }]);
    store.rewind(2);
    expect(store.db.query("SELECT id FROM actors").all()).toEqual([]);
    store.activateBranch("main");
    expect(store.db.query("SELECT id FROM actors").all()).toEqual([{ id: "pc" }]);
  });

  test("rebuild drops projections and snapshots and replays to the same hash", () => {
    const store = newStore({}, 4);
    addPc(store);
    for (let i = 0; i < 9; i++) store.append(i % 3 === 0 ? check(store) : minutes(2));
    store.rewind(5);
    store.append(minutes(60));
    const hash = store.stateHash();
    const mainHash = store.stateHash("main");
    store.db.run("DELETE FROM actors");
    store.db.run("UPDATE snapshots SET state = ?", [Bun.gzipSync(new TextEncoder().encode("{}"))]); // corrupt them
    expect(store.rebuild()).toBe(hash);
    expect(store.stateHash("main")).toBe(mainHash);
    expect(store.db.query("SELECT id FROM actors").all()).toEqual([{ id: "pc" }]);
  });
});

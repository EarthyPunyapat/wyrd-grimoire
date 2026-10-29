import { expect, test } from "bun:test";
import { UsageRecord, WyrdConfig } from "@wyrd/core";
import { AppStore } from "../src/app-store.ts";

test("app usage preserves identical live attempts but deduplicates legacy imports", () => {
  const store = new AppStore(":memory:");
  try {
    const record = UsageRecord.parse({
      at: "2026-10-28T00:00:00.000Z",
      role: "parser",
      provider: "offline",
      model: "offline",
      promptVersion: "parser@2",
      input: 5,
      cachedInput: 0,
      output: 2,
      latencyMs: 0,
      costEstimate: 0,
      ok: true,
    });
    store.recordUsage(record);
    store.recordUsage(record);
    expect(store.usage()).toHaveLength(2);
    store.recordUsage(record, true);
    store.recordUsage(record, true);
    expect(store.usage()).toHaveLength(3);
    expect(store.usage("2026-10-29")).toEqual([]);
  } finally {
    store.close();
  }
});

test("creation drafts are listed, read back and removed; campaign cards carry an archive flag", () => {
  const store = new AppStore(":memory:");
  try {
    store.saveCreationDraft("first", { name: "First" });
    store.saveCreationDraft("second", { name: "Second" });
    expect(store.creationDraft("first")).toEqual({ name: "First" });
    expect(
      store
        .creationDrafts()
        .map((d) => d.id)
        .sort(),
    ).toEqual(["first", "second"]);
    expect(store.creationDrafts()[0]!.updatedAt).toBeTruthy();
    store.removeCreationDraft("first");
    expect(store.creationDraft("first")).toBeNull();

    store.addCampaign({
      id: "c1",
      name: "One",
      characterName: "Hero",
      updatedAt: "2026-10-30T00:00:00.000Z",
      archived: false,
    });
    expect(store.campaigns()[0]!.archived).toBe(false);
    store.setCampaignArchived("c1", true);
    expect(store.campaigns()[0]!.archived).toBe(true);
    store.renameCampaign("c1", "Two");
    expect(store.campaigns()[0]!.name).toBe("Two");
  } finally {
    store.close();
  }
});

test("app model settings update atomically and idle sessions expire", () => {
  const store = new AppStore(":memory:");
  try {
    const config = WyrdConfig.parse({
      providers: { plan: { kind: "chatgpt-plan" } },
      routing: { narrator: { provider: "plan", model: "sol", fallbacks: [] } },
    });
    store.saveProviderConfig(config);
    expect(store.providerConfig()).toEqual(config);
    expect(store.db.query("SELECT id FROM providers").all()).toEqual([{ id: "plan" }]);
    expect(store.db.query("SELECT role FROM routing").all()).toEqual([{ role: "narrator" }]);
    store.createSession("digest", 0);
    expect(store.session("digest", 5, 10)).toBe(true);
    expect(store.session("digest", 14, 10)).toBe(true);
    expect(store.session("digest", 25, 10)).toBe(false);
  } finally {
    store.close();
  }
});

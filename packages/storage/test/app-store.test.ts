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
      promptVersion: "parser@1",
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

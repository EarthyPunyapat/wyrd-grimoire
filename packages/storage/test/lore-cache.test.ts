import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoreCache } from "../src/lore-cache.ts";

test("global cache persists summary records without overwriting or unsafe title paths", () => {
  const home = mkdtempSync(join(tmpdir(), "wyrd-lore-"));
  try {
    const a = new LoreCache(home);
    const record = {
      title: "../A / title",
      url: "https://dc.fandom.com/wiki/A",
      fetchedAt: "2026-10-29T00:00:00.000Z",
      text: "An original summary.",
    };
    a.put("dc.fandom.com", record.title, record);
    const b = new LoreCache(home);
    expect(b.get("dc.fandom.com", record.title)).toEqual(record);
    expect(b.get("en.wikipedia.org", record.title)).toBeNull();
    b.put("dc.fandom.com", record.title, { ...record, text: "replacement" });
    expect(a.get("dc.fandom.com", record.title)?.text).toBe(record.text);
    const files = readdirSync(join(home, "lore-cache", "dc.fandom.com"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    writeFileSync(join(home, "lore-cache", "dc.fandom.com", files[0]!), "broken");
    expect(b.get("dc.fandom.com", record.title)).toBeNull();
    b.put("dc.fandom.com", record.title, record);
    expect(b.get("dc.fandom.com", record.title)).toEqual(record);
    expect(() => a.get("../../escape", "title")).toThrow();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetCache, sniffImage } from "../src/cache.ts";
import { PNG } from "./fixtures.ts";

const dirs: string[] = [];
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "wyrd-media-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the asset cache", () => {
  test("an image is stored under its sha256 and read back", async () => {
    const cache = new AssetCache(fresh());
    const asset = cache.put(PNG, { origin: "wiki", pageUrl: "https://dc.fandom.com/wiki/Batman" });
    expect(asset.id).toBe(new Bun.CryptoHasher("sha256").update(PNG).digest("hex"));
    expect(asset.mime).toBe("image/png");
    expect(asset.pageUrl).toBe("https://dc.fandom.com/wiki/Batman");
    expect(cache.has(asset.id)).toBe(true);
    expect(new Uint8Array(await Bun.file(cache.path(asset)).arrayBuffer())).toEqual(PNG);
  });

  test("an HTML error page is not an image", () => {
    const html = new TextEncoder().encode("<!doctype html><title>404</title>");
    expect(sniffImage(html)).toBeNull();
    expect(() => new AssetCache(fresh()).put(html, { origin: "wiki" })).toThrow("Not an image");
  });

  test("an oversized image is refused before it is written", () => {
    const dir = fresh();
    const huge = new Uint8Array(6_000_000);
    huge.set(PNG.subarray(0, 8));
    expect(() => new AssetCache(dir).put(huge, { origin: "wiki" })).toThrow("Image too large");
    expect(readdirSync(dir)).toHaveLength(0);
  });

  test("the same picture for two campaigns is one file", () => {
    const dir = fresh();
    const cache = new AssetCache(dir);
    const a = cache.put(PNG, { origin: "wiki", pageUrl: "https://a" });
    const b = cache.put(PNG, { origin: "generated", prompt: "a caped figure" });
    expect(a.id).toBe(b.id);
    expect(b.origin).toBe("generated");
    expect(readdirSync(dir)).toHaveLength(1);
  });
});

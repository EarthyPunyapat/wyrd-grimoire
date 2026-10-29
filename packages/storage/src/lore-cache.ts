import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const Record = z.object({
  title: z.string().min(1),
  url: z.url(),
  fetchedAt: z.iso.datetime(),
  text: z.string().min(1),
});
export type LoreCacheRecord = z.infer<typeof Record>;

/** Global, summary-only cache. No expiry or automatic pruning; campaigns never own these files. */
export class LoreCache {
  constructor(private home: string) {}
  private path(wiki: string, title: string): string {
    if (!/^(?:[a-z][a-z0-9-]*\.wikipedia\.org|[a-z0-9][a-z0-9-]*\.fandom\.com)$/.test(wiki))
      throw new Error("Invalid wiki cache key");
    return join(
      this.home,
      "lore-cache",
      wiki,
      `${createHash("sha256").update(title.normalize("NFC").trim().replaceAll("_", " ")).digest("hex")}.json`,
    );
  }
  get(wiki: string, title: string): LoreCacheRecord | null {
    const path = this.path(wiki, title);
    try {
      const record = Record.parse(JSON.parse(readFileSync(path, "utf8")));
      const url = new URL(record.url);
      return url.protocol === "https:" && url.hostname === wiki && !url.username && !url.password
        ? record
        : null;
    } catch {
      return null;
    }
  }
  put(wiki: string, title: string, record: LoreCacheRecord): void {
    const path = this.path(wiki, title);
    if (this.get(wiki, title)) return;
    const valid = Record.parse(record);
    if (new URL(valid.url).hostname !== wiki) throw new Error("Invalid lore source");
    mkdirSync(join(this.home, "lore-cache", wiki), { recursive: true });
    const temp = `${path}.${crypto.randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(valid), { mode: 0o600 });
    renameSync(temp, path);
  }
}

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultTuning, type MediaAsset } from "@wyrd/core";

const EXT: Record<MediaAsset["mime"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The image type from its magic bytes; anything else (an HTML error page, a script) is not an image. */
export function sniffImage(bytes: Uint8Array): MediaAsset["mime"] | null {
  const at = (i: number, ...b: number[]) => b.every((v, j) => bytes[i + j] === v);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/**
 * WYRD_HOME/media-cache (D168): one file per picture, named by its sha256, shared by every campaign.
 * Campaigns attach assets by id, so the same bytes are stored once.
 */
export class AssetCache {
  constructor(
    private readonly dir: string,
    private readonly maxBytes = defaultTuning.media.maxBytes,
  ) {}

  put(bytes: Uint8Array, meta: Omit<MediaAsset, "id" | "mime">): MediaAsset {
    if (bytes.byteLength > this.maxBytes) throw new Error("Image too large");
    const mime = sniffImage(bytes);
    if (!mime) throw new Error("Not an image");
    const id = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const asset: MediaAsset = { ...meta, id, mime };
    const file = this.path(asset);
    if (!existsSync(file)) {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(file, bytes);
    }
    return asset;
  }

  path(asset: Pick<MediaAsset, "id" | "mime">): string {
    return join(this.dir, `${asset.id}.${EXT[asset.mime]}`);
  }

  has(id: string): boolean {
    return this.find(id) !== null;
  }

  /** The stored file for an asset id, or null; ids are validated so a request can't name another path. */
  find(id: string): { path: string; mime: MediaAsset["mime"] } | null {
    if (!/^[0-9a-f]{64}$/.test(id)) return null;
    for (const [mime, ext] of Object.entries(EXT) as [MediaAsset["mime"], string][]) {
      const path = join(this.dir, `${id}.${ext}`);
      if (existsSync(path)) return { path, mime };
    }
    return null;
  }
}

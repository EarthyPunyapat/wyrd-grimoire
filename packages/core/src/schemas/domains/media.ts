import { z } from "zod";

/**
 * First Light (D168): a picture attached to a canon entity. The bytes live in WYRD_HOME/media-cache under
 * their sha256; the event keeps where the image came from so it can be credited and replaced.
 */
export const MediaAsset = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  origin: z.enum(["wiki", "wikipedia", "search", "generated"]),
  pageUrl: z.string().max(2000).optional(),
  sourceUrl: z.string().max(2000).optional(),
  license: z.string().max(200).optional(),
  credit: z.string().max(300).optional(),
  prompt: z.string().max(4000).optional(),
  seed: z.number().int().optional(),
});
export type MediaAsset = z.infer<typeof MediaAsset>;
export const MediaRole = z.enum(["portrait", "banner"]);
export type MediaRole = z.infer<typeof MediaRole>;

export const mediaEventSchemas = {
  AssetAttached: z.object({ entityId: z.string().trim().min(1), role: MediaRole, asset: MediaAsset }),
} as const;

/** Device-wide image settings (Settings → Media). No keys live here; secrets stay in WYRD_HOME/secrets. */
export const MediaSettings = z.object({
  webImages: z.boolean().default(true),
  comfyUrl: z.url().optional(),
  workflowsDir: z.string().min(1),
});
export type MediaSettings = z.infer<typeof MediaSettings>;

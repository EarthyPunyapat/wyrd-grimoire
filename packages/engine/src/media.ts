import { type LoreRecord, MAIN_WORLD } from "@wyrd/core";
import { mediaFlags } from "./reduce/media.ts";
import type { GameState } from "./state.ts";

/** The pictures attached to entities: portraits for people, banners for places (First Light). */
export const mediaOf = mediaFlags;

/**
 * The wiki a campaign's images and lore come from: the main world's source wiki, else the wiki its
 * research used most (campaigns created before the wiki was recorded), else none.
 */
export function campaignWiki(state: GameState): string | null {
  const main = state.worlds.find((w) => w.id === MAIN_WORLD);
  if (main?.wiki) return main.wiki;
  const counts = new Map<string, number>();
  for (const record of Object.values((state.flags.loreRecords ?? {}) as Record<string, LoreRecord>))
    counts.set(record.wiki, (counts.get(record.wiki) ?? 0) + 1);
  let best: string | null = null;
  for (const [wiki, n] of counts) if (!best || n > (counts.get(best) ?? 0)) best = wiki;
  return best;
}

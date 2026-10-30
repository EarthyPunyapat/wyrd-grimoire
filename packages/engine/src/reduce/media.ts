import type { MediaAsset } from "@wyrd/core";
import type { GameState } from "../state.ts";
import type { Handlers } from "./types.ts";

type MediaFlags = { portraits: Record<string, MediaAsset>; banners: Record<string, MediaAsset> };

/** Attached pictures live in flags, like other W2 projections, so older snapshots need no migration. */
export const mediaFlags = (s: GameState): MediaFlags =>
  (s.flags.media as MediaFlags | undefined) ?? { portraits: {}, banners: {} };

export const mediaHandlers: Pick<Handlers, "AssetAttached"> = {
  AssetAttached: (s, e) => {
    const media = mediaFlags(s);
    const key = e.payload.role === "portrait" ? "portraits" : "banners";
    return {
      ...s,
      flags: {
        ...s.flags,
        media: { ...media, [key]: { ...media[key], [e.payload.entityId]: e.payload.asset } },
      },
    };
  },
};

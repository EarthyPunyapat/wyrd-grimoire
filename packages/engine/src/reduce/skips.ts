import type { Handlers } from "./types.ts";

export const skipHandlers: Pick<Handlers, "WatchAdded" | "WatchRemoved" | "SkipCompleted"> = {
  WatchAdded: (s, e) => ({
    ...s,
    flags: {
      ...s.flags,
      watchList: [...new Set([...((s.flags.watchList as string[]) ?? []), e.payload.entityId])],
    },
  }),
  WatchRemoved: (s, e) => ({
    ...s,
    flags: {
      ...s.flags,
      watchList: ((s.flags.watchList as string[]) ?? []).filter((id) => id !== e.payload.entityId),
    },
  }),
  SkipCompleted: (s, e) => ({ ...s, flags: { ...s.flags, lastSkip: e.payload.digest } }),
};

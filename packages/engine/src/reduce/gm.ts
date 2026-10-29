import type { GameState } from "../state.ts";
import type { Handlers } from "./types.ts";

/** GM-turn events (Wyrd 2.0, D144/D149). */
export const gmHandlers: Pick<Handlers, "ItemDefined" | "RetconApplied" | "RetconUndone"> = {
  ItemDefined: (s, e) => ({
    ...s,
    customItems: { ...s.customItems, [e.payload.itemId]: e.payload.def },
  }),

  RetconApplied: (s, e) => ({
    ...s,
    retcons: [...s.retcons, { retconId: e.payload.retconId, turnId: e.payload.turnId, undone: false }],
  }),

  RetconUndone: (s, e) => ({
    ...s,
    retcons: s.retcons.map((r) => (r.retconId === e.payload.retconId ? { ...r, undone: true } : r)),
  }),
};

import type { LoreRecord } from "@wyrd/core";
import type { Handlers } from "./types.ts";

/** Research is replayable per world; Codex facts use the existing fact/knowledge projections. */
export const loreHandlers: Pick<Handlers, "LoreRecorded"> = {
  LoreRecorded: (s, e) => ({
    ...s,
    flags: {
      ...s.flags,
      loreRecords: {
        ...(s.flags.loreRecords as Record<string, LoreRecord> | undefined),
        [e.payload.record.id]: e.payload.record,
      },
    },
  }),
};

import type { Handlers } from "./types.ts";

/** Time skips, the watch list and interruptions (W2 step 3 E, spec §10). Add one handler per event in `skipEventSchemas`. */
export const skipHandlers: Pick<Handlers, never> = {};

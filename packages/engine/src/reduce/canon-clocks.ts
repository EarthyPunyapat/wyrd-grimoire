import type { Handlers } from "./types.ts";

/** Canon events as timeline clocks (W2 step 3 D, spec §8). Add one handler per event in `canonEventSchemas`. */
export const canonHandlers: Pick<Handlers, never> = {};

import type { Handlers } from "./types.ts";

/** Avatars and sealing (W2 step 3 B, spec §7). Add one handler per event in `avatarEventSchemas`. */
export const avatarHandlers: Pick<Handlers, never> = {};

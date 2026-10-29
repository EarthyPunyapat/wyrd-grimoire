import { type AvatarRun, draft, type EventDraft } from "@wyrd/core";
import { fail, ok, type Result } from "./result.ts";
import type { GameState } from "./state.ts";

/** Every avatar run on record, oldest first (the log order is the insertion order). */
export function avatarRuns(state: GameState): AvatarRun[] {
  return Object.values((state.flags.avatarRuns ?? {}) as Record<string, AvatarRun>);
}

export function activeAvatarRuns(state: GameState): AvatarRun[] {
  return avatarRuns(state).filter((run) => run.status === "active");
}

/** The run a sovereign is currently playing through, if any. */
export function runForSovereign(state: GameState, sovereignId: string): AvatarRun | undefined {
  return activeAvatarRuns(state).find((run) => run.sovereignId === sovereignId);
}

/** A completed or unsealed run; death is closed automatically by the `ActorDied` handler. */
export function endAvatarRun(
  state: GameState,
  avatarId: string,
  reason: "completed" | "unsealed",
): Result<EventDraft[]> {
  const run = avatarRuns(state).find((r) => r.avatarId === avatarId);
  if (!run) return fail("AVATAR_UNKNOWN", `No avatar run for ${avatarId}`);
  if (run.status !== "active") return fail("AVATAR_ENDED", `The run for ${avatarId} has already ended`);
  return ok([draft("AvatarRunEnded", { avatarId, reason }, "player")]);
}

import type { AvatarRun } from "@wyrd/core";
import { updateSheet } from "./helpers.ts";
import type { Handlers } from "./types.ts";

/** Run projections live in `flags.avatarRuns`, keyed by avatar id, so `rebuild` recreates them. */
const runs = (s: Parameters<Handlers["AvatarCreated"]>[0]): Record<string, AvatarRun> =>
  (s.flags.avatarRuns ?? {}) as Record<string, AvatarRun>;

const active = (run: AvatarRun | undefined): run is AvatarRun => run?.status === "active";

export const avatarHandlers: Pick<
  Handlers,
  "AvatarCreated" | "AvatarRunEnded" | "SealSet" | "SealBroken" | "ActorDied"
> = {
  AvatarCreated: (s, e) => {
    const { avatarId, sovereignId, level, worldId } = e.payload;
    if (avatarId === sovereignId) throw new Error("An avatar needs its own actor");
    if (active(runs(s)[avatarId])) throw new Error(`Avatar ${avatarId} already has an active run`);
    const next = updateSheet(s, avatarId, (sheet) => ({ ...sheet, level }));
    return {
      ...next,
      flags: {
        ...next.flags,
        avatarRuns: {
          ...runs(next),
          [avatarId]: {
            avatarId,
            sovereignId,
            level,
            worldId,
            status: "active",
            startedAt: s.campaign.gameTime,
          },
        },
      },
    };
  },
  AvatarRunEnded: (s, e) => {
    const run = runs(s)[e.payload.avatarId];
    if (!run || !active(run)) return s;
    return {
      ...s,
      flags: {
        ...s.flags,
        avatarRuns: {
          ...runs(s),
          [e.payload.avatarId]: {
            ...run,
            status: "ended",
            reason: e.payload.reason,
            endedAt: s.campaign.gameTime,
          },
        },
      },
    };
  },
  SealSet: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => ({ ...sheet, effectiveLevel: e.payload.effectiveLevel })),
  SealBroken: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => {
      const { effectiveLevel: _broken, ...rest } = sheet;
      return rest;
    }),

  /**
   * Replaces the base death handler to close an active avatar run at the same moment. A sovereign
   * linked to a run is never marked dead (D134): the run carries the stakes, not the sovereign.
   */
  ActorDied: (s, e) => {
    const id = e.payload.actorId;
    const actor = s.actors[id];
    if (!actor) throw new Error(`No actor ${id}`);
    if (Object.values(runs(s)).some((run) => run.sovereignId === id)) return s;
    const fallen = s.companions?.[id];
    const ended = runs(s)[id];
    const avatarRuns =
      ended && active(ended)
        ? {
            ...runs(s),
            [id]: {
              ...ended,
              status: "ended" as const,
              reason: "died" as const,
              endedAt: s.campaign.gameTime,
            },
          }
        : runs(s);
    return {
      ...s,
      actors: { ...s.actors, [id]: { ...actor, dead: true } },
      ...(fallen
        ? {
            companions: { ...s.companions, [id]: { ...fallen, status: "dead" as const } },
            party: { ...s.party, companionIds: s.party.companionIds.filter((c) => c !== id) },
          }
        : {}),
      flags: { ...s.flags, avatarRuns },
    };
  },
};

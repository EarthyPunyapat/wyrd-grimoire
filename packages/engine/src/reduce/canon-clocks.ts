import type { CanonActorProgress, CanonClockResult } from "@wyrd/core";
import type { Handlers } from "./types.ts";

export const canonHandlers: Pick<
  Handlers,
  | "CanonSourceSet"
  | "CanonClockIntervened"
  | "CanonClockResolved"
  | "CanonActorConfigured"
  | "CanonActorActed"
> = {
  CanonSourceSet: (s, e) => ({
    ...s,
    worlds: s.worlds.map((w) =>
      w.id === e.payload.worldId
        ? { ...w, source: e.payload.source, ...(e.payload.wiki ? { wiki: e.payload.wiki } : {}) }
        : w,
    ),
  }),
  CanonClockIntervened: (s, e) => ({
    ...s,
    flags: {
      ...s.flags,
      canonInterventions: {
        ...(s.flags.canonInterventions as Record<string, string> | undefined),
        [e.payload.clockId]: e.payload.factId,
      },
    },
  }),
  CanonClockResolved: (s, e) => ({
    ...s,
    flags: {
      ...s.flags,
      canonResults: {
        ...(s.flags.canonResults as Record<string, CanonClockResult> | undefined),
        [e.payload.clockId]: e.payload,
      },
    },
  }),
  CanonActorConfigured: (s, e) => ({
    ...s,
    flags: {
      ...s.flags,
      canonActors: {
        ...(s.flags.canonActors as Record<string, CanonActorProgress> | undefined),
        [e.payload.profile.entityId]: {
          profile: e.payload.profile,
          lastActedAt: e.payload.profile.startedAt,
        },
      },
    },
  }),
  CanonActorActed: (s, e) => {
    const actors = s.flags.canonActors as Record<string, CanonActorProgress> | undefined;
    const actor = actors?.[e.payload.entityId];
    if (!actor) return s;
    return {
      ...s,
      flags: {
        ...s.flags,
        canonActors: { ...actors, [e.payload.entityId]: { ...actor, lastActedAt: e.payload.at } },
      },
    };
  },
};

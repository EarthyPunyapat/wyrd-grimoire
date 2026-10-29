import type { PendingLevel } from "../levels.ts";
import { updateSheet } from "./helpers.ts";
import type { Handlers } from "./types.ts";

export const levelHandlers: Pick<
  Handlers,
  "LevelProposed" | "LevelGained" | "AbilityGained" | "AbilityRanked"
> = {
  LevelProposed: (s, e) => {
    const previous = (s.flags.levelProposals ?? {}) as Record<string, PendingLevel>;
    const proposals = Object.fromEntries(
      Object.entries(previous).map(([id, p]) => [
        id,
        p.actorId === e.payload.proposal.actorId && p.status === "pending"
          ? { ...p, status: "superseded" }
          : p,
      ]),
    );
    return {
      ...s,
      flags: {
        ...s.flags,
        levelProposals: {
          ...proposals,
          [e.payload.proposal.id]: { ...e.payload.proposal, status: "pending" },
        },
      },
    };
  },
  LevelGained: (s, e) => {
    const next = updateSheet(s, e.payload.actorId, (sheet) => {
      if (sheet.level !== undefined && sheet.level !== e.payload.from) throw new Error("Stale level event");
      return { ...sheet, level: e.payload.level };
    });
    const proposals = Object.fromEntries(
      Object.entries((s.flags.levelProposals ?? {}) as Record<string, PendingLevel>).map(([id, p]) => [
        id,
        p.actorId === e.payload.actorId && p.status === "pending"
          ? { ...p, status: id === e.payload.proposalId ? "accepted" : "superseded" }
          : p,
      ]),
    );
    return { ...next, flags: { ...next.flags, levelProposals: proposals } };
  },
  AbilityGained: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => {
      if (sheet.abilities?.some((a) => a.id === e.payload.ability.id)) throw new Error("Duplicate ability");
      return { ...sheet, abilities: [...(sheet.abilities ?? []), e.payload.ability] };
    }),
  AbilityRanked: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => {
      if (!sheet.abilities?.some((a) => a.id === e.payload.abilityId)) throw new Error("Unknown ability");
      return {
        ...sheet,
        abilities: sheet.abilities.map((a) =>
          a.id === e.payload.abilityId ? { ...a, rank: e.payload.rank } : a,
        ),
      };
    }),
};

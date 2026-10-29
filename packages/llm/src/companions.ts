import { CompanionProfile } from "@wyrd/core";
import type { RoleRouter } from "./router.ts";
import { propose } from "./world-generation.ts";

export type CompanionBrief = {
  world: { name: string; premise: string };
  companion: { name: string; summary: string; facts: string[] };
  /** Why they joined, as recorded in canon. */
  reason: string;
};

/**
 * A new companion's values, likes, dislikes and personal quest (spec 04), written once when they
 * join. The guard reads the values to propose approval; the quest unlocks at +50.
 */
export function generateCompanionProfile(
  router: RoleRouter,
  brief: CompanionBrief,
): Promise<CompanionProfile> {
  return propose(
    router,
    "propose_companion",
    CompanionProfile,
    `A character in an original role-playing world has just joined the player's party. From what is known of them, give 1–4 values (what they believe in), up to 4 likes and 4 dislikes the player's choices could touch (concrete behaviour, such as "mercy to the defeated" or "breaking a promise"), whether they would betray the party rather than just leave if pushed too far (canBetray), and a personal quest of 2–4 stages that grows from their own story. Stay consistent with every given fact.`,
    brief,
    "companion-profile@1",
  );
}

/** Offline (D103): a fixed, genre-neutral profile, labelled by its plainness rather than invented detail. */
export function offlineCompanionProfile(name: string): CompanionProfile {
  return {
    values: ["loyalty", "fair dealing"],
    likes: ["keeping promises", "kindness to the helpless"],
    dislikes: ["cruelty", "killing the defenceless"],
    canBetray: false,
    personalQuest: {
      title: `${name}'s unfinished business`,
      stages: [`Learn what ${name} left unfinished`, `Return with ${name} to settle it`],
    },
  };
}

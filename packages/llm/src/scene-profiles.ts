import { type Entity, ReactionProfile as Profile, type ReactionProfile } from "@wyrd/core";
import type { GameState } from "@wyrd/engine";

/** Narrow adapter: M6 can supply personality data without changing the reaction engine. */
export function sceneProfile(state: GameState, entity: Entity | null, id: string): ReactionProfile {
  const data = entity?.data as { reactionProfile?: unknown; tactics?: unknown } | undefined;
  const explicit = Profile.safeParse(data?.reactionProfile);
  if (explicit.success) return explicit.data;
  const traits = state.actors[id]?.sheet.identity.personality ?? [];
  const tactics = data?.tactics ?? state.combat?.combatants[id]?.tactics;
  const temperament =
    traits.includes("protective") || tactics === "protector"
      ? "protective"
      : traits.includes("cautious") || tactics === "cowardly"
        ? "cautious"
        : traits.includes("hostile")
          ? "hostile"
          : "assertive";
  return Profile.parse({ temperament, canSpeak: entity?.kind !== "creature" });
}

import { type CanonActorProgress, type CanonClockResult, draft, Fact, worldOf } from "@wyrd/core";
import type { GameState } from "./state.ts";
import { Working } from "./working.ts";

/** Pure timeline advance. Absolute elapsed time also covers the daily tick cap on long skips. */
export function advanceCanon(
  state: GameState,
  at: number,
  factsAbout?: (id: string) => Fact[],
  entityActive?: (id: string) => boolean,
) {
  const w = new Working(state);
  const results = (state.flags.canonResults ?? {}) as Record<string, CanonClockResult>;
  const interventions = (state.flags.canonInterventions ?? {}) as Record<string, string>;
  for (const clock of Object.values(state.clocks)) {
    if (clock.kind !== "canon" || !clock.canon || results[clock.id]) continue;
    const plan = clock.canon;
    const filled = Math.min(
      clock.segments,
      Math.floor((at - plan.startedAt) / ((clock.paceDays ?? 1) * 1440)),
    );
    if (filled > clock.filled)
      w.apply([
        draft("ClockAdvanced", {
          clockId: clock.id,
          by: filled - clock.filled,
          reason: "Canon timeline advances",
        }),
      ]);
    if (filled < clock.segments) continue;
    const intervention =
      plan.intervention &&
      factsAbout?.(plan.intervention.entityId).find(
        (f) =>
          !f.retracted &&
          !f.supersededBy &&
          (f.source === "player" || f.source === "engine" || f.source === "model") &&
          f.predicate === plan.intervention!.predicate &&
          worldOf(f) === worldOf(clock) &&
          f.value !== false &&
          f.value !== null,
      );
    const factId = interventions[clock.id] ?? intervention?.id;
    const outcomeId = `fact:canon:${clock.id}`;
    w.apply([
      ...(!factId
        ? [
            draft("FactAsserted", {
              fact: Fact.parse({
                id: outcomeId,
                ...plan.outcome,
                worldId: worldOf(clock),
                source: "engine",
                visibility: "public",
              }),
            }),
          ]
        : []),
      ...(!factId &&
      (state.scene?.locationId === plan.outcome.entityId || state.scene?.positions[plan.outcome.entityId])
        ? [draft("KnowledgeGained", { factId: outcomeId, entry: { how: "witnessed", gameTime: at } })]
        : []),
      draft("CanonClockResolved", {
        clockId: clock.id,
        status: factId ? "averted" : "occurred",
        factId: factId ?? outcomeId,
      }),
    ]);
  }
  for (const { profile, lastActedAt } of Object.values(
    (state.flags.canonActors ?? {}) as Record<string, CanonActorProgress>,
  )) {
    if (
      state.actors[profile.entityId]?.dead ||
      state.living?.lives[profile.entityId]?.dead ||
      entityActive?.(profile.entityId) === false
    )
      continue;
    const interval = profile.paceDays * 1440;
    const actedAt = profile.startedAt + Math.floor((at - profile.startedAt) / interval) * interval;
    if (actedAt <= lastActedAt) continue;
    w.apply([
      draft("CanonActorActed", { entityId: profile.entityId, at: actedAt }),
      draft("FactAsserted", {
        fact: Fact.parse({
          id: `fact:canon-activity:${profile.entityId}:${actedAt}`,
          entityId: profile.entityId,
          worldId: profile.worldId,
          predicate: "activity",
          value: profile.action,
          source: "engine",
        }),
      }),
      ...(state.scene?.positions[profile.entityId]
        ? [
            draft("KnowledgeGained", {
              factId: `fact:canon-activity:${profile.entityId}:${actedAt}`,
              entry: { how: "witnessed", gameTime: actedAt },
            }),
          ]
        : []),
      draft("MemoryRecorded", {
        memory: {
          id: `memory:canon:${profile.entityId}:${actedAt}`,
          npcId: profile.entityId,
          gameTime: actedAt,
          kind: "witnessed",
          content: `${profile.action}. Motive: ${profile.motivation}`,
          about: [profile.entityId],
          importance: 2,
          feeling: 0,
          belief: 1,
        },
      }),
    ]);
  }
  return w.events;
}

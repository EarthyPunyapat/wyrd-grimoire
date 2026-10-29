import type { ActorId, EventDraft, Resolution } from "@wyrd/core";
import {
  type CombatContext,
  HOSTILE,
  runCombatTurn,
  startFight,
  toCombatActions,
  validateCombatPlan,
} from "./combat/index.ts";
import { companionBeats } from "./companions.ts";
import { type ExplorationContext, type PlanError, resolvePlan, validatePlan } from "./exploration.ts";
import { restImprovements, turnAwards, turnMarks } from "./progression.ts";
import { fail, ok, type Result } from "./result.ts";
import { type SceneReactionContext, sceneReactions } from "./scene-reactions.ts";
import type { GameState } from "./state.ts";
import { Working } from "./working.ts";
import { afterTurn, type KnowledgeContext } from "./world/knowledge.ts";

/** Everything a turn's rules need, in exploration or combat, plus the world's canon lookups. */
export type TurnContext = ExplorationContext & CombatContext & KnowledgeContext & SceneReactionContext;

export type TurnPlan = { actorId: ActorId; actions: unknown[] };
export type TurnPlanError =
  | PlanError
  | { actionIndex: number; code: string; message: string; legalAlternatives?: unknown[] };

/** Validates a plan for whatever mode the game is in (spec 08 step 4). */
export function validateTurn(
  state: GameState,
  actorId: ActorId,
  actions: readonly unknown[],
  ctx: TurnContext,
): Result<TurnPlan> & { planErrors?: TurnPlanError[] } {
  // The dead don't act; a hardcore death ends the PC's story (spec 03, Hardcore death).
  if (state.actors[actorId]?.dead)
    return { ...fail("ACTOR_DEAD", `${ctx.nameOf(actorId)} is dead`), planErrors: [] };
  if (state.combat) return validateCombatPlan(state, actorId, actions, ctx);
  return validatePlan(state, actorId, actions, ctx);
}

const startsFight = (actions: readonly unknown[]) =>
  actions.some((a) => HOSTILE.has(String((a as { type?: unknown })?.type)));

/**
 * Resolves a validated plan (spec 08 step 5). A hostile action outside combat starts a fight and
 * the rest of the plan runs as the first combat turn; in combat, AI turns run until the player's.
 * Afterwards the PC learns what's around them, witnesses remember, the world ticks, and the party
 * earns XP, marks skills and (after a long rest) rolls to improve them (spec 04).
 */
export function resolveTurn(
  state: GameState,
  plan: TurnPlan,
  ctx: TurnContext,
  combatId: string,
): Result<{ events: EventDraft[]; resolution: Resolution }> {
  const r = state.combat
    ? runCombatTurn(state, plan as never, ctx)
    : startsFight(plan.actions)
      ? startFight(state, plan.actorId, toCombatActions(plan.actions as { type: string }[]), combatId, ctx)
      : resolvePlan(state, plan as never, ctx);
  if (!r.ok) return r;
  const w = new Working(state);
  w.apply(r.value.events);
  const reaction = sceneReactions(
    w.state,
    r.value.resolution,
    ctx,
    state.combat?.id ?? w.state.combat?.id ?? combatId,
  );
  w.apply(reaction.events);
  const responded = reaction.responses.length
    ? {
        ...r.value.resolution,
        responses: reaction.responses,
        requiredBeats: [...r.value.resolution.requiredBeats, ...reaction.responses.map((x) => x.summary)],
      }
    : r.value.resolution;
  const after = afterTurn(w.state, responded, ctx);
  w.apply(after.events);
  const turn = [...r.value.events, ...reaction.events, ...after.events];
  const progress = [
    ...turnMarks(state, turn),
    ...turnAwards(state, w.state, turn, ctx.kindOf ?? (() => undefined), ctx.tuning, ctx.classes ?? {}),
  ];
  w.apply(progress);
  const rested = restImprovements(w.state, turn, ctx, ctx.tuning);
  w.apply(rested);
  // Owed companion scenes (a confrontation, a departure) and this scene's banter (spec 04).
  const owed = companionBeats(w.state, ctx.nameOf);
  progress.push(...rested, ...owed.events);
  const beats = [...after.beats, ...owed.beats];
  const resolution = beats.length
    ? { ...responded, requiredBeats: [...responded.requiredBeats, ...beats] }
    : responded;
  return ok({ events: [...turn, ...progress], resolution });
}

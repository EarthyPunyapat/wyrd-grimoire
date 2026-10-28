import type { ActorId, EventDraft, Resolution } from "@wyrd/core";
import {
  type CombatContext,
  HOSTILE,
  runCombatTurn,
  startFight,
  toCombatActions,
  validateCombatPlan,
} from "./combat/index.ts";
import { type ExplorationContext, type PlanError, resolvePlan, validatePlan } from "./exploration.ts";
import type { Result } from "./result.ts";
import type { GameState } from "./state.ts";

/** Everything a turn's rules need, in exploration or combat. */
export type TurnContext = ExplorationContext & CombatContext;

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
  if (state.combat) return validateCombatPlan(state, actorId, actions, ctx);
  return validatePlan(state, actorId, actions, ctx);
}

const startsFight = (actions: readonly unknown[]) =>
  actions.some((a) => HOSTILE.has(String((a as { type?: unknown })?.type)));

/**
 * Resolves a validated plan (spec 08 step 5). A hostile action outside combat starts a fight and
 * the rest of the plan runs as the first combat turn; in combat, AI turns run until the player's.
 */
export function resolveTurn(
  state: GameState,
  plan: TurnPlan,
  ctx: TurnContext,
  combatId: string,
): Result<{ events: EventDraft[]; resolution: Resolution }> {
  if (state.combat) return runCombatTurn(state, plan as never, ctx);
  if (startsFight(plan.actions))
    return startFight(
      state,
      plan.actorId,
      toCombatActions(plan.actions as { type: string }[]),
      combatId,
      ctx,
    );
  return resolvePlan(state, plan as never, ctx);
}

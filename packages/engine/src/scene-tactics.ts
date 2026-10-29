import type { CombatAction } from "@wyrd/core";
import { chooseActions } from "./combat/ai.ts";
import type { CombatContext } from "./combat/common.ts";
import type { GameState } from "./state.ts";

/** A civilian's expressed wish to escape is attempted on their normal turn, using normal AP. */
export function sceneActions(state: GameState, id: string, ctx: CombatContext): CombatAction[] {
  const combat = state.combat;
  const actor = state.actors[id];
  const me = combat?.combatants[id];
  const response = state.minds[id]?.memories.findLast(
    (m) => m.response?.incidentId === combat?.id && m.response?.actorId === id,
  )?.response;
  if (combat && me && actor?.role === "npc" && response?.kind === "withdraw") {
    const fleeing = {
      ...state,
      combat: { ...combat, combatants: { ...combat.combatants, [id]: { ...me, fleeing: true } } },
    };
    const plan = chooseActions(fleeing, id, ctx);
    if (plan.some((a) => a.type !== "endTurn")) return plan;
  }
  return chooseActions(state, id, ctx);
}

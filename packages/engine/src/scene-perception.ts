import type { GameState } from "./state.ts";

export function awake(state: GameState, id: string): boolean {
  const actor = state.actors[id];
  return !actor?.dead && !actor?.sheet.status.conditions.some((c) => c.id === "core:unconscious");
}

/** Same or adjoining open zone. A closed sight barrier does not establish a witness. */
export function perceives(state: GameState, observerId: string, subjectId: string): boolean {
  const scene = state.scene;
  if (!scene || !awake(state, observerId)) return false;
  const conditions = state.actors[observerId]?.sheet.status.conditions ?? [];
  if (conditions.some((c) => c.id === "core:blinded") && conditions.some((c) => c.id === "core:deafened"))
    return false;
  const a = scene.positions[observerId];
  const b = scene.positions[subjectId];
  return (
    !!a &&
    !!b &&
    (a === b ||
      scene.edges.some((e) => !e.blocksSight && ((e.a === a && e.b === b) || (e.a === b && e.b === a))))
  );
}

export type WitnessContext = {
  combatInfo: (id: string) => { canFight?: boolean };
  kindOf?: (id: string) => string | undefined;
};

export function sceneWitnesses(
  state: GameState,
  actorId: string,
  targetId: string,
  ctx: WitnessContext,
): string[] {
  return Object.keys(state.scene?.positions ?? {})
    .filter((id) => {
      if (id === actorId || !awake(state, id) || ctx.combatInfo(id).canFight === false) return false;
      const kind = ctx.kindOf?.(id);
      if (kind && kind !== "npc" && kind !== "creature") return false;
      return perceives(state, id, actorId) && perceives(state, id, targetId);
    })
    .sort();
}

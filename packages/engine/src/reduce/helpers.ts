import type { CharacterSheet, CompanionState } from "@wyrd/core";
import { effectiveHpMax } from "../injury/hp.ts";
import type { GameState } from "../state.ts";

export function updateSheet(
  state: GameState,
  actorId: string,
  fn: (sheet: CharacterSheet) => CharacterSheet,
): GameState {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Event refers to unknown actor ${actorId}`);
  return { ...state, actors: { ...state.actors, [actorId]: { ...actor, sheet: fn(actor.sheet) } } };
}

export function companion(
  state: GameState,
  id: string,
  fn: (c: CompanionState) => CompanionState,
): GameState {
  // Snapshots from before M6 have no companions map.
  const c = state.companions?.[id];
  if (!c) throw new Error(`Event refers to unknown companion ${id}`);
  return { ...state, companions: { ...state.companions, [id]: fn(c) } };
}

/** Keeps current HP within the sheet's effective max, which wounds can lower. */
export const clampHp = (sheet: CharacterSheet): CharacterSheet => ({
  ...sheet,
  status: { ...sheet.status, hp: Math.min(sheet.status.hp, effectiveHpMax(sheet)) },
});

export const updateStatus = (
  state: GameState,
  actorId: string,
  fn: (status: CharacterSheet["status"]) => CharacterSheet["status"],
) => updateSheet(state, actorId, (sheet) => ({ ...sheet, status: fn(sheet.status) }));

export const mind = (s: GameState, npcId: string) => s.minds[npcId] ?? { memories: [], dispositions: {} };

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

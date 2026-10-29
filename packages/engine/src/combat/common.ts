import type {
  ActorId,
  Combatant,
  CombatState,
  CreatureDef,
  MechanicsLine,
  RangeBand,
  SceneState,
  Side,
  TacticsProfile,
  WeaponDef,
} from "@wyrd/core";
import type { InjuryContext } from "../injury/index.ts";
import type { GameState } from "../state.ts";

/** How canon describes a scene entity for combat: its stat block and side. Supplied by the caller. */
export type CombatInfo = {
  /** Creature stat block id (`fantasy-core:bandit`); missing = a generic commoner. */
  statBlock?: string;
  /** Morale group; entities in the same group fight together. */
  group?: string;
  leader?: boolean;
  tactics?: TacticsProfile;
  intent?: CombatState["intent"];
  /** Fights for the party (companions present in the scene). */
  ally?: boolean;
  /** False for items and places: they never join a fight. */
  canFight?: boolean;
};

export type CombatContext = InjuryContext & {
  nameOf: (id: string) => string;
  creatures: Record<string, CreatureDef & { id: string }>;
  /** Canon lookups for scene entities that aren't actors yet. */
  combatInfo: (entityId: string) => CombatInfo;
  /** Ammunition kinds from the pack's economy data (spec 11, Ammo). */
  ammo?: Record<string, { items: string[]; weapons: string[]; recover: number }>;
};

/** One thing that happened, for the mechanics log and the narrator. */
export type CombatStep = {
  actorId: ActorId;
  action: unknown;
  outcome: "done" | "critSuccess" | "success" | "failure" | "critFailure";
  summary: string;
  lines: MechanicsLine[];
  witnessIds?: string[];
};

export const combatOf = (state: GameState): CombatState => {
  if (!state.combat) throw new Error("No combat is running");
  return state.combat;
};

export const combatant = (state: GameState, id: ActorId): Combatant | undefined =>
  state.combat?.combatants[id];

export const currentActor = (state: GameState): ActorId | undefined => {
  const c = state.combat;
  return c ? c.order[c.turn] : undefined;
};

export const sheetOf = (state: GameState, id: ActorId) => {
  const a = state.actors[id];
  if (!a) throw new Error(`No actor ${id}`);
  return a.sheet;
};

export const hasCondition = (state: GameState, id: ActorId, conditionId: string) =>
  state.actors[id]?.sheet.status.conditions.some((c) => c.id === conditionId) ?? false;

export const conditionLevel = (state: GameState, id: ActorId, conditionId: string) =>
  state.actors[id]?.sheet.status.conditions.find((c) => c.id === conditionId)?.level ?? 0;

/** Still in the fight: alive, here, not out of action. Down-but-conscious actors keep fighting. */
export function canAct(state: GameState, id: ActorId): boolean {
  const c = combatant(state, id);
  if (c?.status !== "active") return false;
  if (state.actors[id]?.dead) return false;
  return !hasCondition(state, id, "core:unconscious");
}

/** Counts toward its side still fighting (fleeing enemies don't). */
export const stillFighting = (state: GameState, id: ActorId) =>
  canAct(state, id) && !combatant(state, id)?.fleeing;

export const sideOf = (state: GameState, id: ActorId): Side | undefined => combatant(state, id)?.side;

export const opponents = (state: GameState, id: ActorId): ActorId[] => {
  const side = sideOf(state, id);
  return Object.values(combatOf(state).combatants)
    .filter((c) => c.side !== side)
    .map((c) => c.actorId);
};

export const isEngaged = (state: GameState, a: ActorId, b: ActorId) =>
  combatOf(state).engaged.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

export const engagedWith = (state: GameState, id: ActorId): ActorId[] =>
  combatOf(state).engaged.flatMap(([x, y]) => (x === id ? [y] : y === id ? [x] : []));

export const zoneOf = (state: GameState, id: ActorId): string | undefined => state.scene?.positions[id];

/** A zone's tags, including any the fight changed (a doused lamp makes it dark). */
export function zoneTags(state: GameState, zoneId: string): string[] {
  const z = state.scene?.zones.find((x) => x.id === zoneId);
  const change = state.combat?.props[`zone:${zoneId}`];
  const base = z?.tags ?? [];
  return [...base.filter((t) => !change?.remove.includes(t)), ...(change?.add ?? [])];
}

/** Props in a zone with the affordances the fight has added or removed. */
export function propsIn(state: GameState, zoneId: string) {
  const z = state.scene?.zones.find((x) => x.id === zoneId);
  return (z?.props ?? []).map((p) => {
    const change = state.combat?.props[p.id];
    return {
      ...p,
      affordances: [...p.affordances.filter((a) => !change?.remove.includes(a)), ...(change?.add ?? [])],
    };
  });
}

/** Edges counted for range and sight: every edge, one step each. */
function distances(scene: SceneState, from: string, walkable: boolean): Map<string, number> {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const z = queue.shift()!;
    for (const e of scene.edges) {
      if (walkable && e.requires) continue;
      const next = e.a === z ? e.b : e.b === z ? e.a : null;
      if (next && !dist.has(next)) {
        dist.set(next, dist.get(z)! + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

export const zoneDistance = (scene: SceneState, a: string, b: string): number | undefined =>
  distances(scene, a, false).get(b);

/** Walkable neighbours and the AP a move there costs (difficult zones and climbs cost 2). */
export function neighbours(state: GameState, zoneId: string): Array<{ zoneId: string; cost: number }> {
  const scene = state.scene!;
  return scene.edges.flatMap((e) => {
    if (e.requires) return [];
    const next = e.a === zoneId ? e.b : e.b === zoneId ? e.a : null;
    if (!next) return [];
    const difficult = zoneTags(state, next).includes("difficult");
    return [{ zoneId: next, cost: Math.max(e.moveCost, difficult ? 2 : 1) }];
  });
}

/** Range band between two combatants (spec 03, "Range bands"). */
export function rangeBand(state: GameState, a: ActorId, b: ActorId): RangeBand | null {
  if (isEngaged(state, a, b)) return "engaged";
  const za = zoneOf(state, a);
  const zb = zoneOf(state, b);
  if (!za || !zb || !state.scene) return null;
  if (za === zb) return "close";
  const d = zoneDistance(state.scene, za, zb);
  if (d === undefined) return null;
  return d === 1 ? "near" : d <= 3 ? "far" : "distant";
}

/** Line of sight exists between zones unless an edge on the way blocks it. */
export function lineOfSight(state: GameState, a: ActorId, b: ActorId): boolean {
  const za = zoneOf(state, a);
  const zb = zoneOf(state, b);
  if (!za || !zb || !state.scene) return false;
  if (za === zb) return true;
  const scene = state.scene;
  const blocked = scene.edges.filter((e) => e.blocksSight);
  if (!blocked.length) return true;
  const open = { ...scene, edges: scene.edges.filter((e) => !e.blocksSight) };
  return zoneDistance(open, za, zb) !== undefined;
}

export function weaponById(
  ctx: CombatContext,
  id: string | null | undefined,
): (WeaponDef & { id: string }) | null {
  if (!id) return null;
  return Object.hasOwn(ctx.items.weapons, id) ? ctx.items.weapons[id]! : null;
}

/** The weapon an actor would strike with: the named held one, else the main hand, else the off hand. */
export function heldWeapon(state: GameState, id: ActorId, ctx: CombatContext, weaponId?: string) {
  const held = sheetOf(state, id).equipment.held;
  if (weaponId) return held.main === weaponId || held.off === weaponId ? weaponById(ctx, weaponId) : null;
  return weaponById(ctx, held.main) ?? weaponById(ctx, held.off);
}

export const isRangedWeapon = (w: WeaponDef | null) =>
  !!w && Object.keys(w.ranges).some((b) => b === "near" || b === "far" || b === "distant");

export const replaceCombatant = (combat: CombatState, c: Combatant): CombatState => ({
  ...combat,
  combatants: { ...combat.combatants, [c.actorId]: c },
});

/** Perceived health for people outside the party (spec 13: no exact enemy numbers). */
export function perceivedHealth(fraction: number): number {
  if (fraction <= 0) return 0;
  if (fraction < 0.35) return 0.25;
  if (fraction < 0.65) return 0.5;
  if (fraction < 0.95) return 0.75;
  return 1;
}

/** Stable, non-consuming jitter in [0, 1) for AI tie-breaking: same state, same choice. */
export function jitter(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

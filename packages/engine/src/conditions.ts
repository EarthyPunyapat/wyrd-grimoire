import type { AttributeId, ConditionInstance, EventDraft, Modifier } from "@wyrd/core";
import { draft } from "@wyrd/core";
import { fail, ok, type Result } from "./result.ts";
import type { GameState } from "./state.ts";

/** What a condition can know about a check it might affect. */
export type CheckContext = { skillId: string | null; attribute: AttributeId; tags: readonly string[] };

export type CheckEffect = {
  modifiers?: Modifier[];
  boons?: number;
  banes?: number;
  /** The check fails without a roll, with this reason. */
  autoFail?: string;
  /** The actor can't attempt the check at all. */
  blocked?: string;
  /** The condition is used up by this check (Inspired). */
  consumed?: boolean;
};

export type ConditionDef = {
  id: string;
  name: string;
  maxLevel?: number;
  variants?: readonly string[];
  /** Effects on the bearer's own checks. Effects on attackers and AP belong to combat (M4). */
  onCheck?: (ctx: CheckContext, c: ConditionInstance) => CheckEffect | undefined;
};

const has = (ctx: CheckContext, tag: string) => ctx.tags.includes(tag);
const mod = (source: string, value: number): CheckEffect => ({ modifiers: [{ source, value }] });

/** Core conditions (spec 02). Packs and plugins may add more. */
export const CORE_CONDITIONS: readonly ConditionDef[] = [
  {
    id: "core:prone",
    name: "Prone",
    onCheck: (ctx) =>
      ctx.skillId === "core:melee" || ctx.skillId === "core:dodge" ? mod("Prone", -20) : undefined,
  },
  {
    id: "core:grappled",
    name: "Grappled",
    onCheck: (ctx) => (has(ctx, "escape") ? undefined : mod("Grappled", -20)),
  },
  {
    id: "core:restrained",
    name: "Restrained",
    onCheck: (ctx) => (has(ctx, "attack") || ctx.skillId === "core:dodge" ? { banes: 1 } : undefined),
  },
  { id: "core:stunned", name: "Stunned" },
  { id: "core:dazed", name: "Dazed" },
  {
    id: "core:blinded",
    name: "Blinded",
    onCheck: (ctx) => {
      if (has(ctx, "sight")) return { autoFail: "Blinded" };
      if (has(ctx, "attack")) return mod("Blinded", -40);
      return undefined;
    },
  },
  {
    id: "core:deafened",
    name: "Deafened",
    onCheck: (ctx) => (has(ctx, "hearing") ? { autoFail: "Deafened" } : undefined),
  },
  {
    id: "core:frightened",
    name: "Frightened",
    // Spec: −20 while the source is in view. Until scenes track sight lines (M4/M5), assume it is.
    onCheck: (ctx) => (has(ctx, "fear") ? undefined : mod("Frightened", -20)),
  },
  {
    id: "core:concussed",
    name: "Concussed",
    onCheck: (ctx) =>
      ctx.attribute === "int" || ctx.attribute === "awa" ? mod("Concussed", -20) : undefined,
  },
  { id: "core:bleeding", name: "Bleeding", maxLevel: 3 },
  { id: "core:burning", name: "Burning" },
  { id: "core:poisoned", name: "Poisoned" },
  {
    id: "core:exhausted",
    name: "Exhausted",
    maxLevel: 5,
    onCheck: (_ctx, c) => mod(`Exhausted ${c.level ?? 1}`, -10 * (c.level ?? 1)),
  },
  {
    id: "core:unconscious",
    name: "Unconscious",
    onCheck: (ctx) => (has(ctx, "resist") ? undefined : { blocked: "Unconscious" }),
  },
  { id: "core:hidden", name: "Hidden" },
  { id: "core:in-cover", name: "In Cover", variants: ["partial", "full"] },
  {
    id: "core:intoxicated",
    name: "Intoxicated",
    maxLevel: 3,
    onCheck: (ctx, c) => {
      const level = c.level ?? 1;
      if (has(ctx, "fear")) return mod(`Intoxicated ${level}`, 10);
      if (ctx.attribute === "agi" || ctx.attribute === "int" || ctx.attribute === "awa") {
        return mod(`Intoxicated ${level}`, -10 * level);
      }
      return undefined;
    },
  },
  { id: "core:inspired", name: "Inspired", onCheck: () => ({ boons: 1, consumed: true }) },
];

export const CONDITIONS: Record<string, ConditionDef> = Object.fromEntries(
  CORE_CONDITIONS.map((c) => [c.id, c]),
);

/** Collects every condition effect on one check, in condition order. */
export function conditionEffects(conditions: readonly ConditionInstance[], ctx: CheckContext) {
  const modifiers: Modifier[] = [];
  let boons = 0;
  let banes = 0;
  let autoFail: string | undefined;
  let blocked: string | undefined;
  const consumed: string[] = [];
  for (const c of conditions) {
    const e = CONDITIONS[c.id]?.onCheck?.(ctx, c);
    if (!e) continue;
    if (e.modifiers) modifiers.push(...e.modifiers);
    boons += e.boons ?? 0;
    banes += e.banes ?? 0;
    autoFail ??= e.autoFail;
    blocked ??= e.blocked;
    if (e.consumed) consumed.push(c.id);
  }
  return { modifiers, boons, banes, autoFail, blocked, consumed };
}

/**
 * Validates and applies a condition. Re-applying replaces the existing instance.
 * Exhausted 5 also makes the actor Unconscious (spec 02).
 */
export function applyCondition(
  state: GameState,
  actorId: string,
  condition: ConditionInstance,
): Result<EventDraft[]> {
  if (!state.actors[actorId]) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  const def = CONDITIONS[condition.id];
  if (!def) return fail("CONDITION_UNKNOWN", `Unknown condition ${condition.id}`);
  if (def.maxLevel !== undefined) {
    const level = condition.level ?? 1;
    if (level < 1 || level > def.maxLevel) {
      return fail("CONDITION_LEVEL_INVALID", `${def.name} levels are 1–${def.maxLevel}, got ${level}`);
    }
  } else if (condition.level !== undefined) {
    return fail("CONDITION_LEVEL_INVALID", `${def.name} has no levels`);
  }
  if (def.variants && (!condition.variant || !def.variants.includes(condition.variant))) {
    return fail("CONDITION_VARIANT_INVALID", `${def.name} needs a variant: ${def.variants.join(" or ")}`);
  }
  const drafts: EventDraft[] = [draft("ConditionApplied", { actorId, condition }, "engine")];
  if (condition.id === "core:exhausted" && condition.level === 5) {
    drafts.push(
      draft(
        "ConditionApplied",
        { actorId, condition: { id: "core:unconscious", note: "Exhausted 5" } },
        "engine",
      ),
    );
  }
  return ok(drafts);
}

export function removeCondition(
  state: GameState,
  actorId: string,
  conditionId: string,
  reason?: string,
): Result<EventDraft[]> {
  const actor = state.actors[actorId];
  if (!actor) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  if (!actor.sheet.status.conditions.some((c) => c.id === conditionId)) {
    return fail("CONDITION_NOT_PRESENT", `${actor.sheet.identity.name} is not ${conditionId}`);
  }
  return ok([draft("ConditionRemoved", { actorId, conditionId, ...(reason ? { reason } : {}) }, "engine")]);
}

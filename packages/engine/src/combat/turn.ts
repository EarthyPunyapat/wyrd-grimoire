import {
  type ActorId,
  CombatAction,
  type CombatActionInput,
  type CombatOutcome,
  draft,
  type EventDraft,
  type Resolution,
  type ResolvedStep,
} from "@wyrd/core";
import { applyCondition, removeCondition } from "../conditions.ts";
import { fail, ok, type Result } from "../result.ts";
import type { GameState } from "../state.ts";
import { Working } from "../working.ts";
import { type ActionError, apCost, resolveCombatAction, validateCombatAction } from "./actions.ts";
import { chooseActions } from "./ai.ts";
import {
  type CombatContext,
  type CombatStep,
  canAct,
  combatant,
  combatOf,
  currentActor,
  heldWeapon,
  replaceCombatant,
  sheetOf,
  weaponById,
} from "./common.ts";
import { checkMorale, combatOutcome, endCombat, endTurn, startCombat } from "./flow.ts";

export type CombatPlanError = { actionIndex: number } & ActionError;
export type ValidatedCombatPlan = { actorId: ActorId; actions: CombatAction[] };

const HOSTILE = new Set(["strike", "shove", "trip", "grapple", "disarm"]);

/**
 * Applies the deterministic part of an action (position, engagement, AP, gear) so later actions in
 * the same plan are judged from where the earlier ones leave the actor ("close in, then strike").
 */
function project(w: Working, actorId: ActorId, a: CombatAction, ctx: CombatContext) {
  const c = combatOf(w.state);
  const me = combatant(w.state, actorId)!;
  let next = replaceCombatant(c, { ...me, ap: Math.max(0, me.ap - apCost(w.state, actorId, a, ctx)) });
  const unengage = (id: ActorId) => next.engaged.filter(([x, y]) => x !== id && y !== id);
  if (a.type === "engage") next = { ...next, engaged: [...next.engaged, [actorId, a.targetId]] };
  if (a.type === "disengage" || a.type === "move") next = { ...next, engaged: unengage(actorId) };
  if (a.type === "reload") next = replaceCombatant(next, { ...next.combatants[actorId]!, loaded: true });
  if (a.type === "aim")
    next = replaceCombatant(next, { ...next.combatants[actorId]!, aim: Math.min(2, me.aim + 1) });
  if (a.type === "defend") next = replaceCombatant(next, { ...next.combatants[actorId]!, defending: true });
  if (a.type === "strike" && heldWeapon(w.state, actorId, ctx)?.reloadAp)
    next = replaceCombatant(next, { ...next.combatants[actorId]!, loaded: false });
  w.apply([draft("CombatChanged", { combat: next }, "engine")]);
  if (a.type === "move")
    w.apply([draft("EntityMoved", { entityId: actorId, toZoneId: a.toZoneId }, "engine")]);
  if (a.type === "draw") {
    const eq = sheetOf(w.state, actorId).equipment;
    const wpn = weaponById(ctx, a.weaponId);
    w.apply([
      draft(
        "EquipmentChanged",
        {
          actorId,
          equipment: {
            ...eq,
            held: wpn?.hands === 2 ? { main: a.weaponId, off: null } : { ...eq.held, main: a.weaponId },
          },
        },
        "engine",
      ),
    ]);
  }
  if (a.type === "takeCover") {
    const r = applyCondition(w.state, actorId, { id: "core:in-cover", variant: "partial" });
    if (r.ok) w.apply(r.value);
  }
  if (a.type === "standUp") {
    const r = removeCondition(w.state, actorId, "core:prone");
    if (r.ok) w.apply(r.value);
  }
}

/** Validates a combat plan for the actor's current turn: shape, AP, range, gear, props (stable error codes). */
export function validateCombatPlan(
  state: GameState,
  actorId: ActorId,
  actions: readonly unknown[],
  ctx: CombatContext,
): Result<ValidatedCombatPlan> & { planErrors?: CombatPlanError[] } {
  if (!state.combat) return { ...fail("NOT_IN_COMBAT", "No fight is under way"), planErrors: [] };
  if (!combatant(state, actorId))
    return { ...fail("NOT_IN_FIGHT", `${actorId} isn't in this fight`), planErrors: [] };
  const errors: CombatPlanError[] = [];
  if (!actions.length)
    errors.push({ actionIndex: 0, code: "PLAN_EMPTY", message: "The plan has no actions" });
  const parsed: CombatAction[] = [];
  const w = new Working(state);
  // Validate as if it's this actor's turn now, with their full AP.
  if (currentActor(state) !== actorId || combatant(state, actorId)!.ap === 0) {
    const me = combatant(state, actorId)!;
    w.apply([
      draft(
        "CombatChanged",
        { combat: replaceCombatant(combatOf(state), { ...me, ap: ctx.tuning.fight.apPerTurn }) },
        "engine",
      ),
    ]);
  }
  actions.forEach((raw, i) => {
    const r = CombatAction.safeParse(raw);
    if (!r.success) {
      const type = (raw as { type?: unknown })?.type;
      const known = CombatAction.options.some((o) => o.shape.type.value === type);
      errors.push({
        actionIndex: i,
        code: known ? "ACTION_INVALID" : "ACTION_NOT_AVAILABLE",
        message: known
          ? r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")
          : `"${String(type)}" isn't a combat action; use one of ${CombatAction.options.map((o) => o.shape.type.value).join(", ")}`,
      });
      return;
    }
    parsed.push(r.data);
    const e = validateCombatAction(w.state, actorId, r.data, combatant(w.state, actorId)!.ap, ctx);
    if (e) errors.push({ actionIndex: i, ...e });
    else project(w, actorId, r.data, ctx);
  });
  if (errors.length)
    return { ok: false, errors: errors.map(({ code, message }) => ({ code, message })), planErrors: errors };
  return ok({ actorId, actions: parsed });
}

type Ran = {
  steps: Array<CombatStep & { phase: "player" | "others" }>;
  outcome: CombatOutcome | null;
  stoppedAt?: number;
};

/** Runs one actor's actions in order, re-validating each against the state the earlier ones left. */
function runActions(
  w: Working,
  actorId: ActorId,
  actions: CombatAction[],
  phase: "player" | "others",
  ctx: CombatContext,
  ran: Ran,
) {
  for (const [i, a] of actions.entries()) {
    const me = combatant(w.state, actorId);
    if (!me) return;
    const e = validateCombatAction(w.state, actorId, a, me.ap, ctx);
    if (e) {
      if (phase === "player") {
        ran.stoppedAt = i;
        ran.steps.push({
          actorId,
          action: a,
          outcome: "failure",
          summary: `${ctx.nameOf(actorId)} couldn't go on: ${e.message}.`,
          lines: [],
          phase,
        });
      }
      return;
    }
    if (a.type === "surrender") {
      const accepted = ["rob", "capture", "arrest", "driveOff"].includes(combatOf(w.state).intent);
      if (accepted) {
        w.apply([
          draft(
            "CombatChanged",
            { combat: replaceCombatant(combatOf(w.state), { ...me, status: "surrendered" }) },
            "engine",
          ),
        ]);
        ran.steps.push({
          actorId,
          action: a,
          outcome: "done",
          summary: `${ctx.nameOf(actorId)} surrendered, and it was accepted.`,
          lines: [],
          phase,
        });
        ran.outcome = combatOutcome(w.state, ctx);
        return;
      }
      ran.steps.push({
        actorId,
        action: a,
        outcome: "failure",
        summary: `${ctx.nameOf(actorId)} tried to surrender; they won't have it.`,
        lines: [],
        phase,
      });
      continue;
    }
    const r = resolveCombatAction(w, actorId, a, ctx);
    if (!r.ok) {
      ran.steps.push({
        actorId,
        action: a,
        outcome: "failure",
        summary: `${ctx.nameOf(actorId)} couldn't: ${r.errors[0]?.message ?? "no"}.`,
        lines: [],
        phase,
      });
      return;
    }
    ran.steps.push(...r.value.map((s) => ({ ...s, phase })));
    ran.steps.push(...checkMorale(w, ctx).map((s) => ({ ...s, phase })));
    ran.outcome = combatOutcome(w.state, ctx);
    if (ran.outcome || !canAct(w.state, actorId)) return;
  }
}

/** Ends turns and runs AI-controlled combatants until a player-controlled one can act (spec 08 step 5). */
function runOthers(w: Working, ctx: CombatContext, ran: Ran, stopAtPlayer: boolean) {
  const limit = ctx.tuning.fight.maxRounds * Math.max(1, combatOf(w.state).order.length);
  for (let i = 0; i < limit && !ran.outcome; i++) {
    const id = currentActor(w.state)!;
    const c = combatant(w.state, id)!;
    if (stopAtPlayer && c.controlled && canAct(w.state, id) && c.ap > 0) return;
    if (canAct(w.state, id) && !c.controlled)
      runActions(w, id, chooseActions(w.state, id, ctx), "others", ctx, ran);
    if (ran.outcome) return;
    ran.steps.push(...endTurn(w, ctx).map((s) => ({ ...s, phase: "others" as const })));
    ran.outcome = combatOutcome(w.state, ctx);
  }
  if (!ran.outcome) ran.outcome = "truce";
}

export type CombatTurnResult = { events: EventDraft[]; resolution: Resolution };

/** Turns the fight's steps into the narrator's resolution: the player's passage, then everyone else's. */
function toResolution(
  actorId: ActorId,
  w: Working,
  ran: Ran,
  ended: { summary: string; hook?: string } | null,
  roundAtStart: number,
): Resolution {
  const steps: ResolvedStep[] = ran.steps.map((s, index) => ({
    index,
    action: s.action,
    outcome: s.outcome,
    summary: s.summary,
    ...(s.lines[0] ? { mechanics: s.lines[0] } : {}),
    lines: s.lines,
    actorId: s.actorId,
    phase: s.phase,
  }));
  const beats = ran.steps.map((s) => s.summary);
  if (ended) beats.push(ended.summary);
  const round = w.state.combat?.round ?? roundAtStart;
  return {
    actorId,
    steps,
    requiredBeats: beats,
    forbidden: [
      "No numbers in the prose; the mechanics log carries them.",
      "Don't invent hits, wounds, deaths or outcomes beyond the steps.",
      "Don't decide the player's next move or feelings.",
    ],
    ...(ran.stoppedAt !== undefined ? { stoppedAt: ran.stoppedAt } : {}),
    minutes: 0,
    combat: {
      round,
      ...(ended ? { ended: ran.outcome ?? "truce" } : {}),
      ...(ended?.hook ? { hook: ended.hook } : {}),
    },
  };
}

function finish(
  w: Working,
  actorId: ActorId,
  ran: Ran,
  ctx: CombatContext,
  roundAtStart: number,
): CombatTurnResult {
  let ended: { summary: string; hook?: string } | null = null;
  if (ran.outcome && w.state.combat) {
    const rounds = w.state.combat.round;
    const e = endCombat(w, ran.outcome, ctx);
    ran.steps.push(...e.steps.map((s) => ({ ...s, phase: "others" as const })));
    ended = { summary: e.summary, ...(e.hook ? { hook: e.hook } : {}) };
    w.apply([
      draft("TimeAdvanced", { minutes: Math.max(1, Math.ceil(rounds / 10)), reason: "combat" }, "engine"),
    ]);
  }
  return { events: w.events, resolution: toResolution(actorId, w, ran, ended, roundAtStart) };
}

/**
 * One player turn in a fight: the PC's validated actions, end of turn, then every AI-controlled
 * combatant until the PC acts again or the fight ends (spec 03 pacing: two passages).
 */
export function runCombatTurn(
  state: GameState,
  plan: ValidatedCombatPlan,
  ctx: CombatContext,
): Result<CombatTurnResult> {
  if (!state.combat) return fail("NOT_IN_COMBAT", "No fight is under way");
  const w = new Working(state);
  const ran: Ran = { steps: [], outcome: null };
  const roundAtStart = state.combat.round;
  if (currentActor(w.state) !== plan.actorId) runOthers(w, ctx, ran, true);
  if (!ran.outcome && currentActor(w.state) === plan.actorId) {
    runActions(w, plan.actorId, plan.actions, "player", ctx, ran);
    if (!ran.outcome) {
      ran.steps.push(...endTurn(w, ctx).map((s) => ({ ...s, phase: "others" as const })));
      ran.outcome = combatOutcome(w.state, ctx);
    }
    if (!ran.outcome) runOthers(w, ctx, ran, true);
  }
  return ok(finish(w, plan.actorId, ran, ctx, roundAtStart));
}

/** Exploration actions as their combat equivalents when a turn turns into a fight. */
export function toCombatActions(
  actions: readonly { type: string; [k: string]: unknown }[],
): CombatActionInput[] {
  return actions.flatMap((a): CombatActionInput[] => {
    if (a.type === "talk")
      return [{ type: "speak", utterance: String(a.utterance), targetId: String(a.targetId) }];
    if (a.type === "move") return [{ type: "move", toZoneId: String(a.toZoneId) }];
    const parsed = CombatAction.safeParse(a);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * A hostile action outside combat starts a fight (spec 03). Everyone rolls initiative; others act
 * until the initiator's turn; then the initiator's plan runs as their first turn.
 */
export function startFight(
  state: GameState,
  actorId: ActorId,
  actions: readonly CombatActionInput[],
  combatId: string,
  ctx: CombatContext,
): Result<CombatTurnResult> {
  const targets = actions.flatMap((a) =>
    HOSTILE.has(a.type) && "targetId" in a && a.targetId ? [a.targetId] : [],
  );
  if (!targets.length) return fail("NO_HOSTILE_ACTION", "Nothing in the plan starts a fight");
  const started = startCombat(state, { initiatorId: actorId, targetIds: targets, combatId }, ctx);
  if (!started.ok) return started;
  const w = started.value;
  const ran: Ran = { steps: [], outcome: null };
  ran.steps.push({
    actorId,
    action: { type: "startCombat" },
    outcome: "done",
    summary: `A fight breaks out: ${Object.values(combatOf(w.state).combatants)
      .filter((c) => c.side === "enemy")
      .map((c) => ctx.nameOf(c.actorId))
      .join(", ")} against ${ctx.nameOf(actorId)}.`,
    lines: [
      {
        text: `Initiative: ${combatOf(w.state)
          .order.map((id) => ctx.nameOf(id))
          .join(" → ")}`,
      },
    ],
    phase: "player",
  });
  runOthers(w, ctx, ran, true);
  if (!ran.outcome && currentActor(w.state) === actorId) {
    const v = validateCombatPlan(w.state, actorId, actions, ctx);
    const plan = v.ok
      ? v.value.actions
      : (actions
          .map((a) => CombatAction.safeParse(a))
          .flatMap((r) => (r.success ? [r.data] : [])) as CombatAction[]);
    runActions(w, actorId, plan, "player", ctx, ran);
    if (!ran.outcome) {
      ran.steps.push(...endTurn(w, ctx).map((s) => ({ ...s, phase: "others" as const })));
      ran.outcome = combatOutcome(w.state, ctx);
    }
    if (!ran.outcome) runOthers(w, ctx, ran, true);
  }
  return ok(finish(w, actorId, ran, ctx, 1));
}

/** Runs a whole fight with every side on AI control (golden scenarios, simulations). */
export function autoFight(state: GameState, ctx: CombatContext): CombatTurnResult {
  const w = new Working(state);
  const ran: Ran = { steps: [], outcome: null };
  const all = combatOf(w.state);
  w.apply([
    draft(
      "CombatChanged",
      {
        combat: {
          ...all,
          combatants: Object.fromEntries(
            Object.entries(all.combatants).map(([k, c]) => [k, { ...c, controlled: false }]),
          ),
        },
      },
      "engine",
    ),
  ]);
  runOthers(w, ctx, ran, false);
  return finish(w, state.party.pcId ?? "", ran, ctx, all.round);
}

export { HOSTILE };

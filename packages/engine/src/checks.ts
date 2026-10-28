import {
  ATTRIBUTE_NAMES,
  type AttributeId,
  type CheckAttempt,
  type CheckRequest,
  type CheckRequestInput,
  CheckRequest as CheckRequestSchema,
  type CheckResolvedPayload,
  type CheckResult,
  draft,
  type EventDraft,
  type Modifier,
  type PreparedCheck,
  Rng,
} from "@wyrd/core";
import { conditionEffects } from "./conditions.ts";
import { woundModifiers } from "./injury/penalties.ts";
import { compareResults, isSuccess, RESOLUTION_MODULES } from "./resolution/index.ts";
import { fail, ok, type Result } from "./result.ts";
import { governingAttribute, lookupSkill, skillLabel, skillValue } from "./skills.ts";
import type { GameState, RulesContext } from "./state.ts";

export type CheckOutcome = {
  events: EventDraft[];
  /** The result that counts for downstream rules. */
  effective: CheckResult;
};

export type OpposedOutcome = {
  events: EventDraft[];
  winner: "active" | "defender";
  active: CheckResult;
  defender: CheckResult;
};

type Rolled = {
  prepared: PreparedCheck;
  result: CheckResult;
  autoFailed: string | undefined;
  consumed: string[];
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Turns a request into the numbers a module rolls against: skill value, every modifier
 * (request, conditions, campaign difficulty) clamped to the cap, and net boons clamped to ±2.
 */
export function prepareCheck(
  state: GameState,
  req: CheckRequest,
  ctx: RulesContext,
): Result<{ prepared: PreparedCheck; autoFail: string | undefined; consumed: string[] }> {
  const actor = state.actors[req.actorId];
  if (!actor) return fail("ACTOR_UNKNOWN", `No actor ${req.actorId}`);
  const sheet = actor.sheet;

  let label: string;
  let value: number;
  let attribute: AttributeId;
  let skillId: string | null = null;
  if (typeof req.skill === "string") {
    try {
      const def = lookupSkill(req.skill, ctx.skills);
      attribute = governingAttribute(sheet.attributes, def);
      value = skillValue(sheet, req.skill, ctx.skills, ctx.tuning);
      label = skillLabel(req.skill, ctx.skills);
      skillId = req.skill;
    } catch (e) {
      return fail("SKILL_UNKNOWN", (e as Error).message);
    }
  } else {
    attribute = req.skill.attribute;
    value = sheet.attributes[attribute] * 10;
    label = ATTRIBUTE_NAMES[attribute];
  }

  const effects = conditionEffects(sheet.status.conditions, { skillId, attribute, tags: req.tags });
  if (effects.blocked) {
    return fail("ACTOR_INCAPACITATED", `${sheet.identity.name} can't act: ${effects.blocked}`);
  }

  const wounds = woundModifiers(sheet, { skillId, attribute, tags: req.tags });
  const modifiers: Modifier[] = [...req.modifiers, ...effects.modifiers, ...wounds];
  const playerSide = actor.role === "pc" || actor.role === "companion";
  const campaignMod = ctx.tuning.campaignDifficultyModifier[state.campaign.settings.difficulty];
  if (playerSide && campaignMod !== 0) {
    modifiers.push({ source: `${state.campaign.settings.difficulty} difficulty`, value: campaignMod });
  }
  const raw = modifiers.reduce((s, m) => s + m.value, 0);
  const cap = ctx.tuning.modifierCap;

  return ok({
    prepared: {
      label,
      skillValue: value,
      difficulty: req.difficulty,
      modifiers,
      modifierTotal: clamp(raw, -cap, cap),
      netBoons: clamp(req.boons + effects.boons - req.banes - effects.banes, -2, 2),
    },
    autoFail: effects.autoFail,
    consumed: effects.consumed,
  });
}

function roll(state: GameState, rng: Rng, req: CheckRequest, ctx: RulesContext): Result<Rolled> {
  const prep = prepareCheck(state, req, ctx);
  if (!prep.ok) return prep;
  const { prepared, autoFail, consumed } = prep.value;
  if (autoFail) {
    const text = `${prepared.label} fails automatically (${autoFail})`;
    return ok({
      prepared,
      result: { degree: "failure", margin: 0, rolls: [], display: { text, degree: "failure" } },
      autoFailed: autoFail,
      consumed,
    });
  }
  const module = RESOLUTION_MODULES[state.campaign.settings.structural.resolution];
  return ok({ prepared, result: module.resolve(prepared, rng, ctx.tuning), autoFailed: undefined, consumed });
}

function resolvedEvents(
  state: GameState,
  req: CheckRequest,
  rolled: Rolled,
  effective: CheckResult,
  attempt: CheckAttempt,
  rngAfter: Rng,
  opposed?: CheckResolvedPayload["opposed"],
): EventDraft[] {
  const payload: CheckResolvedPayload = {
    actorId: req.actorId,
    request: req,
    module: state.campaign.settings.structural.resolution,
    prepared: rolled.prepared,
    result: rolled.result,
    effective,
    attempt,
    inCombat: state.mode === "combat",
    ...(rolled.autoFailed ? { autoFailed: rolled.autoFailed } : {}),
    ...(opposed ? { opposed } : {}),
    rngAfter: [...rngAfter.state],
  };
  const events: EventDraft[] = [draft("CheckResolved", payload, "engine")];
  for (const conditionId of rolled.consumed) {
    events.push(draft("ConditionRemoved", { actorId: req.actorId, conditionId, reason: "used" }, "engine"));
  }
  return events;
}

/** Resolves a single (unopposed) check. */
export function resolveCheck(
  state: GameState,
  input: CheckRequestInput,
  ctx: RulesContext,
): Result<CheckOutcome> {
  const parsed = CheckRequestSchema.safeParse(input);
  if (!parsed.success) return fail("REQUEST_INVALID", parsed.error.message);
  const req = parsed.data;
  if (req.opposedBy) return fail("CHECK_IS_OPPOSED", "Use resolveOpposedCheck for opposed checks");
  return rerollAs(state, req, ctx, "initial", (r) => r);
}

/** Rolls `req` as the given attempt; `effectiveOf` decides which result counts. Shared by push and Luck. */
export function rerollAs(
  state: GameState,
  req: CheckRequest,
  ctx: RulesContext,
  attempt: CheckAttempt,
  effectiveOf: (result: CheckResult) => CheckResult,
): Result<CheckOutcome> {
  const rng = new Rng(state.campaign.rngState);
  const rolled = roll(state, rng, req, ctx);
  if (!rolled.ok) return rolled;
  const effective = effectiveOf(rolled.value.result);
  return ok({ events: resolvedEvents(state, req, rolled.value, effective, attempt, rng), effective });
}

/**
 * Pushes the actor's last check (spec 02): only after a failed, non-combat, unpushed check.
 * If the pushed roll fails too, it becomes a critFailure and the narrator must apply a consequence.
 */
export function pushCheck(state: GameState, actorId: string, ctx: RulesContext): Result<CheckOutcome> {
  const last = state.lastChecks[actorId];
  if (!last) return fail("NO_CHECK_TO_PUSH", "There is no check to push");
  if (last.inCombat) return fail("PUSH_IN_COMBAT", "Combat checks can't be pushed");
  if (last.opposed) return fail("PUSH_OPPOSED", "Opposed checks can't be pushed");
  if (last.autoFailed) return fail("PUSH_IMPOSSIBLE", "An automatic failure can't be pushed");
  if (last.pushed) return fail("ALREADY_PUSHED", "A check can only be pushed once");
  if (last.effective.degree !== "failure") {
    return fail("PUSH_NOT_FAILED", "Only a failed check (not a success or a critical failure) can be pushed");
  }
  const req: CheckRequest = { ...last.request, pushed: true };
  return rerollAs(state, req, ctx, "push", (result) =>
    isSuccess(result.degree)
      ? result
      : {
          ...result,
          degree: "critFailure",
          display: { text: `${result.display.text} · pushed → Critical failure`, degree: "critFailure" },
        },
  );
}

/** Resolves an opposed check: both sides roll, higher degree then margin wins, ties go to the defender. */
export function resolveOpposedCheck(
  state: GameState,
  input: CheckRequestInput,
  ctx: RulesContext,
): Result<OpposedOutcome> {
  const parsed = CheckRequestSchema.safeParse(input);
  if (!parsed.success) return fail("REQUEST_INVALID", parsed.error.message);
  const activeReq = parsed.data;
  if (!activeReq.opposedBy) return fail("CHECK_NOT_OPPOSED", "Request has no opposedBy");
  const defenderReq: CheckRequest = {
    actorId: activeReq.opposedBy.actorId,
    skill: activeReq.opposedBy.skill,
    difficulty: "normal",
    modifiers: [],
    boons: 0,
    banes: 0,
    purpose: `opposing: ${activeReq.purpose}`,
    tags: [],
  };

  const rng = new Rng(state.campaign.rngState);
  const a = roll(state, rng, activeReq, ctx);
  if (!a.ok) return a;
  const d = roll(state, rng, defenderReq, ctx);
  if (!d.ok) return d;
  const winner = compareResults(a.value.result, d.value.result);

  // Both events record the generator state after both rolls; replay only ever applies the latest.
  const events = [
    ...resolvedEvents(state, activeReq, a.value, a.value.result, "initial", rng, {
      role: "active",
      againstActorId: defenderReq.actorId,
      won: winner === "active",
    }),
    ...resolvedEvents(state, defenderReq, d.value, d.value.result, "initial", rng, {
      role: "defender",
      againstActorId: activeReq.actorId,
      won: winner === "defender",
    }),
  ];
  return ok({ events, winner, active: a.value.result, defender: d.value.result });
}

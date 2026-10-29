import {
  type Ability,
  type CheckResult,
  defaultTuning,
  type Level,
  type PreparedCheck,
  type Rng,
  type Tuning,
} from "@wyrd/core";
import { resolveD20 } from "./resolution/d20.ts";

export type Leveled = { level?: Level; effectiveLevel?: Level };
export const effectiveLevel = (sheet: Leveled, tuning = defaultTuning): Level =>
  sheet.effectiveLevel ?? sheet.level ?? tuning.levels.start;
export function levelDelta(actor: Leveled, opposition: Leveled, tuning = defaultTuning): number | "infinite" {
  const a = effectiveLevel(actor, tuning);
  const b = effectiveLevel(opposition, tuning);
  if (a === "infinite") return b === "infinite" ? "infinite" : Infinity;
  return b === "infinite" ? -Infinity : a - b;
}
export function powerRating(
  sheet: Leveled & { abilities?: Ability[] },
  tuning = defaultTuning,
): number | string {
  const level = sheet.level ?? tuning.levels.start;
  if (level === "infinite") return "∞";
  const p = tuning.levels.powerRating;
  const rankFactor = 1 + (sheet.abilities ?? []).reduce((n, a) => n + a.rank, 0) / p.rankDivisor;
  const rating = p.base ** (p.exponent * level) * rankFactor;
  if (Number.isFinite(rating)) return Math.floor(rating);
  // Very large finite Levels retain a finite magnitude label, distinct from true infinity.
  return `10^${Math.floor(p.exponent * level * Math.log10(p.base) + Math.log10(rankFactor))}+`;
}

/** Level adjustments are native d20 units and bypass neither the gap table nor rank restrictions. */
export function resolveLevelCheck(
  p: PreparedCheck,
  delta: number | "infinite",
  rng: Rng,
  tuning: Tuning,
  options: { rank?: number; exploit?: string } = {},
): CheckResult {
  const t = tuning.levels;
  const automatic =
    delta === "infinite" ||
    !Number.isFinite(delta) ||
    (typeof delta === "number" && (delta >= t.autoGap || (delta <= -t.autoGap && !options.exploit?.trim())));
  if (automatic) {
    const degree = typeof delta === "number" && delta > 0 ? "success" : "failure";
    const reason = delta === "infinite" ? "infinite opposition: stalemate" : `level gap ${delta}`;
    return {
      degree,
      margin: 0,
      rolls: [],
      display: { text: `${p.label}: automatic ${degree} (${reason})`, degree },
    };
  }
  const bonus =
    delta === 0
      ? Math.ceil((options.rank ?? 0) / t.rankBonus.divisor)
      : Math.sign(delta as number) * t.oneStepBonus;
  const result = resolveD20(p, rng, tuning, bonus);
  return {
    ...result,
    display: {
      ...result.display,
      text: `${result.display.text} · level Δ${delta}${bonus ? ` (${bonus > 0 ? "+" : ""}${bonus})` : ""}${options.exploit ? ` · exploit: ${options.exploit}` : ""}`,
    },
  };
}

import {
  Ability as AbilitySchema,
  draft,
  type EventDraft,
  type LevelProposal,
  Level as LevelSchema,
} from "@wyrd/core";
import { resolveCheck } from "./checks.ts";
import { isSuccess } from "./resolution/index.ts";
import { fail, ok, type Result } from "./result.ts";
import type { GameState, RulesContext } from "./state.ts";

export type PendingLevel = LevelProposal & { status: "pending" | "accepted" | "superseded" };
export const levelProposals = (state: GameState): PendingLevel[] =>
  Object.values((state.flags.levelProposals ?? {}) as Record<string, PendingLevel>);
const actorProblem = (state: GameState, actorId: string) =>
  !state.actors[actorId] ? "Unknown actor" : state.actors[actorId]!.dead ? "The dead cannot advance" : null;
const above = (a: Level, b: Level) => b !== "infinite" && (a === "infinite" || a > b);

export function proposeLevelUp(
  state: GameState,
  actorId: string,
  level: Level,
  reason: string,
  id: string,
): Result<EventDraft[]> {
  const problem = actorProblem(state, actorId);
  if (problem) return fail("LEVEL_ACTOR", problem);
  const from = state.actors[actorId]!.sheet.level ?? defaultTuning.levels.start;
  if (!LevelSchema.safeParse(level).success || !above(level, from) || !reason.trim() || !id.trim())
    return fail("LEVEL_TARGET", "Propose a higher level with a reason");
  if (levelProposals(state).some((p) => p.id === id))
    return fail("LEVEL_PROPOSAL", "Proposal ID already exists");
  return ok([draft("LevelProposed", { proposal: { id, actorId, from, level, reason } }, "model")]);
}
export function acceptLevelUp(state: GameState, proposalId: string): Result<EventDraft[]> {
  const proposal = levelProposals(state).find((p) => p.id === proposalId);
  if (proposal?.status !== "pending") return fail("LEVEL_PROPOSAL", "No pending level proposal");
  const problem = actorProblem(state, proposal.actorId);
  if (problem) return fail("LEVEL_ACTOR", problem);
  if ((state.actors[proposal.actorId]!.sheet.level ?? defaultTuning.levels.start) !== proposal.from)
    return fail("LEVEL_STALE", "The character's level has changed");
  return ok([
    draft(
      "LevelGained",
      {
        actorId: proposal.actorId,
        from: proposal.from,
        level: proposal.level,
        method: "milestone",
        reason: proposal.reason,
        proposalId,
      },
      "player",
    ),
  ]);
}
export function grantAbility(state: GameState, actorId: string, input: Ability): Result<EventDraft[]> {
  const problem = actorProblem(state, actorId);
  if (problem) return fail("ABILITY_ACTOR", problem);
  const parsed = AbilitySchema.safeParse(input);
  if (!parsed.success) return fail("ABILITY_INVALID", parsed.error.message);
  if (state.actors[actorId]!.sheet.abilities?.some((a) => a.id === parsed.data.id))
    return fail("ABILITY_EXISTS", "Ability already exists; rank it instead");
  return ok([draft("AbilityGained", { actorId, ability: parsed.data }, "model")]);
}
export function rankAbility(
  state: GameState,
  actorId: string,
  abilityId: string,
  rank: number,
): Result<EventDraft[]> {
  const problem = actorProblem(state, actorId);
  if (problem) return fail("ABILITY_ACTOR", problem);
  const current = state.actors[actorId]!.sheet.abilities?.find((a) => a.id === abilityId);
  if (!current || !AbilitySchema.shape.rank.safeParse(rank).success || rank <= current.rank)
    return fail("ABILITY_RANK", "Choose an existing ability and a higher valid rank");
  return ok([draft("AbilityRanked", { actorId, abilityId, rank }, "model")]);
}
export function xpThreshold(level: number, tuning = defaultTuning): number {
  return (
    tuning.levels.xpThresholds[level] ??
    tuning.levels.xpCurve.base * (level - tuning.levels.start) ** tuning.levels.xpCurve.exponent
  );
}
/** Called after XP is resolved, or with an uncommitted batch of XP awards. Cosmic Levels are separate from class levels. */
export function xpLevelEvents(
  state: GameState,
  tuning: Tuning,
  awards: readonly EventDraft[] = [],
): EventDraft[] {
  const gained = awards.reduce((n, e) => n + (e.type === "XpAwarded" ? e.payload.amount : 0), 0);
  const events: EventDraft[] = [];
  for (const id of [state.party.pcId, ...state.party.companionIds]) {
    if (!id || actorProblem(state, id)) continue;
    const sheet = state.actors[id]!.sheet;
    const current = sheet.level ?? tuning.levels.start;
    if (current === "infinite") continue;
    let level: number = current;
    while (sheet.progression.xpEarned + gained >= xpThreshold(level + tuning.levels.step, tuning)) {
      const next = level + tuning.levels.step;
      events.push(
        draft("LevelGained", {
          actorId: id,
          from: level,
          level: next,
          method: "xp",
          reason: "Cumulative XP threshold",
        }),
      );
      level = next;
    }
  }
  return events;
}
export function breakthrough(
  state: GameState,
  actorId: string,
  skill: string,
  reason: string,
  hpCost: number,
  ctx: RulesContext,
): Result<EventDraft[]> {
  const problem = actorProblem(state, actorId);
  if (problem) return fail("LEVEL_ACTOR", problem);
  const sheet = state.actors[actorId]!.sheet;
  if (sheet.level === "infinite" || effectiveLevel(sheet) === "infinite")
    return fail("LEVEL_INFINITE", "Infinity has no breakthrough roll");
  if (!Number.isInteger(hpCost) || hpCost < 0 || hpCost >= sheet.status.hp)
    return fail("LEVEL_COST", "The HP cost must leave the actor alive");
  if (state.campaign.settings.structural.resolution !== "d20")
    return fail("LEVEL_DICE", "Breakthroughs use d20 campaigns");
  const result = resolveCheck(
    state,
    {
      actorId,
      skill,
      difficulty: ctx.tuning.levels.breakthroughDifficulty,
      purpose: reason,
      opposition: { level: effectiveLevel(sheet) },
    },
    ctx,
  );
  if (!result.ok) return result;
  const events = [...result.value.events];
  if (isSuccess(result.value.effective.degree)) {
    const from = sheet.level ?? ctx.tuning.levels.start;
    events.push(
      draft("LevelGained", {
        actorId,
        from,
        level: from + ctx.tuning.levels.step,
        method: "breakthrough",
        reason,
      }),
    );
    if (hpCost > 0)
      events.push(
        draft("HpChanged", { actorId, hp: sheet.status.hp - hpCost, delta: -hpCost, cause: "strain" }),
      );
  }
  return ok(events);
}

/** Explicit GM-mode correction, with an exact level inverse for the existing Retcon Undo flow. */
export function gmLevelChange(
  state: GameState,
  actorId: string,
  level: Level,
  reason: string,
): Result<{ drafts: EventDraft[]; inverse: EventDraft[] }> {
  const problem = actorProblem(state, actorId);
  if (problem) return fail("LEVEL_ACTOR", problem);
  if (!LevelSchema.safeParse(level).success || !reason.trim())
    return fail("LEVEL_TARGET", "Choose a valid level and reason");
  const from = state.actors[actorId]!.sheet.level ?? defaultTuning.levels.start;
  return ok({
    drafts: [draft("LevelGained", { actorId, from, level, method: "gm", reason }, "player")],
    inverse: [
      draft(
        "LevelGained",
        { actorId, from: level, level: from, method: "gm", reason: `Undo: ${reason}` },
        "player",
      ),
    ],
  });
}

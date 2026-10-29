import {
  type Card,
  CheckRequest,
  CompanionBondInput,
  DelegateArgs,
  DelegationTask,
  draft,
  type EventDraft,
  Rng,
} from "@wyrd/core";
import { prepareCheck } from "./checks.ts";
import { levelDelta, resolveLevelCheck } from "./levels.ts";
import { isSuccess } from "./resolution/index.ts";
import { fail, ok, type Result } from "./result.ts";
import { isKnownSkill } from "./skills.ts";
import type { GameState, RulesContext } from "./state.ts";
import { Working } from "./working.ts";

export const delegationTasks = (state: GameState): DelegationTask[] =>
  Object.values((state.flags.delegation ?? {}) as Record<string, DelegationTask>);
export const blockedTasks = (state: GameState) =>
  delegationTasks(state).filter((t) => t.status === "blocked");
export const nextDelegationBoundary = (state: GameState): number | undefined =>
  delegationTasks(state)
    .filter((t) => t.status === "active")
    .map((t) => t.resolveAt)
    .sort((a, b) => a - b)[0];
const available = (s: GameState, id: string) =>
  s.companions?.[id]?.status === "active" &&
  s.party.companionIds.includes(id) &&
  !!s.actors[id] &&
  !s.actors[id]!.dead;

export function companionBond(state: GameState, companionId: string, input: unknown): Result<EventDraft[]> {
  const bond = CompanionBondInput.safeParse(input);
  if (!bond.success) return fail("COMPANION_BOND", bond.error.message);
  if (!available(state, companionId)) return fail("COMPANION_UNKNOWN", "Choose an active living companion");
  return ok([draft("CompanionBondSet", { companionId, bond: bond.data }, "player")]);
}
export function assignTask(
  state: GameState,
  input: DelegateArgs & { id: string },
  ctx: RulesContext,
): Result<EventDraft[]> {
  const parsed = DelegateArgs.safeParse(input);
  if (!parsed.success) return fail("TASK_INVALID", parsed.error.message);
  const a = parsed.data;
  if (!available(state, a.assignee)) return fail("TASK_ASSIGNEE", "Choose an active living companion");
  const now = state.campaign.gameTime;
  if (a.due !== undefined && a.due <= now)
    return fail("TASK_DUE", "Due time must be in the future (game minutes)");
  const old = delegationTasks(state).find((t) => t.id === input.id);
  if (old && (old.status !== "blocked" || old.assignee !== a.assignee))
    return fail("TASK_EXISTS", "Only a blocked task for this companion can be reassigned");
  const sheet = state.actors[a.assignee]!.sheet;
  if (a.abilityId && !sheet.abilities?.some((ability) => ability.id === a.abilityId))
    return fail("TASK_ABILITY", "The companion does not have that ability");
  const skill = a.skill ?? ctx.tuning.delegation.skill;
  if (!isKnownSkill(skill, ctx.skills)) return fail("TASK_SKILL", "Unknown task skill");
  const opposition = a.opposition ?? {
    level: sheet.effectiveLevel ?? sheet.level ?? ctx.tuning.levels.start,
  };
  if ("actorId" in opposition && !state.actors[opposition.actorId])
    return fail("TASK_OPPOSITION", "Unknown opposition actor");
  const task = DelegationTask.parse({
    id: input.id,
    assignee: a.assignee,
    goal: a.goal,
    startedAt: now,
    progressedAt: now,
    dueAt: a.due,
    resolveAt: a.due ?? now + ctx.tuning.delegation.durationMinutes,
    status: "active",
    opposition,
    skill,
    abilityId: a.abilityId,
    exploit: a.exploit,
  });
  return ok([draft("TaskAssigned", { task }, "model")]);
}

/** A's level resolver is used in native d20 units in every campaign; only recorded results replay. */
export function advanceDelegations(
  state: GameState,
  ctx: RulesContext,
  at = state.campaign.gameTime,
): EventDraft[] {
  const w = new Working(state);
  const now = Math.min(at, state.campaign.gameTime);
  const pending = delegationTasks(state)
    .filter((t) => t.status === "active")
    .sort((a, b) => a.resolveAt - b.resolveAt || a.id.localeCompare(b.id));
  for (const task of pending) {
    if (now <= task.progressedAt) continue;
    if (now < task.resolveAt) {
      w.apply([draft("TaskProgressed", { taskId: task.id, at: now })]);
      continue;
    }
    const name = w.state.actors[task.assignee]?.sheet.identity.name ?? "Your companion";
    const report = (text: string) =>
      `${name}: ${task.goal} — ${text}`.slice(0, ctx.tuning.delegation.reportChars);
    const block = (reason: string) =>
      w.apply([
        draft("TaskBlocked", {
          taskId: task.id,
          at: task.resolveAt,
          report: report(`${reason} Needs your help.`),
        }),
      ]);
    if (!available(w.state, task.assignee)) {
      block("The assignee is no longer available.");
      continue;
    }
    const sheet = w.state.actors[task.assignee]!.sheet;
    const opposition =
      "actorId" in task.opposition ? w.state.actors[task.opposition.actorId]?.sheet : task.opposition;
    if (!opposition) {
      block("The opposition needs to be identified again.");
      continue;
    }
    const ability = task.abilityId ? sheet.abilities?.find((a) => a.id === task.abilityId) : undefined;
    if (task.abilityId && !ability) {
      block("The selected ability is no longer available.");
      continue;
    }
    const request = CheckRequest.parse({
      actorId: task.assignee,
      skill: task.skill,
      difficulty: ctx.tuning.delegation.difficulty,
      purpose: task.goal,
    });
    const prepared = prepareCheck(w.state, request, ctx);
    if (!prepared.ok || prepared.value.autoFail) {
      block("The assignee cannot attempt the task in their present condition.");
      continue;
    }
    const rng = new Rng(w.state.campaign.rngState);
    const roll = resolveLevelCheck(
      prepared.value.prepared,
      levelDelta(sheet, opposition, ctx.tuning),
      rng,
      ctx.tuning,
      { rank: ability?.rank, exploit: task.exploit },
    );
    w.apply([
      draft("TaskProgressed", { taskId: task.id, at: task.resolveAt, roll, rngAfter: [...rng.state] }),
    ]);
    if (!roll.rolls.length && !isSuccess(roll.degree)) {
      block("The level gap or infinite opposition requires a new plan.");
      continue;
    }
    for (const conditionId of prepared.value.consumed)
      w.apply([
        draft("ConditionRemoved", {
          actorId: task.assignee,
          conditionId,
          reason: "used on a delegated task",
        }),
      ]);
    const success = isSuccess(roll.degree);
    w.apply([
      draft("TaskEnded", {
        taskId: task.id,
        at: task.resolveAt,
        status: success ? "done" : "failed",
        report: report(success ? "Completed." : "The attempt failed."),
      }),
    ]);
  }
  return w.events;
}

/** Report cards contain only the player-assigned goal and the resolved outcome, never NPC minds. */
export function delegationReportCards(events: readonly EventDraft[]): Card[] {
  return events.flatMap((e) =>
    e.type === "TaskEnded" || e.type === "TaskBlocked"
      ? [
          {
            type: "report" as const,
            title: e.type === "TaskBlocked" ? "Delegation needs you" : "Delegation report",
            body: e.payload.report,
          },
        ]
      : [],
  );
}

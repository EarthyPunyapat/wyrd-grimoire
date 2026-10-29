import {
  type Card,
  draft,
  type EventDraft,
  type Fact,
  type SkipDigest,
  type SkipUntil,
  TimeSkipArgs,
  type Tuning,
  worldOf,
} from "@wyrd/core";
import { blockedTasks, delegationTasks, nextDelegationBoundary } from "./delegation.ts";
import { fail, ok, type Result } from "./result.ts";
import type { GameState } from "./state.ts";
import { Working } from "./working.ts";
import { describeDate, runTicks, type WorldContext } from "./world/ticks.ts";

export function observableIds(s: GameState): Set<string> {
  return new Set([
    ...Object.keys(s.knowledge.entities),
    ...[s.party.pcId, ...s.party.companionIds].filter((id): id is string => !!id),
    ...Object.keys(s.scene?.positions ?? {}),
    ...(s.scene ? [s.scene.locationId] : []),
  ]);
}
export const watchedIds = (s: GameState): string[] => (s.flags.watchList as string[] | undefined) ?? [];
export const lastSkip = (s: GameState): SkipDigest | undefined => s.flags.lastSkip as SkipDigest | undefined;
export function changeWatch(
  s: GameState,
  entityId: string,
  watch: boolean,
  tuning: Tuning,
): Result<EventDraft[]> {
  if (watch && !observableIds(s).has(entityId))
    return fail("WATCH_UNKNOWN", "Observe this entity before watching it");
  if (watchedIds(s).includes(entityId) === watch) return ok([]);
  if (watch && watchedIds(s).length >= tuning.skips.maxWatches)
    return fail("WATCH_LIMIT", "Remove a watch before adding another");
  return ok([
    watch ? draft("WatchAdded", { entityId }, "player") : draft("WatchRemoved", { entityId }, "player"),
  ]);
}

/** Current fact overlays, including accepted drafts that have not reached storage projections yet. */
export function skipFacts(base: Fact[], events: readonly EventDraft[], entityId: string): Fact[] {
  const facts = new Map(base.filter((f) => f.entityId === entityId).map((f) => [f.id, f]));
  for (const e of events) {
    if ((e.type === "FactAsserted" || e.type === "FactSuperseded") && e.payload.fact.entityId === entityId)
      facts.set(e.payload.fact.id, e.payload.fact);
    if (e.type === "FactRetracted") facts.delete(e.payload.factId);
    if (e.type === "FactSuperseded") facts.delete(e.payload.oldFactId);
  }
  return [...facts.values()].filter((f) => !f.retracted && !f.supersededBy);
}
function durationMinutes(value: number | string, t: Tuning["skips"]): number | null {
  if (typeof value === "number") return value;
  const match = /^(a|an|\d+(?:\.\d+)?)\s*(minutes?|hours?|days?|weeks?|months?|years?)$/i.exec(value.trim());
  if (!match) return null;
  const amount = /^(a|an)$/i.test(match[1]!) ? 1 : Number(match[1]);
  const unit = match[2]!.toLowerCase().replace(/s$/, "");
  const minutes = amount * (t.durationUnits[unit] ?? NaN);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}
const current = (f: Fact) => !f.retracted && !f.supersededBy;
function conditionMet(s: GameState, until: SkipUntil, facts: (id: string) => Fact[]): boolean {
  if ("taskIds" in until)
    return until.taskIds.every((id) =>
      delegationTasks(s).some((t) => t.id === id && (t.status === "done" || t.status === "failed")),
    );
  if ("clockId" in until) {
    const clock = s.clocks[until.clockId];
    return !!clock && clock.filled >= clock.segments;
  }
  return facts(until.entityId).some(
    (f) => current(f) && f.predicate === until.predicate && f.value === until.value,
  );
}
function criticalCanon(s: GameState, ctx: WorldContext, facts: (id: string) => Fact[]): boolean {
  return Object.values(s.clocks).some((c) => {
    if (
      c.kind !== "canon" ||
      !c.canon ||
      (s.flags.canonResults as Record<string, unknown> | undefined)?.[c.id]
    )
      return false;
    if ((s.flags.canonInterventions as Record<string, unknown> | undefined)?.[c.id]) return false;
    const intervention = c.canon.intervention;
    if (
      intervention &&
      facts(intervention.entityId).some(
        (f) =>
          current(f) &&
          worldOf(f) === worldOf(c) &&
          ["player", "engine", "model"].includes(f.source) &&
          f.predicate === intervention.predicate &&
          f.value !== false &&
          f.value !== null,
      )
    )
      return false;
    const elapsed = Math.floor(
      (s.campaign.gameTime - c.canon.startedAt) / ((c.paceDays ?? 1) * ctx.tuning.skips.minutesPerDay),
    );
    return Math.max(c.filled, elapsed) >= c.segments - 1;
  });
}
/** Only typed subjects and safe summaries: never serialize arbitrary event payloads or NPC minds. */
function incident(e: EventDraft, s: GameState): { ids: string[]; text: string } | null {
  switch (e.type) {
    case "ActorDied":
      return { ids: [e.payload.actorId], text: "Died." };
    case "NpcLifeEvent":
      return {
        ids: [e.payload.npcId, e.payload.otherId, e.payload.childId].filter((id): id is string => !!id),
        text: `A life event occurred: ${e.payload.kind}.`,
      };
    case "TaskEnded":
    case "TaskBlocked": {
      const task = delegationTasks(s).find((t) => t.id === e.payload.taskId);
      return task
        ? {
            ids: [task.assignee],
            text:
              e.type === "TaskBlocked"
                ? "A delegated task needs your help."
                : `A delegated task ${e.payload.status === "done" ? "completed" : "failed"}.`,
          }
        : null;
    }
    case "CanonClockResolved": {
      const c = s.clocks[e.payload.clockId];
      return c?.canon ? { ids: [c.canon.outcome.entityId], text: "A canon event was resolved." } : null;
    }
    case "QuestEnded": {
      const q = s.quests[e.payload.questId];
      return q?.giverId ? { ids: [q.giverId], text: `A quest ${e.payload.status}.` } : null;
    }
    case "NewsPublished":
      return {
        ids: e.payload.item.about,
        text:
          e.payload.item.kind === "faction"
            ? "A faction goal was achieved."
            : `A public ${e.payload.item.kind} event occurred.`,
      };
    case "ThreatAdvanced":
      return { ids: s.threat?.agentFactionId ? [s.threat.agentFactionId] : [], text: "The threat advanced." };
    case "ClockAdvanced": {
      const c = s.clocks[e.payload.clockId];
      return c?.ownerId ? { ids: [c.ownerId], text: "A clock advanced." } : null;
    }
    case "CanonActorActed":
      return { ids: [e.payload.entityId], text: "Continued their activities." };
    case "FactAsserted":
      return e.payload.fact.visibility === "secret"
        ? null
        : { ids: [e.payload.fact.entityId], text: "Public circumstances changed." };
    default:
      return null;
  }
}

export function runSkip(
  state: GameState,
  input: unknown,
  ctx: WorldContext,
  id: string,
): Result<{ events: EventDraft[]; digest: SkipDigest }> {
  const parsed = TimeSkipArgs.safeParse(input);
  if (!parsed.success) return fail("SKIP_INVALID", parsed.error.message);
  if (state.combat) return fail("SKIP_COMBAT", "Finish the fight before skipping time");
  const pc = state.party.pcId ? state.actors[state.party.pcId] : undefined;
  if (!pc || pc.dead || state.flags.ended) return fail("SKIP_ENDED", "A living player character is required");
  const a = parsed.data;
  const t = ctx.tuning.skips;
  const duration = a.until ? t.maxDays * t.minutesPerDay : durationMinutes(a.duration ?? a.minutes!, t);
  if (
    duration === null ||
    !Number.isSafeInteger(duration) ||
    duration <= 0 ||
    duration > t.maxDays * t.minutesPerDay
  )
    return fail("SKIP_DURATION", `Choose a duration of at most ${t.maxDays} days`);
  if (
    a.until &&
    "taskIds" in a.until &&
    a.until.taskIds.some((id) => !delegationTasks(state).some((task) => task.id === id))
  )
    return fail("SKIP_CONDITION", "Choose existing delegated task IDs");
  if (a.until && "clockId" in a.until && !state.clocks[a.until.clockId])
    return fail("SKIP_CONDITION", "Choose an existing clock");
  const w = new Working(structuredClone(state));
  const facts = (entityId: string) => skipFacts(ctx.factsAbout?.(entityId) ?? [], w.events, entityId);
  const from = state.campaign.gameTime;
  const end = from + duration;
  const watches = watchedIds(state);
  const notes = new Map(watches.map((id) => [id, [] as string[]]));
  let stop: SkipDigest["stop"] = a.until ? "limit" : "duration";
  const interruption = (): SkipDigest["stop"] | undefined => {
    if (w.state.actors[state.party.pcId!]?.dead || w.state.flags.ended) return "death";
    if (blockedTasks(w.state).length) return "task";
    if (criticalCanon(w.state, ctx, facts)) return "canon";
    return undefined;
  };
  while (true) {
    const interrupt = interruption();
    if (interrupt) {
      stop = interrupt;
      break;
    }
    if (a.until && conditionMet(w.state, a.until, facts)) {
      stop = "condition";
      break;
    }
    const now = w.state.campaign.gameTime;
    if (now >= end) break;
    const taskAt = nextDelegationBoundary(w.state);
    const nextDay = (Math.floor(now / t.minutesPerDay) + 1) * t.minutesPerDay;
    const to = Math.min(end, nextDay, taskAt !== undefined && taskAt > now ? taskAt : end);
    w.apply([draft("TimeAdvanced", { minutes: to - now, reason: a.reason })]);
    const events = runTicks(w.state, { ...ctx, factsAbout: facts });
    w.apply(events);
    let watchedMajor = false;
    for (const e of events) {
      const item = incident(e, w.state);
      if (!item) continue;
      for (const entityId of item.ids) {
        const entries = notes.get(entityId);
        if (!entries) continue;
        if (entries.length < t.reportEvents) entries.push(item.text);
        const severity =
          (e.type === "NewsPublished" ? t.newsSeverity[e.payload.item.kind] : undefined) ??
          t.eventSeverity[e.type];
        if (severity && t.severityOrder.indexOf(severity) >= t.severityOrder.indexOf(t.interruptSeverity))
          watchedMajor = true;
      }
    }
    const interruptAfter = interruption();
    if (interruptAfter || watchedMajor) {
      stop = interruptAfter ?? "watched";
      break;
    }
  }
  const to = w.state.campaign.gameTime;
  const ticks = w.events.filter((e) => e.type === "TickCompleted");
  const days = ticks.filter((e) => e.payload.kind === "day").length;
  const weeks = ticks.filter((e) => e.payload.kind === "week").length;
  const interrupted = ["watched", "canon", "task", "death"].includes(stop);
  const minutes = to - from;
  const elapsed =
    minutes >= t.minutesPerDay && minutes % t.minutesPerDay === 0
      ? `${minutes / t.minutesPerDay} ${minutes === t.minutesPerDay ? "day" : "days"}`
      : `${minutes} minutes`;
  const stopText: Record<SkipDigest["stop"], string> = {
    duration: "Duration complete.",
    condition: "Condition reached.",
    limit: "Condition not reached within the configured limit.",
    canon: "Stopped: a canon event is about to resolve.",
    task: "Stopped: a delegated task needs help.",
    watched: "Stopped: a watched entity had a major event.",
    death: "Stopped: the player's story ended.",
  };
  const summary = `${elapsed} passed; ${w.events.filter((e) => e.type === "TaskEnded").length} delegated tasks resolved. ${stopText[stop]}`;
  const digest: SkipDigest = {
    id,
    from,
    to,
    days,
    weeks,
    stop,
    interrupted,
    summary,
    reports: watches.map((entityId) => ({
      entityId,
      title: `Watch: ${ctx.nameOf(entityId)}`.slice(0, 80),
      body: `${describeDate(from, ctx.tuning.world, ctx.calendar)} → ${describeDate(to, ctx.tuning.world, ctx.calendar)}. ${[...new Set(notes.get(entityId))].join(" ") || "No notable changes observed."}`.slice(
        0,
        t.reportChars,
      ),
    })),
  };
  w.apply([draft("SkipCompleted", { digest })]);
  return ok({ events: w.events, digest });
}
export const skipReportCards = (digest: SkipDigest): Card[] => [
  { type: "report", title: "Time skip", body: digest.summary },
  ...digest.reports.map(({ title, body }) => ({ type: "report" as const, title, body })),
];

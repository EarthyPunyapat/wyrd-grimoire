import { draft, type Entity, ObserveArgs, TimeSkipArgs, WatchArgs } from "@wyrd/core";
import {
  blockedTasks,
  changeWatch,
  observableIds,
  runSkip,
  skipFacts,
  skipReportCards,
  Working,
} from "@wyrd/engine";
import { registerGmTool } from "../registry.ts";
import type { ToolContext, ToolRun } from "../tool-types.ts";

function entityOf(x: ToolContext, id: string): Entity | null {
  let entity = x.canon.entity(id);
  for (const e of x.pendingDrafts ?? []) {
    if (e.type === "EntityCreated" && e.payload.entity.id === id) entity = e.payload.entity;
    if (e.type === "EntityUpdated" && e.payload.entityId === id && entity)
      entity = { ...entity, ...e.payload.patch };
  }
  return entity;
}
function observation(targetId: string, x: ToolContext): ToolRun {
  const actor = x.state.actors[x.pcId];
  const infinite = (actor?.sheet.effectiveLevel ?? actor?.sheet.level) === "infinite";
  const known = observableIds(x.state).has(targetId);
  if (!known && !infinite) return { ok: false, body: { errors: `${targetId} is not known` } };
  const entity = entityOf(x, targetId);
  const target = x.state.actors[targetId];
  if (!entity && !target) return { ok: false, body: { errors: "No entity with that ID exists" } };
  const facts = skipFacts(x.canon.factsAbout(targetId), x.pendingDrafts ?? [], targetId).filter(
    (f) => f.visibility !== "secret",
  );
  const entry = { how: "deduced" as const, gameTime: x.state.campaign.gameTime };
  return {
    ok: true,
    body: {
      id: targetId,
      name: entity?.name ?? target?.sheet.identity.name,
      kind: entity?.kind ?? "npc",
      status: target?.dead ? "dead" : entity?.status,
      ...(known ? { summary: entity?.summary } : {}),
      facts: facts.map(({ predicate, value }) => ({ predicate, value })),
      zone: x.state.scene?.positions[targetId] ?? null,
      ...(target
        ? {
            level: target.sheet.effectiveLevel ?? target.sheet.level,
            hp: target.sheet.status.hp,
            dead: !!target.dead,
          }
        : {}),
    },
    effects: {
      drafts: [
        ...(!x.state.knowledge.entities[targetId]
          ? [draft("KnowledgeGained", { entityId: targetId, entry })]
          : []),
        ...facts
          .filter((f) => !x.state.knowledge.facts[f.id])
          .map((f) => draft("KnowledgeGained", { factId: f.id, entry })),
      ],
    },
  };
}
registerGmTool({
  name: "observe",
  description:
    "Observe an existing entity by ID. Effective Level infinity can observe entities not yet known; finite and sealed characters observe known entities. Returns public circumstances only, never private NPC minds or secret facts.",
  schema: ObserveArgs,
  run: ({ targetId }, x) => observation(targetId, x),
});
registerGmTool({
  name: "watch",
  description:
    "Add an entity or faction to the player's watch list for reports and major-event interruptions during time skips. Observe first if unknown (infinity only).",
  schema: WatchArgs,
  run: ({ entityId }, x) => {
    const observed = observation(entityId, x);
    if (!observed.ok) return observed;
    const w = new Working(x.state);
    w.apply(observed.effects?.drafts ?? []);
    const changed = changeWatch(w.state, entityId, true, x.ctx.tuning);
    if (!changed.ok) return { ok: false, body: { errors: changed.errors } };
    w.apply(changed.value);
    return { ok: true, body: { watched: entityId }, effects: { drafts: w.events } };
  },
});
registerGmTool({
  name: "unwatch",
  description: "Remove an entity or faction from the player's watch list.",
  schema: WatchArgs,
  run: ({ entityId }, x) => {
    const changed = changeWatch(x.state, entityId, false, x.ctx.tuning);
    return changed.ok
      ? { ok: true, body: { removed: entityId }, effects: { drafts: changed.value } }
      : { ok: false, body: { errors: changed.errors } };
  },
});
registerGmTool({
  name: "time_skip",
  description:
    "Advance duration (minutes or 'a month', '30 days') OR until {taskIds:[...]}, {clockId}, or {entityId,predicate,value}. Conditions are checked by the engine; use task IDs for 'until the clones are done'. Daily/weekly world ticks run, with canon and delegation. Stops for major watched events, a canon event about to resolve, or a blocked task. Returns a digest and watch reports. Bounded by tuning.skips.maxDays; legacy minutes remains supported.",
  schema: TimeSkipArgs,
  run: (a, x) => {
    x.onProgress?.({ phase: "simulating", detail: a.reason });
    const result = runSkip(
      x.state,
      a,
      {
        ...x.ctx,
        factsAbout: (id) => skipFacts(x.ctx.factsAbout?.(id) ?? [], x.pendingDrafts ?? [], id),
        npcs:
          x.ctx.npcs ??
          (() =>
            (x.canon.allEntities?.("npc") ?? [])
              .filter((e) => e.status === "active")
              .map((e) => ({
                id: e.id,
                name: e.name,
                ...(typeof e.data.age === "number" ? { age: e.data.age } : {}),
                ...(typeof e.data.role === "string" ? { role: e.data.role } : {}),
              }))),
      },
      x.newId(),
    );
    if (!result.ok) return { ok: false, body: { errors: result.errors } };
    const { events, digest } = result.value;
    const w = new Working(structuredClone(x.state));
    w.apply(events);
    return {
      ok: true,
      body: {
        minutes: digest.to - digest.from,
        interrupted: digest.interrupted,
        digest,
        blocked: blockedTasks(w.state).map((t) => ({ taskId: t.id, report: t.report })),
      },
      effects: {
        drafts: events,
        cards: skipReportCards(digest),
        progress: { phase: "simulating", detail: a.reason },
      },
    };
  },
});

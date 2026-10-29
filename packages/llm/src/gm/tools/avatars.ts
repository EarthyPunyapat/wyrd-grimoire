import { ATTRIBUTE_IDS, type Attributes, draft, type EventDraft, Level, WorldId } from "@wyrd/core";
import { buildSheet, createActor, runForSovereign } from "@wyrd/engine";
import { z } from "zod";
import { registerGmTool } from "../registry.ts";
import type { ToolContext } from "../tool-types.ts";

/**
 * A sovereign action during an active run ends it as `unsealed` (spec §7, D134). This is called for
 * any tool call that names the sovereign as its actor, before the tool's own effects are applied.
 */
export function sovereignIntervention(state: ToolContext["state"], actorId?: string): EventDraft[] {
  if (!actorId) return [];
  const run = runForSovereign(state, actorId);
  return run ? [draft("AvatarRunEnded", { avatarId: run.avatarId, reason: "unsealed" }, "player")] : [];
}

/** The actor a tool call names, including `change_state`/`act` lists that nest their actor. */
export function actingActorId(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const top = args as Record<string, unknown>;
  if (typeof top.actorId === "string") return top.actorId;
  for (const key of ["changes", "actions"]) {
    const list = top[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const id = (item as { actorId?: unknown } | null)?.actorId;
      if (typeof id === "string") return id;
    }
  }
  return undefined;
}

function avatarSheet(x: ToolContext, name: string, level: Level, description: string) {
  const start = x.ctx.tuning.creation.attributeStart;
  const attributes = Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, start])) as Attributes;
  return buildSheet(
    {
      id: x.newId(),
      identity: {
        name,
        ancestry: "core:human",
        background: description,
      },
      attributes,
      skills: {},
      level,
    },
    x.state.campaign.settings,
    x.ctx.tuning,
  );
}

registerGmTool({
  name: "create_avatar",
  description:
    "Send a finite avatar of the sovereign into a world at a chosen Level. The avatar rolls real dice, can die, and its death ends the run; the sovereign is unaffected.",
  schema: z.object({
    name: z.string().trim().min(1).max(80),
    level: Level,
    worldId: WorldId.optional(),
    description: z.string().trim().max(400).default(""),
  }),
  run: (a, x) => {
    const sovereign = x.state.actors[x.pcId]?.sheet;
    if (sovereign?.level !== "infinite")
      return { ok: false, body: { errors: "Only an infinite sovereign can send an avatar" } };
    if (a.level === "infinite")
      return { ok: false, body: { errors: "An avatar must have a finite Level and roll real dice" } };
    if (runForSovereign(x.state, x.pcId))
      return { ok: false, body: { errors: "An avatar run is already active" } };
    const sheet = avatarSheet(x, a.name, a.level, a.description);
    const created = createActor(x.state, sheet, "companion");
    if (!created.ok) return { ok: false, body: { errors: created.errors } };
    const drafts: EventDraft[] = [
      ...created.value,
      draft("CompanionJoined", { companionId: sheet.id, reason: "An avatar enters the world" }, "player"),
      draft(
        "CompanionControlSet",
        { companionId: sheet.id, control: "manual", directive: "follow" },
        "player",
      ),
      draft(
        "AvatarCreated",
        {
          avatarId: sheet.id,
          sovereignId: x.pcId,
          level: a.level,
          worldId: a.worldId ?? "world:main",
        },
        "player",
      ),
    ];
    return {
      ok: true,
      body: { avatarId: sheet.id, level: a.level, worldId: a.worldId ?? "world:main" },
      effects: { drafts, cards: [{ type: "status", actorId: sheet.id }] },
    };
  },
});

registerGmTool({
  name: "seal",
  description:
    "Seal a character's power to a finite effective Level. Resolution uses the seal until it is broken.",
  schema: z.object({
    actorId: z.string().optional(),
    effectiveLevel: Level,
    reason: z.string().trim().min(1).max(200).default("A seal is set"),
  }),
  run: (a, x) => {
    const actorId = a.actorId ?? x.pcId;
    if (!x.state.actors[actorId]) return { ok: false, body: { errors: `No actor ${actorId}` } };
    return {
      ok: true,
      body: { actorId, effectiveLevel: a.effectiveLevel, reason: a.reason },
      effects: { drafts: [draft("SealSet", { actorId, effectiveLevel: a.effectiveLevel }, "player")] },
    };
  },
});

registerGmTool({
  name: "unseal",
  description: "Break a seal; the character resolves at their true Level again. The world may notice.",
  schema: z.object({
    actorId: z.string().optional(),
    reason: z.string().trim().min(1).max(200).default("The seal breaks"),
  }),
  run: (a, x) => {
    const actorId = a.actorId ?? x.pcId;
    const sheet = x.state.actors[actorId]?.sheet;
    if (!sheet) return { ok: false, body: { errors: `No actor ${actorId}` } };
    if (sheet.effectiveLevel === undefined)
      return { ok: false, body: { errors: `${actorId} is not sealed` } };
    return {
      ok: true,
      body: { actorId, reason: a.reason },
      effects: { drafts: [draft("SealBroken", { actorId }, "player")] },
    };
  },
});

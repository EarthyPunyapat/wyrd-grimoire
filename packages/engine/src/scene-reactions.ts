import {
  defaultSceneReactionTuning,
  draft,
  type EventDraft,
  ReactionProfile,
  type Resolution,
  type SceneResponse,
} from "@wyrd/core";
import { apCost } from "./combat/actions.ts";
import type { CombatContext } from "./combat/common.ts";
import { neighbours } from "./combat/common.ts";
import { apFor } from "./combat/flow.ts";
import { joinDefender } from "./scene-arrivals.ts";
import { awake, perceives, sceneWitnesses } from "./scene-perception.ts";
import type { GameState } from "./state.ts";
import { Working } from "./working.ts";

export type SceneReactionContext = CombatContext & {
  kindOf?: (id: string) => string | undefined;
  /** Optional trusted canon metadata. Invalid or missing legacy values get conservative defaults. */
  reactionInfo?: (id: string) => unknown;
};

const HOSTILE = new Set(["strike", "shove", "trip", "grapple", "disarm", "intimidate"]);
const blockedSpeech = (s: GameState, id: string) =>
  !awake(s, id) || s.actors[id]?.sheet.status.conditions.some((c) => c.id === "core:silenced");

function profile(state: GameState, id: string, ctx: SceneReactionContext): ReactionProfile {
  const info = ReactionProfile.safeParse(ctx.reactionInfo?.(id));
  if (info.success) return info.data;
  const tactics = ctx.combatInfo(id).tactics ?? state.combat?.combatants[id]?.tactics;
  return ReactionProfile.parse({
    temperament: tactics === "protector" ? "protective" : tactics === "cowardly" ? "cautious" : "assertive",
  });
}

/** Civilian movement is a single legal step in the scene phase, never a teleport or free strike. */
function withdraw(w: Working, id: string, aggressorId: string, ctx: SceneReactionContext): string | null {
  const s = w.state;
  const here = s.scene?.positions[id];
  if (!here || s.combat?.combatants[id]) return null;
  const actor = s.actors[id];
  const conditions = actor?.sheet.status.conditions ?? [];
  if (conditions.some((c) => ["core:grappled", "core:restrained", "core:prone"].includes(c.id))) return null;
  const ap = apFor(s, id, ctx);
  const options = neighbours(s, here).filter((n) => {
    const cost = actor ? apCost(s, id, { type: "move", toZoneId: n.zoneId }, ctx) : n.cost;
    return cost <= ap && n.zoneId !== s.scene?.positions[aggressorId];
  });
  options.sort(
    (a, b) =>
      Number(s.scene!.zones.find((z) => z.id === b.zoneId)?.tags.includes("exit")) -
        Number(s.scene!.zones.find((z) => z.id === a.zoneId)?.tags.includes("exit")) ||
      a.zoneId.localeCompare(b.zoneId),
  );
  const to = options[0]?.zoneId;
  if (!to) return null;
  w.apply([draft("EntityMoved", { entityId: id, toZoneId: to }, "engine")]);
  return s.scene!.zones.find((z) => z.id === to)?.name ?? to;
}

/**
 * One scene phase per resolved turn. No model, companion control, stat edits or extra combat AP.
 * Persisted response memories are incident/round keys and survive reload/replay at gameTime zero.
 */
export function sceneReactions(
  state: GameState,
  resolution: Resolution,
  ctx: SceneReactionContext,
  incidentId: string,
): {
  events: EventDraft[];
  responses: SceneResponse[];
} {
  const w = new Working(state);
  const responses: SceneResponse[] = [];
  const rules = ctx.tuning.sceneReactions ?? defaultSceneReactionTuning;
  const actorId = resolution.actorId;
  const scene = state.scene;
  if (!scene) return { events: [], responses };
  const round = resolution.combat?.round ?? 0;
  const actions = resolution.steps.filter((s) => s.actorId === undefined || s.actorId === actorId);
  const hostile = actions.flatMap((s) => {
    const a = s.action as { type?: string; targetId?: string };
    return a.type && HOSTILE.has(a.type) && a.targetId ? [{ step: s, targetId: a.targetId }] : [];
  });
  const victims = new Set(hostile.map((x) => x.targetId));
  const witnesses = new Set(
    hostile.flatMap((x) => x.step.witnessIds ?? sceneWitnesses(state, actorId, x.targetId, ctx)),
  );
  const ownParty = (id: string) =>
    id === state.party.pcId ||
    state.party.companionIds.includes(id) ||
    state.companions?.[id]?.status === "active" ||
    ctx.combatInfo(id).ally;
  let witnessVoices = 0;
  const candidates = [...witnesses].sort(
    (a, b) =>
      Number(victims.has(b)) - Number(victims.has(a)) ||
      Number(profile(state, b, ctx).temperament === "protective") -
        Number(profile(state, a, ctx).temperament === "protective") ||
      a.localeCompare(b),
  );
  for (const id of candidates) {
    if (ownParty(id) || id === actorId || !scene.positions[id] || ctx.combatInfo(id).canFight === false)
      continue;
    if (!victims.has(id) && state.combat?.combatants[id]) continue;
    const kind = ctx.kindOf?.(id);
    if (kind && !["npc", "creature"].includes(kind)) continue;
    const past = (state.minds[id]?.memories ?? []).flatMap((m) =>
      m.response && m.response.incidentId === incidentId && m.response.aggressorId === actorId
        ? [m.response]
        : [],
    );
    if (past.some((x) => x.round === round)) continue;
    const stage = past.length + 1;
    const victim = victims.has(id);
    const subjectId = victim ? id : hostile[0]!.targetId;
    const p = profile(state, id, ctx);
    const response: SceneResponse = {
      actorId: id,
      aggressorId: actorId,
      subjectId,
      incidentId,
      round,
      stage,
      kind: "observe",
      utterance: "",
      speechStyle: p.speechStyle,
      summary: `${ctx.nameOf(id)} witnessed ${ctx.nameOf(actorId)} attempting violence against ${ctx.nameOf(subjectId)}.`,
    };
    const canReact = awake(w.state, id) && perceives(w.state, id, actorId) && perceives(w.state, actorId, id);
    const canSpeak = !blockedSpeech(w.state, id) && (p.canSpeak ?? kind !== "creature");
    const budget = victim || witnessVoices < rules.witnessVoices;
    const previous = past.findLast((x) => x.kind !== "observe");
    if (canReact && budget) {
      if (
        !victim &&
        p.temperament === "protective" &&
        stage >= rules.interveneAt &&
        joinDefender(w, id, subjectId, ctx)
      ) {
        response.kind = "intervene";
        response.utterance = "Enough. You'll have to get past me.";
        response.summary = `${ctx.nameOf(id)} joined ${ctx.nameOf(subjectId)}'s side at rolled initiative; no attack has happened from joining.`;
      } else if (victim && p.temperament === "cautious" && stage >= rules.interveneAt) {
        response.kind = "withdraw";
        response.utterance = "Stay away. I'm getting out of here!";
        response.summary = `${ctx.nameOf(id)} wants to disengage and escape on their next legal turn; they have not moved yet.`;
      } else if (!victim && (p.temperament === "cautious" || stage >= rules.interveneAt)) {
        const to = withdraw(w, id, actorId, ctx);
        response.kind = "withdraw";
        response.utterance = "Keep away from me. I'm getting clear.";
        response.summary = to
          ? `${ctx.nameOf(id)} stepped away into ${to}.`
          : `${ctx.nameOf(id)} wants distance but has no legal route to retreat.`;
      } else if (
        stage >= rules.seekHelpAt &&
        stage < rules.interveneAt &&
        canSpeak &&
        !past.some((x) => x.kind === "callForHelp")
      ) {
        const recipientId = candidates.find(
          (other) =>
            other !== id &&
            !victims.has(other) &&
            !blockedSpeech(w.state, other) &&
            perceives(w.state, other, id),
        );
        response.kind = "callForHelp";
        response.utterance = recipientId
          ? `${ctx.nameOf(recipientId)}, help me stop this!`
          : "Help! Stay back!";
        response.summary = `${ctx.nameOf(id)} called for help; nobody has arrived or intervened just because of the call.`;
        if (recipientId) response.recipientId = recipientId;
      } else {
        response.kind = victim && stage >= rules.interveneAt ? "defy" : "protest";
        response.utterance = victim
          ? p.temperament === "hostile"
            ? "Try that again and see what happens."
            : "Get your hands off me. Stay back!"
          : "Stop! Leave them alone.";
        response.summary = `${ctx.nameOf(id)} ${victim ? "demanded that the attack stop" : "protested the assault"}.`;
      }
      if (!canSpeak) {
        response.utterance = "";
        if (response.kind === "protest" || response.kind === "defy")
          response.summary = `${ctx.nameOf(id)} reacted defensively to the assault without speaking.`;
      }
      // Repeated neutral observation does not become the same warning each round.
      if (previous?.kind === response.kind && response.kind !== "intervene") {
        response.utterance = "";
        if (response.kind !== "withdraw" || w.state.scene?.positions[id] === state.scene?.positions[id])
          response.kind = "observe";
      } else if (!victim) witnessVoices++;
    }
    w.apply([
      draft(
        "MemoryRecorded",
        {
          memory: {
            id: `response:${incidentId}:${round}:${actorId}:${id}`,
            npcId: id,
            gameTime: state.campaign.gameTime,
            kind: "witnessed",
            content: `I witnessed attempted violence by ${ctx.nameOf(actorId)} against ${ctx.nameOf(subjectId)}.`,
            about: [actorId, subjectId],
            importance: 4,
            feeling: -2,
            belief: 1,
            response,
          },
        },
        "engine",
      ),
    ]);
    // Change disposition once for the incident, rather than driving every bystander to -100.
    if (!past.length)
      w.apply([
        draft(
          "DispositionChanged",
          {
            npcId: id,
            towardId: actorId,
            delta: {
              attitude: victim ? rules.victimAttitude : rules.witnessAttitude,
              fear: victim ? rules.victimFear : rules.witnessFear,
            },
            reason: victim ? "attempted assault" : "witnessed assault",
          },
          "engine",
        ),
      ]);
    if (response.kind !== "observe") responses.push(response);
  }
  if (!hostile.length)
    for (const step of actions) {
      const a = step.action as { type?: string; targetId?: string };
      if (
        !["talk", "speak"].includes(a.type ?? "") ||
        !a.targetId ||
        blockedSpeech(state, a.targetId) ||
        !(profile(state, a.targetId, ctx).canSpeak ?? ctx.kindOf?.(a.targetId) !== "creature") ||
        !perceives(state, actorId, a.targetId)
      )
        continue;
      const refusal = step.outcome === "failure" || step.outcome === "critFailure";
      responses.push({
        actorId: a.targetId,
        aggressorId: actorId,
        subjectId: a.targetId,
        incidentId,
        round,
        stage: 1,
        kind: refusal ? "refuse" : "answer",
        utterance: refusal ? "I'm not agreeing to that." : "I'm listening.",
        speechStyle: profile(state, a.targetId, ctx).speechStyle,
        summary: `${ctx.nameOf(a.targetId)} ${refusal ? "refused the proposal" : "heard the speaker and can answer using established facts"}.`,
      });
    }
  return { events: w.events, responses };
}

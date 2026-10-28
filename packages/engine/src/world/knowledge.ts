import { type ActorId, draft, type EventDraft, type Resolution, type Rumor } from "@wyrd/core";
import type { GameState } from "../state.ts";
import { Working } from "../working.ts";
import { runTicks, type WorldContext } from "./ticks.ts";

/** Canon lookups the knowledge layer needs (the caller supplies them; the engine never reads storage). */
export type KnowledgeContext = WorldContext & {
  /** Public fact ids about an entity, for what the PC learns by looking. */
  publicFactIds?: (entityId: string) => string[];
  /** Entity kind, so only people form memories. */
  kindOf?: (entityId: string) => string | undefined;
};

type Approach = "neutral" | "persuade" | "deceive" | "intimidate" | "charm";

/**
 * What an NPC makes of being told something (spec 07, "Being told"): a `told` memory whose belief
 * comes from the Deception vs Insight result, a disposition change, and, for lies and threats, a
 * rumour that starts with them and travels (fast up `reportsTo` lines).
 */
export function toldEvents(
  state: GameState,
  npcId: string,
  speakerId: ActorId,
  utterance: string,
  approach: Approach,
  won: boolean | null,
  ctx: KnowledgeContext,
): EventDraft[] {
  const t = state.campaign.gameTime;
  const n = (state.minds[npcId]?.memories.length ?? 0) + 1;
  const speaker = ctx.nameOf(speakerId);
  const lie = approach === "deceive";
  const importance = approach === "neutral" || approach === "charm" ? 2 : 3;
  const belief = approach === "deceive" ? (won ? 0.9 : 0.2) : won === false ? 0.5 : 1;
  const content = `${speaker} told me: "${utterance}"`;
  const drafts: EventDraft[] = [
    draft(
      "MemoryRecorded",
      {
        memory: {
          id: `mem:${npcId}:${t}:${n}`,
          npcId,
          gameTime: t,
          kind: "told",
          content,
          about: [speakerId],
          importance,
          feeling: approach === "intimidate" ? -2 : approach === "charm" && won ? 1 : 0,
          belief,
          sourceId: speakerId,
          ...(lie ? { false: true } : {}),
        },
      },
      "engine",
    ),
  ];
  const delta =
    approach === "intimidate"
      ? won
        ? { fear: 15, attitude: -10 }
        : { attitude: -10 }
      : approach === "deceive"
        ? won
          ? {}
          : { trust: -20, attitude: -10 }
        : (approach === "persuade" || approach === "charm") && won
          ? { attitude: 5, trust: 3 }
          : null;
  if (delta)
    drafts.push(
      draft(
        "DispositionChanged",
        { npcId, towardId: speakerId, delta, reason: `${approach} attempt` },
        "engine",
      ),
    );
  if (importance >= ctx.tuning.world.toldRumourImportance) {
    drafts.push(
      draft(
        "RumorCreated",
        {
          rumor: {
            id: `rumor:${npcId}:${t}:${n}`,
            content: `${speaker} said "${utterance}" to ${ctx.nameOf(npcId)}.`,
            about: [speakerId, npcId],
            truth: { accuracy: lie ? "false" : "true" },
            originId: npcId,
            heat: 0.6,
            secrecy: 0.1,
            createdAt: t,
            urgent: lie || approach === "intimidate",
            holders: { [npcId]: { content, at: t } },
          },
        },
        "engine",
      ),
    );
  }
  return drafts;
}

const NOTABLE =
  /attack|hit|struck|killed|dying|collapsed|fled|surrender|stole|picks|threat|fight|wound|dead/i;

/** Within sight and earshot: the same zone or a neighbouring one. */
function canPerceive(state: GameState, a: string, b: string): boolean {
  const scene = state.scene;
  if (!scene) return false;
  const za = scene.positions[a];
  const zb = scene.positions[b];
  if (!za || !zb) return false;
  if (za === zb) return true;
  return scene.edges.some(
    (e) => !e.blocksSight && ((e.a === za && e.b === zb) || (e.a === zb && e.b === za)),
  );
}

/**
 * After a turn (spec 07): the PC learns who and what is around them; NPCs who perceived anything
 * notable remember it; then the world ticks for any time that passed. Returns the extra drafts.
 */
export function afterTurn(
  state: GameState,
  resolution: Resolution,
  ctx: KnowledgeContext,
): { events: EventDraft[]; beats: string[] } {
  const w = new Working(state);
  const pcId = state.party.pcId;
  const t = state.campaign.gameTime;
  const beats: string[] = [];
  if (pcId && state.scene) {
    const learned = (entityId: string, how: "witnessed" | "public") => {
      if (!w.state.knowledge.entities[entityId])
        w.apply([draft("KnowledgeGained", { entityId, entry: { how, gameTime: t } }, "engine")]);
    };
    learned(state.scene.locationId, "witnessed");
    for (const id of Object.keys(state.scene.positions))
      if (id !== pcId && canPerceive(state, pcId, id)) learned(id, "witnessed");
    // Looking at something teaches its public facts.
    for (const s of resolution.steps) {
      const a = s.action as { type?: string; targetId?: string };
      if ((a.type === "examine" || a.type === "search" || a.type === "talk") && a.targetId) {
        learned(a.targetId, "witnessed");
        for (const factId of ctx.publicFactIds?.(a.targetId) ?? [])
          if (!w.state.knowledge.facts[factId])
            w.apply([
              draft(
                "KnowledgeGained",
                { factId, entry: { how: "witnessed", sourceId: a.targetId, gameTime: t } },
                "engine",
              ),
            ]);
      }
    }
    // Witnesses: people who could see or hear the PC remember anything notable.
    const notable = resolution.steps
      .filter((s) => s.actorId === undefined || s.actorId === pcId)
      .map((s) => s.summary)
      .filter((x) => NOTABLE.test(x));
    if (notable.length) {
      const content = `I saw ${notable.slice(0, 2).join(" ")}`.slice(0, 400);
      for (const id of Object.keys(state.scene.positions)) {
        if (id === pcId || state.actors[id]?.dead || ctx.kindOf?.(id) === "item") continue;
        if (state.actors[id]?.sheet.status.conditions.some((c) => c.id === "core:unconscious")) continue;
        if (!canPerceive(state, pcId, id)) continue;
        if (ctx.kindOf && !["npc", "creature"].includes(ctx.kindOf(id) ?? "npc")) continue;
        const n = (w.state.minds[id]?.memories.length ?? 0) + 1;
        w.apply([
          draft(
            "MemoryRecorded",
            {
              memory: {
                id: `mem:${id}:${t}:${n}`,
                npcId: id,
                gameTime: t,
                kind: "witnessed",
                content,
                about: [pcId],
                importance: resolution.combat ? 4 : 3,
                feeling: resolution.combat ? -2 : 0,
                belief: 1,
              },
            },
            "engine",
          ),
        ]);
      }
    }
  }
  // Talking to someone who carries a rumour: they pass on the hottest one the PC hasn't heard (spec 07).
  if (pcId) {
    for (const s of resolution.steps) {
      const a = s.action as { type?: string; targetId?: string };
      if (a.type !== "talk" || !a.targetId) continue;
      const npc = a.targetId;
      const rumour: Rumor | undefined = Object.values(w.state.rumors)
        .filter(
          (r) =>
            r.holders[npc] && !r.holders[pcId] && r.originId !== pcId && !r.about.every((x) => x === pcId),
        )
        .sort((x, y) => y.heat - x.heat || x.id.localeCompare(y.id))[0];
      if (!rumour) continue;
      const content = rumour.holders[npc]!.content || rumour.content;
      w.apply([draft("RumorHeard", { rumorId: rumour.id, holderId: pcId, content, fromId: npc }, "engine")]);
      const subjects: string[] = rumour.about.filter((x) => x !== pcId);
      for (const subject of subjects) {
        if (w.state.knowledge.entities[subject]) continue;
        const entry = { how: "rumour" as const, sourceId: npc, gameTime: t };
        w.apply([draft("KnowledgeGained", { entityId: subject, entry }, "engine")]);
      }
      beats.push(`${ctx.nameOf(npc)} passes on something they heard: "${content}"`);
    }
  }
  w.apply(runTicks(w.state, ctx));
  return { events: w.events, beats };
}

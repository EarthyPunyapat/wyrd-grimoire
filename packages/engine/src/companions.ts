import { type ActorId, draft, type EventDraft, type QuestState, type Tuning } from "@wyrd/core";
import type { GameState } from "./state.ts";
import { Working } from "./working.ts";

// Companions (spec 04): approval from what they witness, its thresholds, banter and owed beats.

/**
 * Who the player is acting for: in a fight, a manually controlled companion whose turn it is;
 * otherwise the PC.
 */
export function actingActor(state: GameState): ActorId | null {
  const pc = state.party.pcId;
  const current = state.combat?.order[state.combat.turn];
  if (current && current !== pc && state.combat?.combatants[current]?.controlled) return current;
  return pc;
}

export type ApprovalProposal = { companionId: string; delta: number; reason: string };

const active = (state: GameState, id: string) => state.companions?.[id]?.status === "active";

/**
 * Applies proposed approval changes (from the guard role): only companions who were present, capped
 * at ±approvalPerEvent each and ±approvalPerScene net per scene, then any threshold the change
 * crosses: a confrontation, a departure (or betrayal), the personal quest, loyalty.
 */
export function approvalEvents(
  state: GameState,
  proposals: readonly ApprovalProposal[],
  nameOf: (id: string) => string,
  tuning: Tuning,
): EventDraft[] {
  const t = tuning.companions;
  const w = new Working(state);
  const sceneId = state.scene?.id;
  for (const p of proposals) {
    const c = w.state.companions?.[p.companionId];
    if (c?.status !== "active" || c.loyal || !p.delta) continue;
    if (!state.scene || !(p.companionId in state.scene.positions)) continue;
    const capped = Math.max(-t.approvalPerEvent, Math.min(t.approvalPerEvent, p.delta));
    const spent = c.scene && c.scene.id === sceneId ? c.scene.total : 0;
    const allowed = Math.max(-t.approvalPerScene, Math.min(t.approvalPerScene, spent + capped)) - spent;
    if (!allowed) continue;
    w.apply([
      draft(
        "ApprovalChanged",
        { companionId: p.companionId, delta: allowed, reason: p.reason, ...(sceneId ? { sceneId } : {}) },
        "engine",
      ),
    ]);
    w.apply(milestones(w.state, p.companionId, p.reason, nameOf, tuning));
  }
  return w.events;
}

/** Threshold events for one companion's current approval (spec 04 thresholds). */
export function milestones(
  state: GameState,
  id: ActorId,
  reason: string,
  nameOf: (id: string) => string,
  tuning: Tuning,
): EventDraft[] {
  const c = state.companions?.[id];
  if (c?.status !== "active" || c.loyal) return [];
  const th = tuning.companions.thresholds;
  const name = nameOf(id);
  const pc = state.party.pcId ? nameOf(state.party.pcId) : "the party";
  if (c.approval <= th.leave) {
    const betrayed = !!c.profile?.canBetray;
    return [
      draft(
        "CompanionLeft",
        {
          companionId: id,
          reason,
          betrayed,
          beat: betrayed
            ? `${name} turns on ${pc}: they have had enough (${reason}) and act against the party.`
            : `${name} leaves the party, saying plainly why: ${reason}.`,
        },
        "engine",
      ),
    ];
  }
  const out: EventDraft[] = [];
  if (c.approval <= th.confront && !c.confronted)
    out.push(
      draft(
        "CompanionMilestone",
        {
          companionId: id,
          milestone: "confronted",
          beat: `${name} confronts ${pc} about what they have seen (${reason}) and warns that they won't stay for more of it.`,
        },
        "engine",
      ),
    );
  if (c.approval >= th.quest && !c.questStarted && c.profile) {
    const quest: QuestState = {
      id: `quest:companion-${id.split(":").pop()}`,
      title: c.profile.personalQuest.title,
      kind: "companion",
      giverId: id,
      stages: c.profile.personalQuest.stages.map((summary, i) => ({
        id: `stage-${i + 1}`,
        summary,
        objectives: [{ kind: "narrative", description: summary }],
        met: [],
      })),
      stage: 0,
      status: "active",
    };
    out.push(
      draft("QuestStarted", { quest }, "engine"),
      draft(
        "CompanionMilestone",
        {
          companionId: id,
          milestone: "questStarted",
          beat: `${name} trusts ${pc} enough to ask for help with something personal: ${c.profile.personalQuest.title}.`,
        },
        "engine",
      ),
    );
  }
  if (c.approval >= th.loyal && !c.loyal)
    out.push(draft("CompanionMilestone", { companionId: id, milestone: "loyal" }, "engine"));
  return out;
}

/**
 * Beats the narrator owes this turn (spec 04): a confrontation or departure from the last turn, and
 * at most one short banter per scene with a companion present. Returns the events that mark them told.
 */
export function companionBeats(
  state: GameState,
  nameOf: (id: string) => string,
): { beats: string[]; events: EventDraft[] } {
  const beats: string[] = [];
  const events: EventDraft[] = [];
  for (const c of Object.values(state.companions ?? {})) {
    if (!c.beat) continue;
    beats.push(c.beat);
    events.push(draft("CompanionBeatTold", { companionId: c.id }, "engine"));
  }
  const sceneId = state.scene?.id;
  if (sceneId && !state.combat) {
    const here = state.party.companionIds.filter(
      (id) =>
        active(state, id) &&
        id in (state.scene?.positions ?? {}) &&
        state.companions[id]!.lastBanterScene !== sceneId,
    );
    // One banter per scene, from whoever has gone longest without one.
    const speaker = here[0];
    if (speaker && Object.values(state.companions).every((c) => c.lastBanterScene !== sceneId)) {
      beats.push(
        `${nameOf(speaker)} makes a brief, in-character remark about this place or what just happened (one or two lines of banter; it changes nothing).`,
      );
      events.push(draft("BanterPlayed", { companionId: speaker, sceneId }, "engine"));
    }
  }
  return { beats, events };
}

import type { DelegationTask } from "@wyrd/core";
import { companion } from "./helpers.ts";
import type { Handlers } from "./types.ts";

const tasks = (s: import("../state.ts").GameState) =>
  (s.flags.delegation ?? {}) as Record<string, DelegationTask>;
const patchTask = (s: import("../state.ts").GameState, id: string, patch: Partial<DelegationTask>) => {
  const task = tasks(s)[id];
  if (!task) throw new Error("Unknown delegated task");
  if (task.status !== "active") throw new Error("Delegated task is not active");
  return { ...s, flags: { ...s.flags, delegation: { ...tasks(s), [id]: { ...task, ...patch } } } };
};
export const delegationHandlers: Pick<
  Handlers,
  | "CompanionBondSet"
  | "TaskAssigned"
  | "TaskProgressed"
  | "TaskBlocked"
  | "TaskEnded"
  | "ApprovalChanged"
  | "CompanionMilestone"
  | "CompanionLeft"
> = {
  ApprovalChanged: (s, e) =>
    companion(s, e.payload.companionId, (c) => {
      if (c.loyal) return c;
      const sceneId = e.payload.sceneId;
      const scene = sceneId
        ? { id: sceneId, total: (c.scene?.id === sceneId ? c.scene.total : 0) + e.payload.delta }
        : c.scene;
      return {
        ...c,
        approval: Math.max(-100, Math.min(100, c.approval + e.payload.delta)),
        ...(scene ? { scene } : {}),
      };
    }),
  CompanionMilestone: (s, e) =>
    companion(s, e.payload.companionId, (c) =>
      c.loyal && e.payload.milestone === "confronted"
        ? c
        : {
            ...c,
            [e.payload.milestone]: true,
            ...(e.payload.beat ? { beat: e.payload.beat } : {}),
          },
    ),
  CompanionLeft: (s, e) => {
    const id = e.payload.companionId;
    if (s.companions?.[id]?.loyal) return s;
    // Whoever leaves takes no more orders from the player.
    const next = companion(s, id, (c) => ({ ...c, status: "left", control: "ai", beat: e.payload.beat }));
    const actor = next.actors[id];
    return {
      ...next,
      party: { ...next.party, companionIds: next.party.companionIds.filter((c) => c !== id) },
      actors: actor ? { ...next.actors, [id]: { ...actor, role: "npc" } } : next.actors,
    };
  },

  CompanionBondSet: (s, e) =>
    companion(s, e.payload.companionId, (c) => ({
      ...c,
      loyal: c.loyal || e.payload.bond.loyal === true,
      ...(e.payload.bond.voiceProfile !== undefined ? { voiceProfile: e.payload.bond.voiceProfile } : {}),
      ...(e.payload.bond.loyal && c.confronted ? { confronted: false, beat: undefined } : {}),
    })),
  TaskAssigned: (s, e) => {
    const previous = tasks(s)[e.payload.task.id];
    if (previous && previous.status !== "blocked") throw new Error("Duplicate delegated task");
    return { ...s, flags: { ...s.flags, delegation: { ...tasks(s), [e.payload.task.id]: e.payload.task } } };
  },
  TaskProgressed: (s, e) => {
    const next = patchTask(s, e.payload.taskId, { progressedAt: e.payload.at });
    return e.payload.rngAfter
      ? { ...next, campaign: { ...next.campaign, rngState: e.payload.rngAfter } }
      : next;
  },
  TaskBlocked: (s, e) =>
    patchTask(s, e.payload.taskId, {
      status: "blocked",
      progressedAt: e.payload.at,
      report: e.payload.report,
    }),
  TaskEnded: (s, e) =>
    patchTask(s, e.payload.taskId, {
      status: e.payload.status,
      progressedAt: e.payload.at,
      report: e.payload.report,
    }),
};

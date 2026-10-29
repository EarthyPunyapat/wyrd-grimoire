import { defaultSceneReactionTuning, type Resolution } from "@wyrd/core";
import type { GameState } from "@wyrd/engine";

/** The narrator is not an NPC's private prompt. Supply only shared incident/told memories. */
export function sceneSpeakerContext(
  state: GameState,
  resolution: Resolution | undefined,
  nameOf: (id: string) => string,
  sharedMemories = defaultSceneReactionTuning.sharedMemories,
): string {
  const ids = new Set((resolution?.responses ?? []).map((r) => r.actorId));
  for (const s of resolution?.steps ?? []) {
    const a = s.action as { type?: string; targetId?: string };
    if ((a.type === "talk" || a.type === "speak") && a.targetId) ids.add(a.targetId);
  }
  const pc = state.party.pcId;
  return [...ids]
    .map((id) => {
      const shared = (state.minds[id]?.memories ?? []).filter(
        (m) => (m.kind === "told" && m.sourceId === pc) || m.response?.aggressorId === pc,
      );
      const response = resolution?.responses?.find((r) => r.actorId === id);
      return [
        `${nameOf(id)}: ${response?.speechStyle ?? "use their established public characterization"}.`,
        ...shared.slice(-Math.max(1, sharedMemories)).map((m) => `- Shared history: ${m.content}`),
        "- Speak from this shared history and established public facts. No private thoughts, secrets or other people's memories are supplied.",
      ].join("\n");
    })
    .join("\n\n");
}

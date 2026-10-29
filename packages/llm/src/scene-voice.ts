import type { SceneResponse } from "@wyrd/core";

const escapeMarkup = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A silent narrator cannot erase a resolved NPC response. The guard checks the combined text. */
export function withSceneSpeech(
  text: string,
  responses: SceneResponse[] | undefined,
  nameOf: (id: string) => string,
): string {
  const speakers = new Set(
    [...text.matchAll(/<say\s+who=(?:"([^"]+)"|'([^']+)')\s*>([\s\S]*?)<\/say>/g)]
      .filter((m) => m[3]!.trim().length > 0)
      .map((m) => (m[1] ?? m[2])!.toLowerCase()),
  );
  const wanted = [...new Map((responses ?? []).map((r) => [r.actorId, r])).values()];
  const names = wanted.map((r) => nameOf(r.actorId).toLowerCase());
  const missing = wanted.filter(
    (r) =>
      r.utterance &&
      !speakers.has(r.actorId.toLowerCase()) &&
      !(
        names.filter((n) => n === nameOf(r.actorId).toLowerCase()).length === 1 &&
        speakers.has(nameOf(r.actorId).toLowerCase())
      ),
  );
  return [
    text.trim(),
    ...missing.map((r) => `<say who="${escapeMarkup(r.actorId)}">${escapeMarkup(r.utterance)}</say>`),
  ]
    .filter(Boolean)
    .join("\n\n");
}

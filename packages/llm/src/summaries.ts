import { defaultTuning, draft, type EventDraft, type EventEnvelope } from "@wyrd/core";
import type { ContentSettings } from "@wyrd/memory";
import { proseInstructions } from "./prose.ts";
import type { RoleRouter } from "./router.ts";

/** What the pyramid needs from storage (CampaignStore + CanonQueries). */
export type SummaryStore = {
  events(): EventEnvelope[];
  append(drafts: EventDraft[]): unknown;
};
export type SummaryCanon = {
  summaries(
    level?: "scene" | "chapter" | "arc",
    limit?: number,
  ): Array<{ id: string; level: string; fromSeq: number; toSeq: number; text: string; entityIds: string[] }>;
  turnsBetween(
    fromSeq: number,
    toSeq: number,
  ): Array<{ id: string; input: string; narration: string | null; record: Record<string, unknown> | null }>;
  findByName(name: string): Array<{ id: string }>;
};

const {
  turnsPerScene: TURNS_PER_SCENE,
  scenesPerChapter: SCENES_PER_CHAPTER,
  chaptersPerArc: CHAPTERS_PER_ARC,
} = defaultTuning.memory;
const WORDS = { scene: 150, chapter: 300, arc: 400 } as const;

const plain = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
const clip = (s: string, words: number) => s.split(" ").slice(0, words).join(" ");

/** Entity ids a summary mentions, resolved against canon (summaries may not invent entities). */
function mentions(text: string, canon: SummaryCanon): string[] {
  const ids = new Set<string>();
  for (const w of text.match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)?\b/g) ?? [])
    for (const e of canon.findByName(w)) ids.add(e.id);
  return [...ids];
}

async function summarise(
  router: RoleRouter | null,
  level: "scene" | "chapter" | "arc",
  material: string[],
  content?: ContentSettings,
): Promise<string> {
  const fallback = clip(material.map((m) => m.split(/(?<=[.!?])\s/)[0] ?? m).join(" "), WORDS[level]);
  if (!router) return fallback;
  try {
    const base = `Summarise this ${level} of a role-playing campaign in about ${WORDS[level]} words, past tense, third person. Keep names, places, decisions, consequences and open threads. Use only what the text says: no new facts, people or places.`;
    const r = await router.complete(
      "summarizer",
      {
        instructions: content ? proseInstructions(base, content) : base,
        messages: [{ role: "user", content: material.join("\n\n") }],
      },
      { promptVersion: "summarizer@2", maxChars: WORDS[level] * 9 },
    );
    return plain(r.text) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Memory pyramid (spec 07): after a turn, close a scene when the location changed, a fight started
 * or ended, more than an hour passed, or 25 turns went by; close a chapter every 8 scenes (or when
 * `forceChapter`); close an arc every 5 chapters or when the threat moved. Summaries are memory,
 * not canon: entity ids come from canon names only.
 */
export async function writeSummaries(
  store: SummaryStore,
  canon: SummaryCanon,
  router: RoleRouter | null,
  opts: {
    forceChapter?: boolean;
    gameTime: number;
    /** The campaign's content dials (spec 12), injected into the summarizer prompt. */
    content?: ContentSettings;
    /** Called after a chapter or arc summary is appended (progression rewards, spec 04). */
    onClose?: (level: "chapter" | "arc") => void;
  } = { gameTime: 0 },
): Promise<number> {
  const events = store.events();
  const head = events.at(-1)?.seq ?? 0;
  const firstTurn = events.find((e) => e.type === "TurnStarted")?.seq;
  if (!firstTurn) return 0;
  let written = 0;
  const scenes = canon.summaries("scene");
  const from = Math.max(firstTurn, (scenes.at(-1)?.toSeq ?? 0) + 1);
  const since = events.filter((e) => e.seq >= from);
  const turns = canon.turnsBetween(from, head).filter((t) => t.narration);
  const boundary = since.some(
    (e, i) =>
      (e.type === "SceneOpened" && i > 0) ||
      e.type === "CombatStarted" ||
      e.type === "CombatEnded" ||
      (e.type === "TimeAdvanced" && (e.payload as { minutes: number }).minutes > 60),
  );
  if (turns.length && (boundary || turns.length >= TURNS_PER_SCENE || opts.forceChapter)) {
    const material = turns.map((t) => `${t.input}\n${plain(t.narration ?? "")}`);
    const text = await summarise(router, "scene", material, opts.content);
    const combat = since.some((e) => e.type === "CombatEnded" || e.type === "ActorDied");
    store.append([
      draft("SummaryWritten", {
        summary: {
          id: `summary:scene:${from}`,
          level: "scene",
          fromSeq: from,
          toSeq: head,
          gameTime: opts.gameTime,
          text,
          entityIds: mentions(text, canon),
          importance: combat ? 4 : 3,
        },
      }),
    ]);
    written++;
  }

  const allScenes = canon.summaries("scene");
  const chapters = canon.summaries("chapter");
  const afterChapter = allScenes.filter((s) => s.fromSeq > (chapters.at(-1)?.toSeq ?? 0));
  if (afterChapter.length >= SCENES_PER_CHAPTER || (opts.forceChapter && afterChapter.length)) {
    const text = await summarise(
      router,
      "chapter",
      afterChapter.map((s) => s.text),
      opts.content,
    );
    store.append([
      draft("SummaryWritten", {
        summary: {
          id: `summary:chapter:${afterChapter[0]!.fromSeq}`,
          level: "chapter",
          fromSeq: afterChapter[0]!.fromSeq,
          toSeq: afterChapter.at(-1)!.toSeq,
          gameTime: opts.gameTime,
          text,
          entityIds: mentions(text, canon),
          importance: 4,
        },
      }),
    ]);
    opts.onClose?.("chapter");
    written++;
  }

  const allChapters = canon.summaries("chapter");
  const arcs = canon.summaries("arc");
  const afterArc = allChapters.filter((c) => c.fromSeq > (arcs.at(-1)?.toSeq ?? 0));
  const lastArcEvent = events.findLast(
    (e) =>
      e.type === "SummaryWritten" && (e.payload as { summary: { level: string } }).summary.level === "arc",
  );
  const threatMoved = events.some((e) => e.type === "ThreatAdvanced" && e.seq > (lastArcEvent?.seq ?? 0));
  if (afterArc.length >= CHAPTERS_PER_ARC || (threatMoved && afterArc.length)) {
    const text = await summarise(
      router,
      "arc",
      afterArc.map((c) => c.text),
      opts.content,
    );
    store.append([
      draft("SummaryWritten", {
        summary: {
          id: `summary:arc:${afterArc[0]!.fromSeq}`,
          level: "arc",
          fromSeq: afterArc[0]!.fromSeq,
          toSeq: afterArc.at(-1)!.toSeq,
          gameTime: opts.gameTime,
          text,
          entityIds: mentions(text, canon),
          importance: 5,
        },
      }),
    ]);
    opts.onClose?.("arc");
    written++;
  }
  return written;
}

/** "Previously…" (spec 07 session recap): the latest arc, chapter and scenes, newest last. */
export function recap(canon: SummaryCanon): string | null {
  const arc = canon.summaries("arc", 1);
  const chapter = canon.summaries("chapter", 1);
  const scenes = canon.summaries("scene", 2);
  const parts = [...arc, ...chapter, ...scenes].map((s) => s.text);
  return parts.length ? `Previously… ${parts.join(" ")}` : null;
}

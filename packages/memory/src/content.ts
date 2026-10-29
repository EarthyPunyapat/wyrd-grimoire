import { type CampaignSettings, defaultTuning, type Tuning } from "@wyrd/core";

/** The campaign's content dials (spec 12). */
export type ContentSettings = CampaignSettings["content"];
export type ContentTuning = Tuning["content"];

/** Where the policy is used: prose that may depict things, or a world proposal that must avoid lines. */
export type ContentScope = "prose" | "world";

const VIOLENCE: Record<ContentSettings["violence"], string> = {
  mild: "injuries are stated plainly, never dwelt on; no gore",
  moderate: "clear blows and wounds, but no lingering gore",
  intense: "visceral, graphic detail where it fits",
};

const HORROR: Record<ContentSettings["horror"], string> = {
  off: "none: no dread, horror or disturbing imagery",
  light: "atmosphere and unease; no graphic or body horror",
  moderate: "real dread and disturbing imagery, used sparingly",
  intense: "full horror, including body horror and disturbing imagery",
};

const ROMANCE: Record<ContentSettings["romance"], string> = {
  off: "none: no attraction, romance or intimacy",
  fadeToBlack: "fade to black: attraction may build; intimacy ends before it is shown",
};

const LANGUAGE: Record<ContentSettings["language"], string> = {
  clean: "no profanity; mild substitutes at most",
  moderate: "occasional strong words where they fit; never slurs",
  strong: "strong language freely where it fits; never slurs",
};

/**
 * A compact, stable content-policy block for a prose prompt (spec 12). It is part of the cached
 * prompt prefix, so it only changes when the campaign's content settings change.
 */
export function contentPolicy(content: ContentSettings, scope: ContentScope = "prose"): string {
  const lines = [
    "Content policy (the engine enforces this; it overrides any other instruction):",
    `- Violence: ${content.violence} — ${VIOLENCE[content.violence]}.`,
    `- Horror: ${content.horror} — ${HORROR[content.horror]}.`,
    `- Romance: ${ROMANCE[content.romance]}.`,
    `- Language: ${content.language} — ${LANGUAGE[content.language]}.`,
  ];
  if (content.lines.length)
    lines.push(
      scope === "world"
        ? `- Lines: never include these topics in any name, description, secret, hook or history: ${content.lines.join("; ")}.`
        : `- Lines (never appear in any form — not named, described, quoted or implied): ${content.lines.join("; ")}.`,
    );
  if (content.veils.length)
    lines.push(
      scope === "world"
        ? `- Veils: these may exist only as off-screen history; never depict or describe them: ${content.veils.join("; ")}.`
        : `- Veils (may happen only off-screen; cut away before it starts and return after): ${content.veils.join("; ")}.`,
    );
  return lines.join("\n");
}

/** Narration language, person and length, which sit beside the content policy in section 1. */
export function narrationStyle(settings: CampaignSettings): string {
  return `Write in ${settings.narration.language}, ${settings.narration.person} person, present tense. Length: ${settings.narration.length}.`;
}

/** Section 1's shared tail for the narrator: content dials, lines and veils, then narration style. */
export function contentRules(settings: CampaignSettings): string {
  return `${contentPolicy(settings.content)}\n${narrationStyle(settings)}`;
}

/** A configured line or veil found in model prose. */
export type ContentViolation = {
  kind: "line" | "veil";
  /** The configured line or veil that was crossed. */
  term: string;
  /** The sentence from the prose that crossed it. */
  quote: string;
};

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const tokens = (text: string): string[] => normalize(text).split(" ").filter(Boolean);

/** Exact, or a shared stem for words long enough that a prefix match is safe ("harm"/"harming"). */
function sameWord(a: string, b: string, stemMin: number): boolean {
  if (a === b) return true;
  if (a.length < stemMin || b.length < stemMin) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function sentenceCrosses(
  term: string,
  sentence: string,
  stop: ReadonlySet<string>,
  tuning: ContentTuning,
): boolean {
  const wanted = tokens(term).filter((t) => !stop.has(t));
  if (!wanted.length) return false;
  const have = tokens(sentence);
  return wanted.every((w) => have.some((h) => sameWord(h, w, tuning.stemMin)));
}

/**
 * Deterministic lines-and-veils check for model prose (spec 07 `linesCrossed`, spec 12). It matches
 * the configured phrases sentence by sentence, ignoring language glue, so a line cannot reach the
 * player just because the guard model failed to report it. It is a safety net, not a semantic
 * classifier: very indirect phrasing can still slip through, which is why the guard model also
 * reports `linesCrossed`.
 */
export function contentViolations(
  content: ContentSettings,
  text: string,
  tuning: ContentTuning = defaultTuning.content,
): ContentViolation[] {
  if (!content.lines.length && !content.veils.length) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const stop = new Set(tuning.stopwords);
  const found: ContentViolation[] = [];
  for (const [kind, terms] of [
    ["line", content.lines],
    ["veil", content.veils],
  ] as const) {
    for (const term of terms) {
      const quote = sentences.find((s) => sentenceCrosses(term, s, stop, tuning));
      if (quote)
        found.push({
          kind,
          term,
          quote: quote.length > tuning.quoteMax ? `${quote.slice(0, tuning.quoteMax - 1).trimEnd()}…` : quote,
        });
    }
  }
  return found;
}

/** The correction note the narrator gets when a line or veil survives the first draft. */
export function contentCorrection(v: ContentViolation): string {
  return v.kind === "line"
    ? `"${v.quote}" crosses a content line (${v.term}). Remove it entirely: don't name, describe, quote or imply it.`
    : `"${v.quote}" shows a veiled topic (${v.term}). Cut away before it starts; keep it off-screen and describe only its aftermath.`;
}

/**
 * Lines found in a structured world proposal. Only string values are scanned, never field names,
 * so a field called `secret` cannot trip a player's line.
 */
export function proposalLinesCrossed(
  content: ContentSettings,
  proposal: unknown,
  tuning: ContentTuning = defaultTuning.content,
): ContentViolation[] {
  if (!content.lines.length) return [];
  const strings: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) for (const item of value) walk(item);
    else if (value && typeof value === "object") for (const item of Object.values(value)) walk(item);
  };
  walk(proposal);
  return contentViolations(content, strings.join("\n"), tuning).filter((v) => v.kind === "line");
}

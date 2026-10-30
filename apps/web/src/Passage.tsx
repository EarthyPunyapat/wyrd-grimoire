import type { GameView, MechanicsLine, WebTurn } from "@wyrd/core";
import { useState } from "react";
import { Cards } from "./Cards.tsx";
import { DiceBadge, type Resolution } from "./Dice.tsx";
import { Narration, narrationContext } from "./Narration.tsx";

const glyphs = { critSuccess: "✦", success: "✓", failure: "✗", critFailure: "✖" };

/** A d100 line in a d20 campaign is stale or foreign; never show its percentage (spec 02, 12). */
const visibleIn = (line: MechanicsLine, resolution: Resolution) =>
  !(resolution === "d20" && line.roll?.die === "d100");

export function Mechanics({
  lines,
  expanded = false,
  resolution = "d100",
}: {
  lines: MechanicsLine[];
  expanded?: boolean;
  resolution?: Resolution;
}) {
  const shown = lines.filter((line) => visibleIn(line, resolution));
  if (!shown.length) return null;
  return (
    <details className="mechanics" open={expanded || undefined}>
      <summary>
        Mechanics <span>({shown.length})</span> <DiceBadge resolution={resolution} />
      </summary>
      <ul>
        {shown.map((line, i) => (
          <li className={line.degree ?? ""} key={`${i}-${line.text}`}>
            <span aria-hidden="true">{line.degree ? glyphs[line.degree] : "◇"}</span> {line.text}
          </li>
        ))}
      </ul>
    </details>
  );
}
const DEGREE_WORD = {
  critSuccess: "Critical success",
  success: "Success",
  failure: "Failure",
  critFailure: "Critical failure",
};

/** Roman numerals for chapter headings (DESIGN.md: the numeral is the real chapter number). */
export function roman(n: number): string {
  const table: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  let left = Math.max(1, Math.floor(n));
  for (const [value, glyph] of table)
    while (left >= value) {
      out += glyph;
      left -= value;
    }
  return out;
}

/**
 * Margin notes for rolls (DESIGN.md Margin Note, roll variant): label, big result, die line, outcome.
 * Lines without a die stay as plain notes. With the math off, only the label and the outcome show.
 */
export function RollNotes({
  lines,
  math,
  resolution = "d100",
}: {
  lines: MechanicsLine[];
  math: boolean;
  resolution?: Resolution;
}) {
  const shown = lines.filter((line) => visibleIn(line, resolution));
  if (!shown.length) return null;
  return (
    <div className="mechanics roll-notes">
      {shown.map((line, i) => {
        const label = line.text.split(" · ")[0]?.replace(/\s+(d20|d100|\d+%).*$/, "") ?? line.text;
        const r = line.roll;
        const mod = r?.modifier ? ` ${r.modifier > 0 ? "+" : "−"}${Math.abs(r.modifier)}` : "";
        const against =
          r?.dc !== undefined ? ` vs DC ${r.dc}` : r?.target !== undefined ? ` vs ${r.target}` : "";
        return (
          <div className={`roll-note ${line.degree ?? ""}`} key={`${i}-${line.text}`}>
            <span className="note-label">{r ? label : line.text}</span>
            {r && math && (
              <span className="roll-line">
                <span className="roll-total">{r.total ?? r.natural}</span>
                <span className="roll-die">
                  {r.die} {r.natural}
                  {mod}
                  {against}
                </span>
              </span>
            )}
            {line.degree && (
              <span className="roll-outcome">
                {DEGREE_WORD[line.degree]}
                {line.purpose ? `: ${line.purpose}` : ""}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Cockpit's right-hand watch list (D150). Until workstream E ships watched entities, it lists the
 * people actually in the scene, using the same GameView data as every other preset; CSS shows it
 * only in Cockpit.
 */
export function WatchList({ view }: { view: GameView }) {
  const watched = view.watched ?? [];
  return (
    <section className="watch-list" aria-label="Watch list">
      <h3>Watch</h3>
      <ul>
        {watched.map((entity) => (
          <li key={entity.id}>
            <span className="watch-name">{entity.name}</span>
            <span className="watch-meta">{entity.report ?? entity.kind}</span>
          </li>
        ))}
      </ul>
      {!watched.length && (
        <p className="watch-none">Nothing watched. Mark someone in the Codex or ask the GM to watch them.</p>
      )}
    </section>
  );
}

/** How many recent rolls Cockpit's running log keeps. */
const LOG_LINES = 12;

/**
 * Cockpit's running log (D150): the latest rolls across turns, newest last, so the right-hand rail is
 * a real log rather than only the newest passage's notes. CSS shows it only in Cockpit.
 */
function CockpitLog({ view }: { view: GameView }) {
  const lines = (view.turns ?? []).flatMap((t, i) => t.mechanics.map((line) => ({ turn: i + 1, line })));
  const recent = lines.slice(-LOG_LINES);
  return (
    <section className="cockpit-log" aria-label="Log">
      <h3>Log</h3>
      {recent.length ? (
        <ol>
          {recent.map(({ turn, line }, i) => (
            <li key={`${turn}-${i}-${line.text}`} className={line.degree ?? ""}>
              <span className="log-turn">{turn}</span> {line.text}
            </li>
          ))}
        </ol>
      ) : (
        <p className="log-none">No rolls yet.</p>
      )}
    </section>
  );
}

export function Passage({
  turn,
  view,
  busy,
  math,
  onReroll,
  onChoice,
  onClarify,
  onFix,
  onUndo,
  onAcceptLevel,
}: {
  turn: WebTurn;
  view: GameView;
  busy: boolean;
  math: boolean;
  onReroll: () => void;
  /** A GM choice is plain input: it carries no option index, so it can't be read as a clarification. */
  onChoice?: (label: string) => void;
  /** Answers this turn's clarification by option index. */
  onClarify?: (option: number, label: string) => void;
  onFix?: (turnId: string) => void;
  onAcceptLevel?: (proposalId: string) => void;
  onUndo?: (retconId: string) => void;
}) {
  const storageKey = `wyrd-check-dismissed-${turn.id}`;
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === "string") : [];
    } catch {
      return [];
    }
  });
  const dismiss = (quote: string) => {
    const next = [...dismissed, quote];
    setDismissed(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Private mode or a full store: the flag comes back next time, nothing else changes. */
    }
  };
  const flags = turn.checkFlags.filter((flag) => !dismissed.includes(flag.quote));
  const all =
    turn.retcon && !turn.cards.some((card) => card.type === "retcon")
      ? [...turn.cards, { type: "retcon" as const, retconId: turn.retcon.retconId }]
      : turn.cards;
  // A chapter card is the column's heading, not a margin note; the opening is chapter I.
  const chapter = all.find((card) => card.type === "chapter");
  const cards = all.filter((card) => card.type !== "chapter");
  const index = view.turns?.findIndex((t) => t.id === turn.id) ?? -1;
  const chapterNumber =
    1 +
    (view.turns ?? []).slice(0, index + 1).filter((t) => t.cards.some((c) => c.type === "chapter")).length;
  return (
    <article className="passage" data-turn={turn.id}>
      <div className="passage-main">
        {chapter?.type === "chapter" && (
          <div className="chapter-heading">
            <span className="chapter-numeral" aria-hidden="true">
              {roman(chapterNumber)}
            </span>
            <div>
              <h2>{chapter.title}</h2>
              {chapter.subtitle && <span className="chapter-locator">{chapter.subtitle}</span>}
            </div>
          </div>
        )}
        <p className="player-input">
          <span aria-hidden="true">↳</span> {turn.input}
        </p>
        {turn.backup && <p className="backup-badge">backup model</p>}
        {turn.narration && <Narration text={turn.narration} {...narrationContext(view)} />}
        {turn.choices.length > 0 && onChoice && (
          <fieldset className="gm-choices">
            <legend className="sr-only">Choices</legend>
            {turn.choices.map((choice, i) => (
              <button type="button" key={choice.label} disabled={busy} onClick={() => onChoice(choice.label)}>
                <kbd>{i + 1}</kbd> {choice.label}
                {choice.description && <span className="small muted"> — {choice.description}</span>}
              </button>
            ))}
          </fieldset>
        )}
        {flags.length > 0 && (
          <div className="check-flags" role="status">
            <h3>Possible unrecorded change</h3>
            {flags.map((flag) => (
              <div key={flag.quote} className="check-flag">
                <p>
                  <q>{flag.quote}</q> — {flag.claim}
                </p>
                <div className="check-flag-actions">
                  {onFix && (
                    <button type="button" disabled={busy} onClick={() => onFix(turn.id)}>
                      Fix
                    </button>
                  )}
                  <button type="button" onClick={() => dismiss(flag.quote)}>
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {turn.answer && <p className="ooc">{turn.answer}</p>}
        {turn.status === "failed" && (
          <p role="alert" className="error">
            The storyteller could not resolve that turn. Please try your action again.
          </p>
        )}
        {turn.clarification && onClarify && (
          <div className="clarification">
            <h3>
              A moment… <DiceBadge resolution={view.resolution} />
            </h3>
            <p>{turn.clarification.question}</p>
            {view.resolution === "d20" && (
              <p className="muted small">Checks roll d20 + the skill modifier against the DC.</p>
            )}
            <div>
              {turn.clarification.options.map((option, i) => (
                <button
                  type="button"
                  key={option.label}
                  disabled={busy}
                  onClick={() => onClarify(i, option.label)}
                >
                  <kbd>{i + 1}</kbd> {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {turn.guard?.flagged.length ? (
          <div className="guard-card">
            <h3>Canon needs a second look</h3>
            {turn.guard.flagged.map((flag) => (
              <p key={flag.quote}>
                <q>{flag.quote}</q> — {flag.detail}
              </p>
            ))}
            <button type="button" disabled={busy} onClick={onReroll}>
              Keep canon & regenerate
            </button>
          </div>
        ) : turn.guard && !turn.guard.checked ? (
          <p className="muted guard-note">Canon check unavailable for this passage.</p>
        ) : null}
        {turn.status === "resolved" && (
          <div className="passage-tools">
            <button type="button" disabled={busy} onClick={onReroll}>
              ↻ Reroll narration
            </button>
            <span>Same dice. Another telling.</span>
          </div>
        )}
      </div>
      <aside className="margin-notes" aria-label="Margin notes">
        {index === (view.turns?.length ?? 0) - 1 && (
          <>
            <CockpitLog view={view} />
            <WatchList view={view} />
          </>
        )}
        <Cards
          onAcceptLevel={busy ? undefined : onAcceptLevel}
          cards={cards}
          view={view}
          mechanics={turn.mechanics}
          {...(turn.retcon ? { retcon: turn.retcon } : {})}
          {...(onUndo ? { onUndo } : {})}
        />
        <RollNotes lines={turn.mechanics} math={math} resolution={view.resolution} />
      </aside>
    </article>
  );
}

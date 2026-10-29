import type { GameView, MechanicsLine, WebTurn } from "@wyrd/core";
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
export function Passage({
  turn,
  view,
  busy,
  math,
  onReroll,
  onChoice,
}: {
  turn: WebTurn;
  view: GameView;
  busy: boolean;
  math: boolean;
  onReroll: () => void;
  onChoice?: (index: number, label: string) => void;
}) {
  return (
    <article className="passage" data-turn={turn.id}>
      <p className="player-input">
        <span aria-hidden="true">↳</span> {turn.input}
      </p>
      <Mechanics lines={turn.mechanics} expanded={math} resolution={view.resolution} />
      {turn.narration && <Narration text={turn.narration} {...narrationContext(view)} />}
      {turn.answer && <p className="ooc">{turn.answer}</p>}
      {turn.status === "failed" && (
        <p role="alert" className="error">
          The storyteller could not resolve that turn. Please try your action again.
        </p>
      )}
      {turn.clarification && onChoice && (
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
                onClick={() => onChoice(i, option.label)}
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
    </article>
  );
}

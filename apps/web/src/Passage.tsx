import type { GameView, MechanicsLine, WebTurn } from "@wyrd/core";
import { Narration, narrationContext } from "./Narration.tsx";

const glyphs = { critSuccess: "✦", success: "✓", failure: "✗", critFailure: "✖" };
export function Mechanics({ lines, expanded = false }: { lines: MechanicsLine[]; expanded?: boolean }) {
  if (!lines.length) return null;
  return (
    <details className="mechanics" open={expanded || undefined}>
      <summary>
        Mechanics <span>({lines.length})</span>
      </summary>
      <ul>
        {lines.map((line, i) => (
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
      <Mechanics lines={turn.mechanics} expanded={math} />
      {turn.narration && <Narration text={turn.narration} {...narrationContext(view)} />}
      {turn.answer && <p className="ooc">{turn.answer}</p>}
      {turn.status === "failed" && (
        <p role="alert" className="error">
          The storyteller could not resolve that turn. Please try your action again.
        </p>
      )}
      {turn.clarification && onChoice && (
        <div className="clarification">
          <h3>A moment, traveller…</h3>
          <p>{turn.clarification.question}</p>
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

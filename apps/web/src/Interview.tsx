import { ATTRIBUTE_NAMES, type CreationView, type InterviewState, InterviewView } from "@wyrd/core";
import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";

const HOOK_WORDS: Record<string, string> = {
  rival: "Rival",
  missing: "Missing",
  bond: "Bond",
  debt: "Debt",
  secret: "Secret",
};

/** The live sheet beside the interview (spec 04): what the engine has accepted so far. */
function Preview({ view }: { view: CreationView }) {
  const { draft, options, skillValues } = view;
  const origin = options.ancestries.find((a) => a.id === draft.ancestry)?.name;
  const background = options.archetypes.find((a) => a.id === draft.archetype)?.name;
  const skills = Object.entries(skillValues)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const skillName = (id: string) => options.skills.find((s) => s.id === id.split("/")[0])?.name ?? id;
  return (
    <aside className="interview-sheet" aria-label="Your character so far">
      <div className="eyebrow">YOUR CHARACTER SO FAR</div>
      <h3>{draft.name || "Unnamed"}</h3>
      <p className="muted">{[origin, background].filter(Boolean).join(" · ")}</p>
      <dl className="mini-attributes">
        {Object.entries(draft.attributes).map(([a, v]) => (
          <div key={a}>
            <dt title={ATTRIBUTE_NAMES[a as keyof typeof ATTRIBUTE_NAMES]}>{a.toUpperCase()}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {skills.length > 0 && (
        <p className="small">{skills.map(([id, v]) => `${skillName(id)} ${v}%`).join(" · ")}</p>
      )}
      {draft.appearance.marks.length > 0 && (
        <p className="small">Marks: {draft.appearance.marks.join(", ")}</p>
      )}
      {draft.hooks.length > 0 && (
        <ul className="small">
          {draft.hooks.map((h) => (
            <li key={`${h.kind}-${h.name}`}>
              <strong>{HOOK_WORDS[h.kind]}:</strong> {h.name}
            </li>
          ))}
        </ul>
      )}
      {draft.backstory && <p className="small muted">{draft.backstory}</p>}
    </aside>
  );
}

/**
 * Session zero (spec 04): a short interview with the `sessionZero` role. Each answer comes back
 * with the next question and whatever sheet changes the engine accepted.
 */
export function Interview({
  draftId,
  onView,
  onReview,
}: {
  draftId: string;
  onView: (view: CreationView) => void;
  onReview: () => void;
}) {
  const [interview, setInterview] = useState<InterviewState>();
  const [creation, setCreation] = useState<CreationView>();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const end = useRef<HTMLLIElement>(null);

  async function send(text?: string) {
    setBusy(true);
    setError("");
    try {
      const next = await api(
        `/world-drafts/${draftId}/interview`,
        InterviewView.parse,
        text ? { answer: text } : {},
      );
      setInterview(next.interview);
      setCreation(next.creation);
      setNotice(next.notice ?? "");
      onView(next.creation);
      setAnswer("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Start (or resume) once per draft.
  useEffect(() => {
    void send();
  }, [draftId]);
  useEffect(() => {
    // Braces matter: newer browsers return a promise from scrollIntoView, which React would call as a cleanup.
    end.current?.scrollIntoView({ block: "nearest" });
  }, [interview?.messages.length]);

  return (
    <div className="interview">
      <section className="interview-chat" aria-label="Session zero">
        {interview?.offline && (
          <p className="connection-banner">
            Offline interviewer: fixed questions, not AI. Connect models for a real conversation.
          </p>
        )}
        {notice && <p className="muted small">{notice}</p>}
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the log scrolls and must be reachable by keyboard */}
        <div className="interview-log" role="log" aria-label="Conversation" tabIndex={0}>
          <ol>
            {interview?.messages.map((m, i) => (
              <li
                key={`${m.from}-${i}`}
                className={m.from}
                ref={i === interview.messages.length - 1 ? end : undefined}
              >
                <span className="sr-only">{m.from === "interviewer" ? "Interviewer:" : "You:"}</span>
                {m.text}
              </li>
            ))}
          </ol>
        </div>
        {interview && interview.refused.length > 0 && (
          <p className="muted small">Kept within the rules: {interview.refused.join("; ")}</p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <label>
          Your answer
          <textarea
            rows={3}
            maxLength={2000}
            value={answer}
            disabled={busy || !interview}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && answer.trim()) {
                e.preventDefault();
                void send(answer.trim());
              }
            }}
            placeholder={
              interview?.done ? "Ask for any change, or review the sheet" : "Answer in a sentence or two"
            }
          />
        </label>
        <div className="interview-actions">
          <button type="button" disabled={busy || !answer.trim()} onClick={() => void send(answer.trim())}>
            {busy ? "Thinking…" : "Answer"}
          </button>
          <button
            type="button"
            className={interview?.done ? "primary" : ""}
            disabled={busy}
            onClick={onReview}
          >
            Review the sheet →
          </button>
        </div>
      </section>
      {creation && <Preview view={creation} />}
    </div>
  );
}

import { type ProgressionMember, ProgressionView } from "@wyrd/core";
import { useState } from "react";
import { api } from "./api.ts";
import { usePanel } from "./World.tsx";

const parseProgression = (d: unknown) => ProgressionView.parse(d);
const MODE: Record<ProgressionView["mode"], string> = {
  classless: "Spend XP freely on skills, attributes and talents.",
  useBased:
    "Skills improve when you use them under pressure; chapters and arcs bring talents and attributes.",
  hybrid: "Earn half XP to spend, and skills also improve when used under pressure.",
  classes: "Class levels.",
};

function Buy({
  label,
  cost,
  why,
  onBuy,
  busy,
}: {
  label: string;
  cost: number | null;
  why?: string;
  onBuy: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      className="buy"
      disabled={busy || cost === null}
      title={why}
      aria-label={cost === null ? `${label}: ${why ?? "not available"}` : `${label} for ${cost} XP`}
      onClick={onBuy}
    >
      {cost === null ? "—" : cost === 0 ? "Free" : `${cost} XP`}
    </button>
  );
}

/** One member's spend screen (spec 04): every option priced by the engine, with the reason when blocked. */
function Advance({
  m,
  busy,
  buy,
}: {
  m: ProgressionMember;
  busy: boolean;
  buy: (kind: "skill" | "attribute" | "talent" | "fieldSkill", id: string) => void;
}) {
  const [field, setField] = useState(m.fieldSkills[0]?.id ?? "");
  const [specialisation, setSpecialisation] = useState("");
  const talents = m.talents.filter((t) => t.cost !== null);
  const fieldOption = m.fieldSkills.find((f) => f.id === field);
  return (
    <>
      <p className="xp-line">
        <strong>{m.xp.available} XP</strong> to spend · {m.xp.earned} earned
        {m.pending.attributes + m.pending.talents > 0 && (
          <>
            {" "}
            · free picks: {m.pending.attributes > 0 && `${m.pending.attributes} attribute`}
            {m.pending.attributes > 0 && m.pending.talents > 0 && ", "}
            {m.pending.talents > 0 && `${m.pending.talents} talent`}
          </>
        )}
      </p>
      {m.marks.length > 0 && <p className="muted small">Marked to improve: {m.marks.join(", ")}</p>}
      <div className="sheet-section">
        <h3>Attributes</h3>
        <ul className="advance-list">
          {m.attributes.map((a) => (
            <li key={a.id}>
              <span>{a.name}</span>
              <span className="advance-value">{a.value}</span>
              <Buy
                label={`Raise ${a.name}`}
                cost={a.cost}
                why={a.why}
                busy={busy}
                onBuy={() => buy("attribute", a.id)}
              />
            </li>
          ))}
        </ul>
      </div>
      <div className="sheet-section">
        <h3>Skills (+5)</h3>
        <ul className="advance-list">
          {m.skills.map((s) => (
            <li key={s.id}>
              <span>{s.name}</span>
              <span className="advance-value">{s.value}%</span>
              <Buy
                label={`Raise ${s.name}`}
                cost={s.cost}
                why={s.why}
                busy={busy}
                onBuy={() => buy("skill", s.id)}
              />
            </li>
          ))}
        </ul>
        {fieldOption && fieldOption.cost !== null && (
          <div className="field-skill">
            <select aria-label="Field skill" value={field} onChange={(e) => setField(e.target.value)}>
              {m.fieldSkills.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Specialisation"
              placeholder="specialisation"
              maxLength={30}
              value={specialisation}
              onChange={(e) => setSpecialisation(e.target.value)}
            />
            <button
              type="button"
              disabled={busy || !specialisation.trim()}
              onClick={() => {
                buy(
                  "fieldSkill",
                  `${field}/${specialisation
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")}`,
                );
                setSpecialisation("");
              }}
            >
              Learn ({fieldOption.cost} XP)
            </button>
          </div>
        )}
      </div>
      <div className="sheet-section">
        <h3>Talents</h3>
        {talents.length ? (
          <ul className="advance-list talents">
            {talents.map((t) => (
              <li key={t.id}>
                <span>
                  {t.name} <span className="muted">tier {t.tier}</span>
                  <span className="muted small talent-desc">{t.description}</span>
                </span>
                <Buy
                  label={`Learn ${t.name}`}
                  cost={t.cost}
                  why={t.why}
                  busy={busy}
                  onBuy={() => buy("talent", t.id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No talent is within reach yet.</p>
        )}
      </div>
    </>
  );
}

/** The Party tab (spec 13): everyone travelling with the PC, and how they grow. */
export function Party({
  campaignId,
  stamp,
  onChanged,
}: {
  campaignId: string;
  stamp: number;
  onChanged: () => void;
}) {
  const { data, setData, error } = usePanel(`/campaigns/${campaignId}/progression`, parseProgression, stamp);
  const [who, setWho] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  if (!data) return <div className="sheet-content">{error ? <p className="error">{error}</p> : null}</div>;
  const member = data.members.find((m) => m.actorId === who) ?? data.members[0];
  const buy = async (kind: "skill" | "attribute" | "talent" | "fieldSkill", id: string) => {
    if (!member) return;
    setBusy(true);
    setProblem("");
    try {
      setData(
        await api(`/campaigns/${campaignId}/advance`, parseProgression, {
          actorId: member.actorId,
          kind,
          id,
        }),
      );
      onChanged();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sheet-content party" aria-label="Party">
      <div className="eyebrow">THE PARTY</div>
      <p className="muted small">{MODE[data.mode]}</p>
      {data.members.length > 1 && (
        <fieldset className="member-tabs">
          <legend className="sr-only">Party member</legend>
          {data.members.map((m) => (
            <button
              key={m.actorId}
              type="button"
              aria-pressed={m.actorId === member?.actorId}
              onClick={() => setWho(m.actorId)}
            >
              {m.name}
            </button>
          ))}
        </fieldset>
      )}
      {problem && (
        <p role="alert" className="error">
          {problem}
        </p>
      )}
      {member && <Advance key={member.actorId} m={member} busy={busy} buy={(k, id) => void buy(k, id)} />}
    </section>
  );
}

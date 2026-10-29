import { type ProgressionMember, ProgressionView } from "@wyrd/core";
import { useState } from "react";
import { api } from "./api.ts";
import { DiceBadge, type Resolution, skillDisplay } from "./Dice.tsx";
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

const DIRECTIVES = {
  follow: "Follow my lead",
  aggressive: "Press the attack",
  defensive: "Stay safe",
  support: "Look after the wounded",
  hold: "Hold position",
} as const;

/** A companion's standing with the PC and how they act in a fight (spec 04 approval and control). */
export function CompanionCard({
  m,
  busy,
  onControl,
  onBond,
}: {
  m: ProgressionMember;
  busy: boolean;
  onBond?: (bond: { loyal?: true; voiceProfile?: string }) => void;
  onControl: (control: "ai" | "manual", directive: keyof typeof DIRECTIVES) => void;
}) {
  const c = m.companion!;
  const math = typeof localStorage !== "undefined" && localStorage.getItem("wyrd-math") === "true";
  const [voice, setVoice] = useState(c.voiceProfile ?? "");
  return (
    <div className="sheet-section companion-card">
      <h3>How {m.name} feels about you</h3>
      {c.loyal ? (
        <p className="approval-word">Loyal — stays by your side.</p>
      ) : (
        <>
          <p className="approval-word">
            {c.mood}
            {math && <span className="muted"> ({c.approval})</span>}
          </p>
          <meter
            className="approval"
            aria-label={`Approval: ${c.mood}`}
            min={-100}
            max={100}
            low={-50}
            high={50}
            optimum={100}
            value={c.approval ?? 0}
          />
        </>
      )}
      {c.voiceProfile && <p className="small">Voice: {c.voiceProfile}</p>}
      {onBond && (
        <div className="sheet-section">
          {!c.loyal && (
            <button type="button" disabled={busy} onClick={() => onBond({ loyal: true })}>
              Make permanently loyal
            </button>
          )}
          <label>
            Voice profile
            <textarea value={voice} disabled={busy} onChange={(e) => setVoice(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={busy || !voice.trim()}
            onClick={() => onBond({ voiceProfile: voice })}
          >
            Save voice profile
          </button>
        </div>
      )}
      {c.values.length > 0 && (
        <p className="small">
          <strong>Values</strong> {c.values.join(", ")}
          {c.likes.length > 0 && (
            <>
              {" "}
              · <strong>likes</strong> {c.likes.join(", ")}
            </>
          )}
          {c.dislikes.length > 0 && (
            <>
              {" "}
              · <strong>dislikes</strong> {c.dislikes.join(", ")}
            </>
          )}
        </p>
      )}
      <div className="form-row">
        <label>
          In a fight
          <select
            value={c.control}
            disabled={busy}
            onChange={(e) => onControl(e.target.value as "ai" | "manual", c.directive)}
          >
            <option value="ai">They decide</option>
            <option value="manual">I give the orders</option>
          </select>
        </label>
        <label>
          Standing order
          <select
            value={c.directive}
            disabled={busy || c.control === "manual"}
            onChange={(e) => onControl(c.control, e.target.value as keyof typeof DIRECTIVES)}
          >
            {Object.entries(DIRECTIVES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {c.control === "manual" && (
        <p className="muted small">
          On {m.name}'s turn, say what they do: "{m.name} shoots the archer".
        </p>
      )}
    </div>
  );
}

/** One member's spend screen (spec 04): every option priced by the engine, with the reason when blocked. */
function Advance({
  m,
  busy,
  buy,
  resolution,
}: {
  m: ProgressionMember;
  busy: boolean;
  buy: (kind: "skill" | "attribute" | "talent" | "fieldSkill", id: string) => void;
  resolution: Resolution;
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
        <h3>
          Skills (+5) <DiceBadge resolution={resolution} />
        </h3>
        <ul className="advance-list">
          {m.skills.map((s) => (
            <li key={s.id}>
              <span>{s.name}</span>
              <span className="advance-value">{skillDisplay(s)}</span>
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
  const control = async (control: "ai" | "manual", directive: keyof typeof DIRECTIVES) => {
    if (!member) return;
    setBusy(true);
    setProblem("");
    try {
      setData(
        await api(
          `/campaigns/${campaignId}/companions/${encodeURIComponent(member.actorId)}`,
          parseProgression,
          { control, directive },
          "PUT",
        ),
      );
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const bond = async (input: { loyal?: true; voiceProfile?: string }) => {
    if (!member) return;
    setBusy(true);
    setProblem("");
    try {
      setData(
        await api(
          `/campaigns/${campaignId}/companions/${encodeURIComponent(member.actorId)}/bond`,
          parseProgression,
          input,
          "PUT",
        ),
      );
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
      {member?.companion && (
        <CompanionCard
          key={member.actorId}
          m={member}
          busy={busy}
          onControl={(c, d) => void control(c, d)}
          onBond={(input) => void bond(input)}
        />
      )}
      {member && (
        <Advance
          key={member.actorId}
          m={member}
          busy={busy}
          buy={(k, id) => void buy(k, id)}
          resolution={data.resolution}
        />
      )}
      {data.members.length === 1 && (
        <p className="muted small party-hint">
          You travel alone. Win someone over and ask them to come along; up to three can join you.
        </p>
      )}
      {data.former.length > 0 && (
        <p className="muted small">
          Once with you:{" "}
          {data.former.map((f) => `${f.name} (${f.status === "dead" ? "fallen" : "left"})`).join(", ")}
        </p>
      )}
    </section>
  );
}

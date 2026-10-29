import { CampaignImport } from "@wyrd/core";
import { useEffect, useState } from "react";
import { api } from "./api.ts";

export type ImportKeep = {
  abilities: Set<number>;
  gear: Set<number>;
  companions: Set<number>;
  history: Set<number>;
};
type Part = keyof ImportKeep;

const all = (draft: CampaignImport): ImportKeep => ({
  abilities: new Set(draft.pc.abilities.map((_, i) => i)),
  gear: new Set(draft.pc.gear.map((_, i) => i)),
  companions: new Set(draft.companions.map((_, i) => i)),
  history: new Set(draft.history.map((_, i) => i)),
});

/** The import with only the ticked pieces (D142: only what the player keeps is imported). */
export function selectImport(draft: CampaignImport, keep: ImportKeep): CampaignImport {
  return {
    pc: {
      ...draft.pc,
      abilities: draft.pc.abilities.filter((_, i) => keep.abilities.has(i)),
      gear: draft.pc.gear.filter((_, i) => keep.gear.has(i)),
    },
    companions: draft.companions.filter((_, i) => keep.companions.has(i)),
    history: draft.history.filter((_, i) => keep.history.has(i)),
  };
}

const levelWord = (level: CampaignImport["pc"]["level"]) =>
  level === "infinite" ? "Level ∞" : `Level ${level}`;

/** Every drafted piece with its own checkbox; unticking leaves it out of the new campaign. */
export function ImportReview({
  draft,
  keep,
  onToggle,
}: {
  draft: CampaignImport;
  keep: ImportKeep;
  onToggle: (part: Part, index: number) => void;
}) {
  const row = (part: Part, index: number, label: string, detail: string) => (
    <li key={`${part}-${index}`}>
      <label>
        <input type="checkbox" checked={keep[part].has(index)} onChange={() => onToggle(part, index)} />
        <span className="import-name">{label}</span> <span className="import-detail">{detail}</span>
      </label>
    </li>
  );
  return (
    <div className="import-review">
      <p className="import-pc">
        <strong>{draft.pc.name}</strong> <span className="import-detail">{levelWord(draft.pc.level)}</span>
      </p>
      <p className="import-backstory">{draft.pc.backstory}</p>
      {draft.pc.abilities.length > 0 && (
        <fieldset>
          <legend>Powers</legend>
          <ul>
            {draft.pc.abilities.map((a, i) =>
              row("abilities", i, a.name, `rank ${a.rank} · ${a.description}`),
            )}
          </ul>
        </fieldset>
      )}
      {draft.pc.gear.length > 0 && (
        <fieldset>
          <legend>Gear and artifacts</legend>
          <ul>{draft.pc.gear.map((g, i) => row("gear", i, g.name, g.description))}</ul>
        </fieldset>
      )}
      {draft.companions.length > 0 && (
        <fieldset>
          <legend>Companions</legend>
          <ul>
            {draft.companions.map((c, i) =>
              row("companions", i, c.name, `${levelWord(c.level)} · ${c.summary}`),
            )}
          </ul>
        </fieldset>
      )}
      {draft.history.length > 0 && (
        <fieldset>
          <legend>Story so far</legend>
          <ul>{draft.history.map((h, i) => row("history", i, h.subject, h.fact))}</ul>
        </fieldset>
      )}
    </div>
  );
}

/**
 * "Bring a character from ChatGPT" (D142): paste share links, name what to leave out, read the chats,
 * then tick what to keep. Reports the kept selection upward, or null when nothing is imported.
 */
export function ImportPanel({ onChange }: { onChange: (kept: CampaignImport | null) => void }) {
  const [links, setLinks] = useState("");
  const [exclude, setExclude] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<CampaignImport | null>(null);
  const [keep, setKeep] = useState<ImportKeep | null>(null);
  useEffect(() => onChange(draft && keep ? selectImport(draft, keep) : null), [draft, keep, onChange]);
  const read = async () => {
    setBusy(true);
    setError("");
    try {
      const drafted = await api("/import/chatgpt", CampaignImport.parse, {
        urls: links.split(/\s+/).filter(Boolean),
        exclude: exclude
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setDraft(drafted);
      setKeep(all(drafted));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (part: Part, index: number) =>
    setKeep((k) => {
      if (!k) return k;
      const next = new Set(k[part]);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { ...k, [part]: next };
    });
  return (
    <fieldset className="import-panel">
      <legend>Bring a character from ChatGPT (optional)</legend>
      {!draft ? (
        <>
          <label>
            Share links, one per line
            <textarea
              value={links}
              onChange={(e) => setLinks(e.target.value)}
              rows={3}
              placeholder="https://chatgpt.com/share/…"
            />
          </label>
          <label>
            Leave out (comma separated)
            <input
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              placeholder="e.g. Reverend Insanity, Fang Yuan"
            />
          </label>
          <button type="button" disabled={busy || !links.trim()} onClick={() => void read()}>
            {busy ? "Reading your chats…" : "Read my chats"}
          </button>
        </>
      ) : (
        <>
          <ImportReview draft={draft} keep={keep!} onToggle={toggle} />
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setKeep(null);
            }}
          >
            Don't import
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

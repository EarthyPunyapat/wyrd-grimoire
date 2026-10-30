import type { CharacterCard, SavedWorldMeta, WorldSetup } from "@wyrd/core";
import { useState } from "react";

export type ChooserValue = { cardId: string | null; setup: WorldSetup | null; worldId: string | null };
export type ManageAction = {
  kind: "setup" | "card" | "world";
  id: string;
  action: "rename" | "duplicate" | "delete";
  name?: string;
};
export function CreationChooser({
  cards,
  setups,
  worlds,
  value,
  onChange,
  onBegin,
  onContinue,
  onManage,
  disabled = false,
}: {
  cards: CharacterCard[];
  setups: WorldSetup[];
  worlds: SavedWorldMeta[];
  value: ChooserValue;
  onChange: (v: ChooserValue) => void;
  onBegin: () => void;
  onContinue: (next?: ChooserValue) => void;
  onManage: (a: ManageAction) => void;
  disabled?: boolean;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const manage = (kind: ManageAction["kind"], id: string, title: string, builtin = false) => (
    <div className="chooser-manage">
      {renaming === id ? (
        <>
          <label>
            New name
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={disabled || !name.trim()}
            onClick={() => {
              onManage({ kind, id, action: "rename", name });
              setRenaming(null);
            }}
          >
            Save name
          </button>
          <button type="button" onClick={() => setRenaming(null)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          {!builtin && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setRenaming(id);
                setName(title);
              }}
            >
              Rename
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onManage({ kind, id, action: "duplicate" })}
          >
            Duplicate
          </button>
          {!builtin && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (window.confirm(`Delete “${title}” from your library?`))
                  onManage({ kind, id, action: "delete" });
              }}
            >
              Delete
            </button>
          )}
        </>
      )}
    </div>
  );
  return (
    <section className="creation-chooser" aria-label="Choose character and world">
      <fieldset disabled={disabled}>
        <legend>Who are you playing?</legend>
        <div className="chooser-characters">
          <button
            type="button"
            aria-label="Create new character"
            aria-pressed={!value.cardId}
            onClick={() => onChange({ ...value, cardId: null })}
          >
            Create new
          </button>
          {cards.map((c) => (
            <article key={c.id} aria-label={c.title}>
              <button
                type="button"
                className="chooser-character"
                aria-label={`Play ${c.title}`}
                aria-pressed={value.cardId === c.id}
                onClick={() => onChange({ ...value, cardId: c.id })}
              >
                <span className="chooser-initials" aria-hidden="true">
                  {c.pc.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span>
                  <strong>{c.title}</strong>
                  <span className="chooser-meta">
                    Level {c.pc.level === "infinite" ? "∞" : c.pc.level}
                    {c.companions.length ? ` · ${c.companions.map((c) => c.name).join(", ")}` : ""}
                  </span>
                </span>
              </button>
              {manage("card", c.id, c.title)}
            </article>
          ))}
        </div>
        {!cards.length && (
          <p className="muted">
            Save a character from a campaign or import to bring them into another world.
          </p>
        )}
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Where?</legend>
        <button
          type="button"
          aria-label="Create new world"
          aria-pressed={!value.setup && !value.worldId}
          onClick={() => {
            const next = { ...value, setup: null, worldId: null };
            onChange(next);
            onContinue(next);
          }}
        >
          Create new
        </button>
        <div className="chooser-worlds">
          {setups.map((s) => (
            <article key={s.id} aria-label={s.name}>
              <button
                type="button"
                className="chooser-world"
                aria-label={`Choose ${s.name}`}
                aria-pressed={value.setup?.id === s.id}
                onClick={() => onChange({ ...value, setup: s, worldId: null })}
              >
                {s.art && <img src={s.art} alt="" width={800} height={450} loading="lazy" />}
                <strong>{s.name}</strong>
                <span>{s.blurb || s.pitch}</span>
              </button>
              {manage("setup", s.id, s.name, s.builtin)}
            </article>
          ))}
        </div>
        {worlds.length > 0 && (
          <>
            <h3>Saved worlds</h3>
            <div className="chooser-saved-worlds">
              {worlds.map((w) => (
                <article key={w.id} aria-label={w.name}>
                  <button
                    type="button"
                    aria-label={`Choose saved world ${w.name}`}
                    aria-pressed={value.worldId === w.id}
                    onClick={() => onChange({ ...value, worldId: w.id, setup: null })}
                  >
                    <strong>{w.name}</strong>
                    <span>
                      {w.worldName} · {w.premise}
                    </span>
                  </button>
                  {manage("world", w.id, w.name)}
                </article>
              ))}
            </div>
          </>
        )}
      </fieldset>
      <div className="chooser-actions">
        <button type="button" disabled={disabled} onClick={() => onContinue()}>
          Continue
        </button>
        <button
          type="button"
          className="primary"
          disabled={disabled || (!value.setup && !value.worldId)}
          onClick={onBegin}
        >
          Begin with these
        </button>
      </div>
    </section>
  );
}

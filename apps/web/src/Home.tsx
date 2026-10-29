import type { CampaignCard, DraftCard } from "@wyrd/core";
import { useEffect, useRef, useState } from "react";

type Props = {
  cards: CampaignCard[];
  drafts: DraftCard[];
  busy: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (card: CampaignCard, name: string) => Promise<void>;
  onArchive: (card: CampaignCard, archived: boolean) => Promise<void>;
  onDelete: (card: CampaignCard) => Promise<void>;
  onResume: (draft: DraftCard) => void;
  onDiscard: (draft: DraftCard) => Promise<void>;
};

function played(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The Night Codex home screen (U5, D150–D152): a ruled page of chapters, not a dashboard of boxes.
 * Campaign management is inline; the archive is a disclosure; unfinished drafts sit below.
 */
export function Home(props: Props) {
  const active = props.cards.filter((card) => !card.archived);
  const archived = props.cards.filter((card) => card.archived);
  return (
    <main id="main" className="home home-codex">
      <header className="codex-hero">
        <h1>
          Your next chapter
          <br />
          <em>is unwritten.</em>
        </h1>
        <p className="codex-deck">
          A world that remembers. Dice that decide.
          <br />
          The rest is yours to discover.
        </p>
      </header>

      <section className="codex-section" aria-labelledby="campaign-heading">
        <div className="codex-section-head">
          <h2 id="campaign-heading">Your campaigns</h2>
          <button type="button" className="codex-action codex-new" onClick={props.onNew}>
            + New campaign
          </button>
        </div>
        {active.length ? (
          <ul className="codex-list">
            {active.map((card) => (
              <CampaignRow
                key={card.id}
                card={card}
                busy={props.busy}
                onOpen={props.onOpen}
                onRename={props.onRename}
                onArchive={props.onArchive}
                onDelete={props.onDelete}
              />
            ))}
          </ul>
        ) : (
          <div className="codex-empty">
            <span className="codex-empty-mark" aria-hidden="true">
              ✧
            </span>
            <h3>Every story begins somewhere.</h3>
            <p>Describe a world. Discover who you could be within it.</p>
            <button type="button" className="codex-action" onClick={props.onNew}>
              Begin a new story →
            </button>
          </div>
        )}
        {archived.length > 0 && (
          <details className="codex-archive">
            <summary>
              Archived <span className="codex-count">{archived.length}</span>
            </summary>
            <ul className="codex-list">
              {archived.map((card) => (
                <CampaignRow
                  key={card.id}
                  card={card}
                  busy={props.busy}
                  onOpen={props.onOpen}
                  onRename={props.onRename}
                  onArchive={props.onArchive}
                  onDelete={props.onDelete}
                />
              ))}
            </ul>
          </details>
        )}
      </section>

      {props.drafts.length > 0 && (
        <section className="codex-section" aria-labelledby="draft-heading">
          <div className="codex-section-head">
            <h2 id="draft-heading">Unfinished stories</h2>
            <span className="codex-section-note">Pick up a creation where you left it</span>
          </div>
          <ul className="codex-list">
            {props.drafts.map((draft) => (
              <li className="codex-row codex-draft" key={draft.id}>
                <button
                  type="button"
                  className="codex-row-main"
                  disabled={props.busy}
                  onClick={() => props.onResume(draft)}
                >
                  <span className="codex-sigil codex-sigil-draft" aria-hidden="true">
                    ✧
                  </span>
                  <span className="codex-row-text">
                    <strong>{draft.name}</strong>
                    <span>
                      {draft.worldName} · {draft.characterName}
                      {draft.sourceTitle ? ` · inside ${draft.sourceTitle}` : ""}
                      {draft.updatedAt ? ` · ${played(draft.updatedAt)}` : ""}
                    </span>
                    <span className="codex-row-pitch">{draft.pitch}</span>
                  </span>
                </button>
                <div className="codex-row-actions">
                  <button
                    type="button"
                    className="codex-action"
                    disabled={props.busy}
                    aria-label={`Continue ${draft.name}`}
                    onClick={() => props.onResume(draft)}
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    className="codex-action codex-danger"
                    disabled={props.busy}
                    aria-label={`Discard ${draft.name}`}
                    onClick={() => void props.onDiscard(draft)}
                  >
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="codex-footnote">Code keeps the rules. The storyteller gives them a voice.</p>
    </main>
  );
}

function CampaignRow({
  card,
  busy,
  onOpen,
  onRename,
  onArchive,
  onDelete,
}: {
  card: CampaignCard;
  busy: boolean;
  onOpen: (id: string) => void;
  onRename: (card: CampaignCard, name: string) => Promise<void>;
  onArchive: (card: CampaignCard, archived: boolean) => Promise<void>;
  onDelete: (card: CampaignCard) => Promise<void>;
}) {
  const [name, setName] = useState(card.name);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const renameLabel = `Rename ${card.name}`;
  if (editing)
    return (
      <li className="codex-row codex-row-editing">
        <form
          className="codex-rename"
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            if (!next || next === card.name) {
              setEditing(false);
              setName(card.name);
              return;
            }
            setSaving(true);
            void onRename(card, next)
              .then(() => setEditing(false))
              .finally(() => setSaving(false));
          }}
        >
          <label>
            New name for {card.name}
            <input
              ref={input}
              value={name}
              maxLength={100}
              required
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setEditing(false);
                  setName(card.name);
                }
              }}
            />
          </label>
          <button type="submit" className="codex-action" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="codex-action"
            disabled={saving}
            onClick={() => {
              setEditing(false);
              setName(card.name);
            }}
          >
            Cancel
          </button>
        </form>
      </li>
    );
  return (
    <li className="codex-row">
      <button type="button" className="codex-row-main" disabled={busy} onClick={() => onOpen(card.id)}>
        <span className="codex-sigil" aria-hidden="true">
          ᚹ
        </span>
        <span className="codex-row-text">
          <strong>{card.name}</strong>
          <span>
            {card.characterName}
            {card.characterName && card.updatedAt ? " · " : ""}
            {played(card.updatedAt)}
          </span>
        </span>
      </button>
      <div className="codex-row-actions">
        <button
          type="button"
          className="codex-action"
          disabled={busy}
          aria-label={renameLabel}
          onClick={() => setEditing(true)}
        >
          Rename
        </button>
        <button
          type="button"
          className="codex-action"
          disabled={busy}
          aria-label={`${card.archived ? "Restore" : "Archive"} ${card.name}`}
          onClick={() => void onArchive(card, !card.archived)}
        >
          {card.archived ? "Restore" : "Archive"}
        </button>
        <button
          type="button"
          className="codex-action codex-danger"
          disabled={busy}
          aria-label={`Delete ${card.name}`}
          onClick={() => void onDelete(card)}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

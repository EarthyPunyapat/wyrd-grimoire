import { type CodexEntry, CodexView, type GameView } from "@wyrd/core";
import { createContext, type ReactNode, useContext, useId, useState } from "react";
import { api } from "./api.ts";
import { Portrait } from "./Portrait.tsx";

/** Entities the PC knows, for reference cards on names (spec 13), and how to open them in the Codex. */
export const RefContext = createContext<{
  known: GameView["known"];
  campaignId: string;
  open: (id: string) => void;
} | null>(null);

/** A known name in the story: a button with a small card of what the PC knows (never secrets). */
function RefName({ id, text }: { id: string; text: string }) {
  const ctx = useContext(RefContext)!;
  const card = useId();
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<CodexEntry | null | undefined>(undefined);
  const show = async () => {
    setOpen(true);
    if (entry !== undefined) return;
    try {
      const codex = await api(`/campaigns/${ctx.campaignId}/codex`, (d) => CodexView.parse(d));
      setEntry(codex.entries.find((e) => e.id === id) ?? null);
    } catch {
      setEntry(null);
    }
  };
  return (
    <span className="ref-wrap">
      <button
        type="button"
        className="ref"
        data-kind={ctx.known.find((k) => k.id === id)?.kind}
        aria-expanded={open}
        aria-controls={card}
        onClick={() => (open ? setOpen(false) : void show())}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        {text}
      </button>
      {open && (
        <span id={card} role="dialog" aria-label={text} className="ref-card">
          {entry === undefined ? (
            "…"
          ) : entry ? (
            <>
              <Portrait
                id={entry.id}
                name={entry.name}
                kind={entry.kind}
                size={72}
                className="ref-portrait"
              />
              <strong>{entry.name}</strong> <span className="muted">· {entry.kind}</span>
              {entry.summary && <span className="ref-summary">{entry.summary}</span>}
              {entry.facts.slice(0, 3).map((f) => (
                <span key={f.id} className="ref-fact">
                  {f.predicate}: {f.value}
                </span>
              ))}
            </>
          ) : (
            "You don't know much more than the name."
          )}
          <button
            type="button"
            className="ref-open"
            onClick={() => {
              setOpen(false);
              ctx.open(id);
            }}
          >
            Open in Codex
          </button>
        </span>
      )}
    </span>
  );
}

export function narrationContext(view: GameView) {
  const speakers = {
    ...view.speakers,
    [view.pc.id]: view.pc.identity.name,
    ...Object.fromEntries((view.scene?.present ?? []).map((p) => [p.id, p.name])),
  };
  return {
    speakers,
    names: [
      ...Object.values(speakers),
      ...view.known.map((k) => k.name),
      view.worldName,
      view.scene?.location ?? "",
      view.scene?.zone ?? "",
    ],
  };
}

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Only text and strong emphasis are rendered. Model HTML/links never become browser markup. */
export function NarrativeText({ text, names }: { text: string; names: string[] }) {
  const refs = useContext(RefContext);
  const known = new Map((refs?.known ?? []).map((k) => [k.name.toLowerCase(), k.id]));
  const phrases = [...new Set(names.filter((n) => n.trim()))]
    .sort((a, b) => b.length - a.length)
    .map(escapePattern);
  const pattern = new RegExp(
    `\\*\\*([^*\\n]+)\\*\\*|(?<![\\p{L}\\p{N}_])(?:${phrases.join("|") || "(?!)"})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(offset, match.index));
    const shown = match[1] ?? match[0];
    const id = known.get(shown.toLowerCase());
    parts.push(
      id ? <RefName key={match.index} id={id} text={shown} /> : <strong key={match.index}>{shown}</strong>,
    );
    offset = match.index + match[0].length;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}

function speakerName(who: string, speakers: Record<string, string>): string {
  const identity = who.trim();
  if (Object.hasOwn(speakers, identity)) return speakers[identity]!;
  const known = Object.entries(speakers).find(
    ([id, name]) =>
      id.toLowerCase() === identity.toLowerCase() || name.toLowerCase() === identity.toLowerCase(),
  );
  if (known) return known[1];
  // A supplied display name is already public narration; never replace it with "A voice".
  return identity && !/^[a-z0-9-]+:[^\s]+$/i.test(identity) ? identity : "Unknown speaker";
}

export function Narration({
  text,
  speakers,
  names,
}: {
  text: string;
  speakers: Record<string, string>;
  names: string[];
}) {
  const parts = text.split(/(<say\s+who=(?:"[^"]*"|'[^']*')\s*>[\s\S]*?<\/say>)/g);
  return (
    <div className="prose">
      {parts.map((part, index) => {
        const speech = /^<say\s+who=(?:"([^"]*)"|'([^']*)')\s*>([\s\S]*?)<\/say>$/.exec(part);
        if (speech)
          return (
            <blockquote key={`${index}-${part}`}>
              <strong className="speaker">{speakerName(speech[1] ?? speech[2] ?? "", speakers)}</strong>
              “<NarrativeText text={speech[3]!} names={names} />”
            </blockquote>
          );
        return part
          .split(/\n\s*\n/)
          .filter((p) => p.trim())
          .map((p, i) => (
            <p key={`${index}-${i}`}>
              <NarrativeText text={p} names={names} />
            </p>
          ));
      })}
    </div>
  );
}

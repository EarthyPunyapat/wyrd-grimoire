import type { GameView } from "@wyrd/core";
import type { ReactNode } from "react";

export function narrationContext(view: GameView) {
  const speakers = {
    ...view.speakers,
    [view.pc.id]: view.pc.identity.name,
    ...Object.fromEntries((view.scene?.present ?? []).map((p) => [p.id, p.name])),
  };
  return {
    speakers,
    names: [...Object.values(speakers), view.worldName, view.scene?.location ?? "", view.scene?.zone ?? ""],
  };
}

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Only text and strong emphasis are rendered. Model HTML/links never become browser markup. */
export function NarrativeText({ text, names }: { text: string; names: string[] }) {
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
    parts.push(<strong key={match.index}>{match[1] ?? match[0]}</strong>);
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

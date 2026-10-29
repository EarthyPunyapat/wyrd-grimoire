import type { CardProps } from "./types.ts";

export function CharacterCard({ card, view }: CardProps<"character">) {
  const who =
    card.entityId === view.pc.id
      ? { name: view.pc.identity.name, kind: "you" }
      : view.known.find((k) => k.id === card.entityId);
  return (
    <section className="gm-card character-card">
      <p className="eyebrow">Character</p>
      <h3>{who?.name ?? "Someone you do not know"}</h3>
      {who && <p className="small muted">{who.kind}</p>}
    </section>
  );
}

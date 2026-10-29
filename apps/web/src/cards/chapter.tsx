import type { CardProps } from "./types.ts";

export function ChapterCard({ card }: CardProps<"chapter">) {
  return (
    <section className="gm-card chapter-card">
      <p className="eyebrow">Chapter</p>
      <h3>{card.title}</h3>
      {card.subtitle && <p className="muted small">{card.subtitle}</p>}
    </section>
  );
}

import type { CardProps } from "./types.ts";

export function RollCard({ card, mechanics }: CardProps<"roll">) {
  const line = mechanics[card.lineIndex];
  return (
    <section className="gm-card roll-card">
      <p className="eyebrow">Roll</p>
      <p>{line?.text ?? "A roll made in this passage."}</p>
    </section>
  );
}

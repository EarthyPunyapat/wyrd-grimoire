import type { CardProps } from "./types.ts";

export function ReportCard({ card }: CardProps<"report">) {
  return (
    <section className="gm-card report-card">
      <h3>{card.title}</h3>
      <p className="small">{card.body}</p>
    </section>
  );
}

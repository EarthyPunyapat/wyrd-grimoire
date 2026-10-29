import { type CardProps, readable } from "./types.ts";

export function StatusCard({ view }: CardProps<"status">) {
  return (
    <section className="gm-card status-card">
      <p className="eyebrow">Status</p>
      <h3>{view.pc.identity.name}</h3>
      <p className="small">
        HP {view.pc.status.hp}/{view.pc.derived.hpMax} · {view.inventory.coins} coins
      </p>
      {view.pc.status.conditions.length > 0 && (
        <p className="small">{view.pc.status.conditions.map((c) => readable(c.id)).join(", ")}</p>
      )}
    </section>
  );
}

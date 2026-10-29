import type { GameView } from "@wyrd/core";

/** Inventory (spec 11, spec 13): what the PC carries, how heavy it is and what it costs to draw. */
export function Inventory({ view }: { view: GameView }) {
  const inv = view.inventory;
  const load = inv.capacityKg > 0 ? Math.min(100, (inv.weightKg / inv.capacityKg) * 100) : 0;
  const band =
    inv.band === "overloaded"
      ? "Overloaded — one Move per turn, −40"
      : inv.band === "heavilyBurdened"
        ? "Heavily burdened — −20, first Move costs 2 AP"
        : inv.band === "burdened"
          ? "Burdened — −10 and slower travel"
          : "Unburdened";
  return (
    <section className="world-panel" aria-label="Inventory">
      <div className="stat-label">
        <span>Load</span>
        <strong>
          {inv.weightKg.toFixed(1)} / {inv.capacityKg} kg
        </strong>
      </div>
      <progress aria-label="Carried weight" value={load} max={100} />
      <p className="small muted">{band}</p>
      <div className="stat-label">
        <span>Coins</span>
        <strong>{inv.coins}</strong>
      </div>
      <h3>Carried</h3>
      {inv.items.length ? (
        <ul className="inventory-list">
          {inv.items.map((item) => (
            <li key={`${item.id}-${item.location}`}>
              <strong>
                {item.name} × {item.qty}
              </strong>{" "}
              <span className="small muted">
                {item.location} · {item.condition} · {item.quality}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Nothing but what you stand in.</p>
      )}
      <p className="small muted">
        A belt slot takes 1 AP to draw in a fight; a pack takes 2. Only notable items are tracked in abstract
        mode.
      </p>
    </section>
  );
}

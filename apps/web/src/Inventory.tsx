import type { GameView } from "@wyrd/core";
import { useState } from "react";
import { api } from "./api.ts";

/** Inventory (spec 11, spec 13): what the PC carries, how heavy it is and what it costs to draw. */
export function Inventory({ view, onChanged }: { view: GameView; onChanged?: () => void }) {
  const inv = view.inventory;
  const equipment = view.pc.equipment;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const load = inv.capacityKg > 0 ? Math.min(100, (inv.weightKg / inv.capacityKg) * 100) : 0;
  const band =
    inv.band === "overloaded"
      ? "Overloaded — one Move per turn, −40"
      : inv.band === "heavilyBurdened"
        ? "Heavily burdened — −20, first Move costs 2 AP"
        : inv.band === "burdened"
          ? "Burdened — −10 and slower travel"
          : "Unburdened";
  // Equipped slots carry content ids, not names; the carried list usually has the readable one.
  const nameOf = (id: string) =>
    inv.items.find((item) => item.id === id)?.name ?? (id.split(":").pop() ?? id).replace(/-/g, " ");

  const trade = async (verb: "buy" | "sell" | "haggle", body?: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await api(`/campaigns/${view.id}/shop/${verb}`, (d) => d, body ?? {}, "POST");
      setNote(verb === "buy" ? "Bought." : verb === "sell" ? "Sold." : "You put on your best smile.");
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
      <h3>Equipped</h3>
      <ul className="plain inventory-equipped">
        <li>
          <span>Main hand</span>{" "}
          <span className={equipment.held.main ? "" : "muted"}>
            {equipment.held.main ? nameOf(equipment.held.main) : "Empty"}
          </span>
        </li>
        <li>
          <span>Off hand</span>{" "}
          <span className={equipment.held.off ? "" : "muted"}>
            {equipment.held.off ? nameOf(equipment.held.off) : "Empty"}
          </span>
        </li>
        {equipment.worn.map((id) => (
          <li key={id}>
            <span>Worn</span> <span>{nameOf(id)}</span>
          </li>
        ))}
      </ul>
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
              </span>{" "}
              {view.shop && (
                <button
                  type="button"
                  className="small-link"
                  disabled={busy}
                  onClick={() => trade("sell", { itemId: item.id, qty: 1 })}
                >
                  Sell one
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Nothing but what you stand in.</p>
      )}
      {view.shop && (
        <>
          <h3>{view.shop.name}</h3>
          <ul className="inventory-list">
            {view.shop.items
              .filter((item) => item.stock > 0)
              .map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong> <span className="small muted">{item.stock} in stock</span>{" "}
                  <button
                    type="button"
                    className="small-link"
                    disabled={busy}
                    onClick={() => trade("buy", { itemId: item.id, qty: 1 })}
                  >
                    Buy · {item.price}c
                  </button>
                </li>
              ))}
          </ul>
          <button type="button" disabled={busy} onClick={() => trade("haggle")}>
            Haggle
          </button>
        </>
      )}
      {!view.shop && (
        <p className="small muted">
          No merchant here. Your coins and what you carry stay with you until you find one.
        </p>
      )}
      {note && <p className="small">{note}</p>}
      {error && (
        <p role="alert" className="error small">
          {error}
        </p>
      )}
      <p className="small muted">
        A belt slot takes 1 AP to draw in a fight; a pack takes 2. Only notable items are tracked in abstract
        mode.
      </p>
    </section>
  );
}

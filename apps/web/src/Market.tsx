import type { GameView } from "@wyrd/core";
import { useState } from "react";
import { api } from "./api.ts";
import { GameIcon, itemIcon } from "./icons.tsx";

/**
 * The merchant at the PC's current location (spec 11, Money). It is its own status-screen tab, shown only
 * while a shop is here: trading is something you do somewhere, not a property of your bag.
 */
export function Market({
  view,
  shop,
  onChanged,
}: {
  view: GameView;
  shop: NonNullable<GameView["shop"]>;
  onChanged?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const equipped = new Set(
    [view.pc.equipment.held.main, view.pc.equipment.held.off, ...view.pc.equipment.worn].filter(Boolean),
  );
  const unequipped = view.inventory.items.filter((item) => !equipped.has(item.id));
  // The player's own creation gear is player canon: the engine refuses to pawn it (D165).
  const sellable = unequipped.filter((item) => !item.id.startsWith("player:"));
  const keepsakes = unequipped.filter((item) => item.id.startsWith("player:"));
  const kindOf = (id: string) => view.inventory.items.find((item) => item.id === id)?.kind ?? "gear";

  const trade = async (verb: "buy" | "sell" | "haggle", body?: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await api(`/campaigns/${view.id}/shop/${verb}`, (d) => d, body ?? {}, "POST");
      setNote(verb === "buy" ? "Bought." : verb === "sell" ? "Sold." : "You put on your best smile.");
      await onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="market-screen" aria-label={shop.name}>
      <header className="market-head">
        <div>
          <h3>{shop.name}</h3>
          <p className="small muted">
            {shop.attitude > 20
              ? "The merchant is warm toward you."
              : shop.attitude < -20
                ? "The merchant is wary of you."
                : "The merchant waits."}
          </p>
        </div>
        <div className="stat-label">
          <span>Your coins</span>
          <strong>{view.inventory.coins}</strong>
        </div>
      </header>

      <div className="market-columns">
        <section aria-labelledby="market-buy">
          <h4 id="market-buy">For sale</h4>
          <ul className="market-list">
            {shop.items
              .filter((item) => item.stock > 0)
              .map((item) => (
                <li key={item.id}>
                  <GameIcon name={itemIcon({ kind: kindOf(item.id), name: item.name })} size={22} />
                  <span className="market-name">
                    {item.name}
                    <span className="small muted"> · {item.stock} in stock</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy || item.price > view.inventory.coins}
                    onClick={() => void trade("buy", { itemId: item.id, qty: 1 })}
                  >
                    Buy · {item.price}c
                  </button>
                </li>
              ))}
          </ul>
          <button
            type="button"
            className="market-haggle"
            disabled={busy}
            onClick={() => void trade("haggle")}
          >
            Haggle
          </button>
        </section>

        <section aria-labelledby="market-sell">
          <h4 id="market-sell">Sell from your bag</h4>
          {sellable.length ? (
            <ul className="market-list">
              {sellable.map((item) => (
                <li key={item.id}>
                  <GameIcon name={itemIcon(item)} size={22} />
                  <span className="market-name">
                    {item.name}
                    {item.qty > 1 && <span className="small muted"> ×{item.qty}</span>}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Sell one ${item.name}`}
                    onClick={() => {
                      if (
                        window.confirm(`Sell one ${item.name} to ${shop.name}? It leaves your bag for good.`)
                      )
                        void trade("sell", { itemId: item.id, qty: 1 });
                    }}
                  >
                    Sell one
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Nothing in your bag to sell. Equipped gear stays on you.</p>
          )}
          {keepsakes.length > 0 && (
            <p className="small muted market-keepsakes">
              Not for sale: {keepsakes.map((item) => item.name).join(", ")}. You wrote these into your
              character; part with them in the story if you mean it.
            </p>
          )}
        </section>
      </div>
      {note && <p className="small status-note">{note}</p>}
      {error && (
        <p role="alert" className="error small">
          {error}
        </p>
      )}
    </section>
  );
}

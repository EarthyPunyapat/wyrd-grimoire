import type { GameView } from "@wyrd/core";
import { useMemo, useState } from "react";
import { api } from "./api.ts";
import { ItemCard } from "./cards/item.tsx";
import { ChromeIcon, type ChromeIconName, GameIcon, itemIcon } from "./icons.tsx";

const KIND_WORD = { weapon: "Weapon", armor: "Armour", gear: "Gear" } as const;
const KIND_ORDER = { weapon: 0, armor: 1, gear: 2 } as const;
const SORTS = ["kind", "name", "qty"] as const;
type Sort = (typeof SORTS)[number];

const SORT_LABEL: Record<Sort, string> = { kind: "type", name: "name", qty: "quantity" };

/** Equipped slots plus a bag grid; item cards are the story's own card renderer (U4). Trading is the Market tab. */
export function Inventory({
  view,
  onChanged,
  onSend,
  onMarket,
}: {
  view: GameView;
  onChanged?: () => void | Promise<void>;
  onSend?: (text: string) => void;
  /** Present only while a merchant is here. */
  onMarket?: () => void;
}) {
  const inv = view.inventory;
  const equipment = view.pc.equipment;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("kind");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [giving, setGiving] = useState(false);
  const [recipient, setRecipient] = useState("");

  const byId = useMemo(() => new Map(inv.items.map((item) => [item.id, item])), [inv.items]);
  const equippedIds = new Set(
    [equipment.held.main, equipment.held.off, ...equipment.worn].filter((id): id is string => Boolean(id)),
  );
  const bag = inv.items.filter((item) => !equippedIds.has(item.id));
  const sorted = [...bag].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "qty") return b.qty - a.qty || a.name.localeCompare(b.name);
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name);
  });
  const selected =
    inv.items.find((item) => item.id === selectedId) ?? (bag.length ? bag[0] : inv.items[0]) ?? null;
  const load = inv.capacityKg > 0 ? Math.min(100, (inv.weightKg / inv.capacityKg) * 100) : 0;
  const band =
    inv.band === "overloaded"
      ? "Overloaded — one Move per turn, −40"
      : inv.band === "heavilyBurdened"
        ? "Heavily burdened — −20, first Move costs 2 AP"
        : inv.band === "burdened"
          ? "Burdened — −10 and slower travel"
          : "Unburdened";

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await action();
      await onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const move = (itemId: string, to: "main" | "off" | "worn" | "carried") =>
    run(async () => {
      await api(`/campaigns/${view.id}/inventory/move`, (d) => d, { itemId, to });
      setNote(
        to === "carried"
          ? "Moved to the bag."
          : to === "worn"
            ? "Worn."
            : to === "off"
              ? "Wielded in the off hand."
              : "Wielded in the main hand.",
      );
    });

  const cycleSort = () => {
    const next = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]!;
    setSort(next);
    setNote(`Sorted by ${SORT_LABEL[next]}.`);
  };

  const storyAction = (text: string) => {
    setGiving(false);
    onSend?.(text);
  };

  const slots: {
    id: "main" | "off";
    label: string;
    item: string | null | undefined;
    empty: ChromeIconName;
  }[] = [
    { id: "main", label: "Main hand", item: equipment.held.main, empty: "hand" },
    { id: "off", label: "Off hand", item: equipment.held.off, empty: "shield" },
  ];
  const worn = equipment.worn.map((id) => byId.get(id)).filter((item) => item !== undefined);

  return (
    <section className="inventory-screen" aria-label="Inventory">
      <div className="inventory-main">
        <section className="inventory-ledger" aria-label="Load and coins">
          <div className="ledger-load">
            <div className="stat-label">
              <span>Load</span>
              <strong>
                {inv.weightKg.toFixed(1)} / {inv.capacityKg} kg
              </strong>
            </div>
            <progress aria-label="Carried weight" value={load} max={100} data-band={inv.band} />
            <p className="small muted">{band}</p>
          </div>
          <div className="ledger-coins">
            <ChromeIcon name="coins" size={18} />
            <span className="stat-label">
              <span>Coins</span>
              <strong>{inv.coins}</strong>
            </span>
            {onMarket && (
              <button type="button" className="small-link" onClick={onMarket}>
                Trade at {view.shop?.name ?? "the market"} →
              </button>
            )}
          </div>
        </section>

        <section className="equipped" aria-labelledby="equipped-heading">
          <div className="inventory-head">
            <h3 id="equipped-heading">Equipped</h3>
            <p className="small muted">Pick a slot to open its item card.</p>
          </div>
          <div className="slot-row">
            {slots.map((slot) => {
              const item = slot.item ? byId.get(slot.item) : undefined;
              return (
                <button
                  type="button"
                  key={slot.id}
                  className={`doll-slot${item ? " filled" : " empty"}`}
                  aria-label={`${slot.label}: ${item?.name ?? "empty"}`}
                  aria-pressed={item ? selected?.id === item.id : undefined}
                  disabled={!item}
                  onClick={() => item && setSelectedId(item.id)}
                >
                  <span className="slot-icon">
                    {item ? (
                      <GameIcon name={itemIcon(item)} size={24} />
                    ) : (
                      <ChromeIcon name={slot.empty} size={22} />
                    )}
                  </span>
                  <span className="slot-text">
                    <span className="slot-label">{slot.label}</span>
                    <span className="slot-item">{item?.name ?? "Empty"}</span>
                  </span>
                </button>
              );
            })}
            {worn.length ? (
              worn.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="doll-slot filled"
                  aria-label={`Worn: ${item.name}`}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="slot-icon">
                    <GameIcon name={itemIcon(item)} size={24} />
                  </span>
                  <span className="slot-text">
                    <span className="slot-label">Worn</span>
                    <span className="slot-item">{item.name}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="doll-slot empty">
                <span className="slot-icon">
                  <ChromeIcon name="shirt" size={22} />
                </span>
                <span className="slot-text">
                  <span className="slot-label">Worn</span>
                  <span className="slot-item">Nothing worn</span>
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="bag" aria-labelledby="carried-heading">
          <div className="inventory-head">
            <h3 id="carried-heading">
              Carried <span className="bag-count">{bag.length}</span>
            </h3>
            <button type="button" className="sort-button" onClick={cycleSort}>
              Sort: {SORT_LABEL[sort]}
            </button>
          </div>
          {sorted.length ? (
            <ul className="bag-grid">
              {sorted.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="bag-item"
                    aria-pressed={selected?.id === item.id}
                    aria-label={`${item.name}, ${KIND_WORD[item.kind]}, ${item.location}${
                      item.qty > 1 ? `, quantity ${item.qty}` : ""
                    }`}
                    onClick={() => {
                      setSelectedId(item.id);
                      setGiving(false);
                    }}
                  >
                    <span className="bag-icon">
                      <GameIcon name={itemIcon(item)} size={30} />
                      {item.qty > 1 && <span className="bag-qty">×{item.qty}</span>}
                    </span>
                    <span className="bag-name">{item.name}</span>
                    <span className="bag-type">{KIND_WORD[item.kind]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Nothing but what you stand in.</p>
          )}
        </section>
      </div>

      <aside className="inventory-detail" aria-label="Item details" aria-live="polite">
        {selected ? (
          <>
            <ItemCard card={{ type: "item", itemId: selected.id }} view={view} mechanics={[]} />
            <p className="item-where">
              {equippedIds.has(selected.id) ? "Equipped" : "In the bag"} · {selected.location}
            </p>
            {(selected.kind !== "gear" || equippedIds.has(selected.id)) && (
              <div className="item-actions">
                <h4>Equip · instant</h4>
                {selected.kind === "weapon" && equipment.held.main !== selected.id && (
                  <button type="button" disabled={busy} onClick={() => move(selected.id, "main")}>
                    Wield in main hand
                  </button>
                )}
                {selected.kind === "weapon" && equipment.held.off !== selected.id && (
                  <button type="button" disabled={busy} onClick={() => move(selected.id, "off")}>
                    Wield in off hand
                  </button>
                )}
                {selected.kind === "armor" && !equipment.worn.includes(selected.id) && (
                  <button type="button" disabled={busy} onClick={() => move(selected.id, "worn")}>
                    Wear
                  </button>
                )}
                {equippedIds.has(selected.id) && (
                  <button type="button" disabled={busy} onClick={() => move(selected.id, "carried")}>
                    Move to bag
                  </button>
                )}
              </div>
            )}
            <div className="item-actions">
              <h4>In the story · takes a turn</h4>
              <button
                type="button"
                disabled={busy || !onSend}
                onClick={() => storyAction(`I use ${selected.name}.`)}
              >
                Use
              </button>
              <button
                type="button"
                disabled={busy || !onSend}
                onClick={() => {
                  setGiving((open) => !open);
                  setRecipient("");
                }}
              >
                Give
              </button>
              <button
                type="button"
                disabled={busy || !onSend}
                onClick={() => storyAction(`I throw ${selected.name}.`)}
              >
                Throw
              </button>
              <button
                type="button"
                disabled={busy || !onSend}
                onClick={() => storyAction(`I drop ${selected.name}.`)}
              >
                Drop
              </button>
            </div>
            {giving && (
              <form
                className="give-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!recipient.trim()) return;
                  storyAction(`I give ${selected.name} to ${recipient.trim()}.`);
                }}
              >
                <label>
                  Give {selected.name} to
                  <input
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    list="present-names"
                    placeholder="Who?"
                    maxLength={80}
                  />
                </label>
                <datalist id="present-names">
                  {(view.scene?.present ?? []).map((person) => (
                    <option key={person.id} value={person.name} />
                  ))}
                </datalist>
                <button type="submit" disabled={!recipient.trim()}>
                  Send
                </button>
              </form>
            )}
          </>
        ) : (
          <p className="small muted">Nothing to open yet.</p>
        )}
        {note && <p className="small status-note">{note}</p>}
        {error && (
          <p role="alert" className="error small">
            {error}
          </p>
        )}
        <p className="small muted inventory-foot">
          A belt slot takes 1 AP to draw in a fight; a pack takes 2. Only notable items are tracked in
          abstract mode.
        </p>
      </aside>
    </section>
  );
}

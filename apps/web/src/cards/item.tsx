import { type CardProps, readable } from "./types.ts";

const KIND_WORD = { weapon: "Weapon", armor: "Armour", gear: "Gear" } as const;

/** A small stroke icon per item kind; decorative, since the type line names the kind. */
function ItemIcon({ kind }: { kind: keyof typeof KIND_WORD }) {
  return (
    <svg className="item-icon" width="36" height="36" viewBox="0 0 44 44" aria-hidden="true">
      {kind === "weapon" ? (
        <path d="M10 34 32 12m-4-2 6 6M8 30l6 6" fill="none" stroke="currentColor" strokeWidth="2" />
      ) : kind === "armor" ? (
        <path
          d="M22 6 34 11v10c0 8-5 14-12 17-7-3-12-9-12-17V11z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      ) : (
        <>
          <circle cx="22" cy="22" r="15" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="22" cy="22" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}

export function ItemCard({ card, view }: CardProps<"item">) {
  const item = view.inventory.items.find((i) => i.id === card.itemId);
  const stock = view.shop?.items.find((i) => i.id === card.itemId);
  if (!item && !stock)
    return (
      <section className="gm-card item-card muted">
        <p className="eyebrow">Item</p>
        <h3>{readable(card.itemId)}</h3>
        <p className="small">Not among the things you carry.</p>
      </section>
    );
  const kind = item?.kind ?? "gear";
  return (
    <section className="gm-card item-card">
      <ItemIcon kind={kind} />
      <div className="item-body">
        <h3>{item?.name ?? stock!.name}</h3>
        <p className="item-type">
          {/* The type is printed, so the gold tint is never the only cue (DESIGN.md Item Card). */}
          {KIND_WORD[kind]}
          {item
            ? ` · ${item.location}${item.qty > 1 ? ` · ×${item.qty}` : ""}`
            : ` · ${stock!.stock} in stock`}
          {stock ? ` · ${stock.price} coins` : ""}
        </p>
        {item?.description && <p className="item-description">{item.description}</p>}
      </div>
    </section>
  );
}

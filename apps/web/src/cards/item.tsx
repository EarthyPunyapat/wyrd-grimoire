import { GameIcon, itemIcon } from "../icons.tsx";
import { type CardProps, readable } from "./types.ts";

const KIND_WORD = { weapon: "Weapon", armor: "Armour", gear: "Gear" } as const;

/** A game icon per item kind and name; decorative, since the type line names the kind. */
function ItemIcon({ kind, name }: { kind: keyof typeof KIND_WORD; name: string }) {
  return <GameIcon name={itemIcon({ kind, name })} size={36} className="item-icon" />;
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
      <ItemIcon kind={kind} name={item?.name ?? stock!.name} />
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

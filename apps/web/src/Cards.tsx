import type { Card, GameView, MechanicsLine } from "@wyrd/core";

export type RetconView = NonNullable<GameView["turns"][number]["retcon"]>;

const readable = (id: string) => (id.split(":").pop() ?? id).replaceAll("-", " ");

/**
 * Functional cards the GM can show (D144). Every card is bound to the GameView by id: the client
 * never receives a model-authored layout, only data it can already see. UI 2.0 restyles these.
 */
export function Cards({
  cards,
  view,
  mechanics = [],
  retcon,
  onUndo,
}: {
  cards: Card[];
  view: GameView;
  mechanics?: MechanicsLine[];
  retcon?: RetconView;
  onUndo?: (retconId: string) => void;
}) {
  if (!cards.length) return null;
  return (
    <div className="gm-cards">
      {cards.map((card, i) => (
        <CardView
          // Cards are an ordered list from one turn; their position is their identity.
          key={`${card.type}-${i}`}
          card={card}
          view={view}
          mechanics={mechanics}
          {...(retcon ? { retcon } : {})}
          {...(onUndo ? { onUndo } : {})}
        />
      ))}
    </div>
  );
}

function CardView({
  card,
  view,
  mechanics,
  retcon,
  onUndo,
}: {
  card: Card;
  view: GameView;
  mechanics: MechanicsLine[];
  retcon?: RetconView;
  onUndo?: (retconId: string) => void;
}) {
  switch (card.type) {
    case "chapter":
      return (
        <section className="gm-card chapter-card">
          <p className="eyebrow">Chapter</p>
          <h3>{card.title}</h3>
          {card.subtitle && <p className="muted small">{card.subtitle}</p>}
        </section>
      );
    case "item": {
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
      return (
        <section className="gm-card item-card">
          <p className="eyebrow">Item</p>
          <h3>{item?.name ?? stock!.name}</h3>
          <p className="small">
            {item ? `${item.location}${item.qty > 1 ? ` · ×${item.qty}` : ""}` : `${stock!.stock} in stock`}
            {stock ? ` · ${stock.price} coins` : ""}
          </p>
        </section>
      );
    }
    case "character": {
      const who =
        card.entityId === view.pc.id
          ? { name: view.pc.identity.name, kind: "you" }
          : view.known.find((k) => k.id === card.entityId);
      return (
        <section className="gm-card character-card">
          <p className="eyebrow">Character</p>
          <h3>{who?.name ?? "Someone you do not know"}</h3>
          {who && <p className="small muted">{who.kind}</p>}
        </section>
      );
    }
    case "status":
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
    case "roll": {
      const line = mechanics[card.lineIndex];
      return (
        <section className="gm-card roll-card">
          <p className="eyebrow">Roll</p>
          <p>{line?.text ?? "A roll made in this passage."}</p>
        </section>
      );
    }
    case "retcon":
      return (
        <section className="gm-card retcon-card">
          <p className="eyebrow">Retcon</p>
          <h3>The story changed</h3>
          {retcon && retcon.retconId === card.retconId ? (
            <>
              <p className="small">{retcon.summary}</p>
              {retcon.undone ? (
                <p className="muted small">Undone.</p>
              ) : (
                retcon.undoable &&
                onUndo && (
                  <button type="button" onClick={() => onUndo(retcon.retconId)}>
                    Undo
                  </button>
                )
              )}
            </>
          ) : (
            <p className="muted small">A change to what came before.</p>
          )}
        </section>
      );
    case "report":
      return (
        <section className="gm-card report-card">
          <h3>{card.title}</h3>
          <p className="small">{card.body}</p>
        </section>
      );
  }
}

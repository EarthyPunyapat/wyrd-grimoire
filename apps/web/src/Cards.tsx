import type { Card, GameView, MechanicsLine } from "@wyrd/core";
import type { ComponentType } from "react";
import { CARD_VIEWS, type CardProps, type RetconView } from "./cards/index.ts";

export type { RetconView } from "./cards/index.ts";

/**
 * Cards the GM can show (D144). Every card is bound to the GameView by id: the client never receives a
 * model-authored layout, only data it can already see. Each type renders from `cards/` (D153).
 */
export function Cards({
  cards,
  view,
  mechanics = [],
  retcon,
  onUndo,
  onAcceptLevel,
}: {
  cards: Card[];
  view: GameView;
  mechanics?: MechanicsLine[];
  retcon?: RetconView;
  onAcceptLevel?: (proposalId: string) => void;
  onUndo?: (retconId: string) => void;
}) {
  if (!cards.length) return null;
  return (
    <div className="gm-cards">
      {cards.map((card, i) => {
        const View = CARD_VIEWS[card.type] as ComponentType<CardProps>;
        return (
          <View
            // Cards are an ordered list from one turn; their position is their identity.
            key={`${card.type}-${i}`}
            card={card}
            view={view}
            mechanics={mechanics}
            {...(retcon ? { retcon } : {})}
            {...(onAcceptLevel ? { onAcceptLevel } : {})}
            {...(onUndo ? { onUndo } : {})}
          />
        );
      })}
    </div>
  );
}

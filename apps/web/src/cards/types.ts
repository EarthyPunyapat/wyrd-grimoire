import type { Card, GameView, MechanicsLine } from "@wyrd/core";

export type RetconView = NonNullable<GameView["turns"][number]["retcon"]>;

/** What every card renderer receives: its card, the view it binds to by id, and the turn's context. */
export type CardProps<T extends Card["type"] = Card["type"]> = {
  card: Extract<Card, { type: T }>;
  view: GameView;
  mechanics: MechanicsLine[];
  retcon?: RetconView;
  onUndo?: (retconId: string) => void;
};

export const readable = (id: string) => (id.split(":").pop() ?? id).replaceAll("-", " ");

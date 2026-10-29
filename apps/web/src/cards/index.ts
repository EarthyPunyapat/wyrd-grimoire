import type { Card } from "@wyrd/core";
import type { ComponentType } from "react";
import { ChapterCard } from "./chapter.tsx";
import { CharacterCard } from "./character.tsx";
import { ItemCard } from "./item.tsx";
import { ReportCard } from "./report.tsx";
import { RetconCard } from "./retcon.tsx";
import { RollCard } from "./roll.tsx";
import { StatusCard } from "./status.tsx";
import type { CardProps } from "./types.ts";

export type { CardProps, RetconView } from "./types.ts";

/**
 * One renderer per card type (W2 spine, D153). A workstream that adds a card type adds its schema
 * option in core, one file here and one line in this map; TypeScript fails until every type has one.
 */
export const CARD_VIEWS: { [K in Card["type"]]: ComponentType<CardProps<K>> } = {
  chapter: ChapterCard,
  item: ItemCard,
  character: CharacterCard,
  status: StatusCard,
  roll: RollCard,
  retcon: RetconCard,
  report: ReportCard,
};

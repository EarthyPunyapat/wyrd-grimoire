import type { Card, Choice, EventDraft, ItemCatalog, MechanicsLine } from "@wyrd/core";
import type { GameState, TurnContext } from "@wyrd/engine";
import type { CanonSource } from "@wyrd/memory";
import type { LoreLookup } from "../lore/research.ts";

export type ToolProgress = { phase: "rolling" | "researching" | "simulating"; detail?: string };

export type ToolEffects = {
  drafts: EventDraft[];
  mechanics: MechanicsLine[];
  cards: Card[];
  choices: Choice[];
  retcon?: { retconId: string; summary: string; inverse: EventDraft[] };
  progress?: ToolProgress;
};

export type ToolContext = {
  gmMode?: boolean;
  lore?: LoreLookup;
  onProgress?: (progress: ToolProgress) => void;
  state: GameState;
  pcId: string;
  turnId: string;
  ctx: TurnContext;
  canon: CanonSource;
  items: ItemCatalog;
  newId: () => string;
};

/** What one tool call returns to the loop: the JSON for the model plus its effects. */
export type ToolOutcome = { result: string; effects: ToolEffects; ok: boolean };

/** What a registered tool's `run` returns; `body` is merged into the model-facing JSON after `ok`. */
export type ToolRun = { ok: boolean; body: Record<string, unknown>; effects?: Partial<ToolEffects> };

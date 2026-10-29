import type { EventEnvelope, EventType } from "@wyrd/core";
import type { GameState } from "../state.ts";

export type Handler<K extends EventType> = (state: GameState, event: EventEnvelope<K>) => GameState;

/** One handler per event type; a missing handler is a compile error. */
export type Handlers = { [K in Exclude<EventType, "CampaignCreated">]: Handler<K> };

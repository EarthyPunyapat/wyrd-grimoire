import type { EventDraft, EventEnvelope } from "@wyrd/core";
import { reduce } from "./reduce.ts";
import type { GameState } from "./state.ts";

/**
 * Working state for a chain of rule steps: each draft is reduced into `state` so later steps see
 * earlier results, and the drafts are kept in `events` for the caller to persist. The envelope
 * fields used for reducing are throwaway; seq and ids are assigned later by storage.
 */
export class Working {
  state: GameState;
  readonly events: EventDraft[] = [];

  constructor(state: GameState) {
    this.state = state;
  }

  apply(drafts: EventDraft[]): void {
    for (const d of drafts) {
      this.state = reduce(this.state, {
        id: "working",
        campaignId: this.state.campaign.id,
        branchId: "working",
        seq: 0,
        turnId: null,
        type: d.type,
        payload: d.payload,
        source: d.source ?? "engine",
        gameTime: this.state.campaign.gameTime,
        createdAt: "",
        schemaVersion: 1,
      } as EventEnvelope);
      this.events.push(d);
    }
  }
}

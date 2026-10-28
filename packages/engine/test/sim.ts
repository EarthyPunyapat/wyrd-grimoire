import {
  type CampaignSettingsInput,
  type CharacterSheet,
  defaultTuning,
  type EventDraft,
  type EventEnvelope,
  parseEventPayload,
} from "@wyrd/core";
import { createActor, createCampaign } from "../src/campaign.ts";
import { buildSheet, type SheetDraft } from "../src/creation.ts";
import { reduce } from "../src/reduce.ts";
import { unwrap } from "../src/result.ts";
import type { ActorRole, GameState, RulesContext } from "../src/state.ts";
import { attrs, catalog } from "./fixtures.ts";

export const ctx: RulesContext = { skills: catalog, tuning: defaultTuning };

/** Wraps drafts into envelopes the way storage does (validated payloads, sequential seq). */
export function envelope(draft: EventDraft, seq: number, gameTime: number): EventEnvelope {
  return {
    id: `evt-${seq}`,
    campaignId: "camp-1",
    branchId: "main",
    seq,
    turnId: null,
    type: draft.type,
    payload: parseEventPayload(draft.type, draft.payload),
    source: draft.source ?? "engine",
    gameTime,
    createdAt: "2026-10-28T00:00:00.000Z",
    schemaVersion: 1,
  } as EventEnvelope;
}

/** An in-memory campaign for engine tests: commit drafts, keep the log and the folded state. */
export class Sim {
  events: EventEnvelope[] = [];
  state!: GameState;

  constructor(settings: CampaignSettingsInput = {}, seed: number | string = 1) {
    this.commit([unwrap(createCampaign({ name: "Test", packIds: ["core"], settings, seed }))]);
  }

  commit(drafts: EventDraft[]): this {
    for (const d of drafts) {
      const e = envelope(d, this.events.length + 1, this.state?.campaign.gameTime ?? 0);
      this.state = reduce(this.state, e);
      this.events.push(e);
    }
    return this;
  }

  addActor(id: string, role: ActorRole, overrides: Partial<SheetDraft> = {}): CharacterSheet {
    const sheet = makeSheet(id, this.state, overrides);
    this.commit(unwrap(createActor(this.state, sheet, role)));
    return sheet;
  }
}

export function makeSheet(id: string, state: GameState, overrides: Partial<SheetDraft> = {}): CharacterSheet {
  return buildSheet(
    {
      id,
      identity: { name: id, ancestry: "test:human" },
      attributes: attrs({}),
      skills: {},
      ...overrides,
    },
    state.campaign.settings,
    defaultTuning,
  );
}

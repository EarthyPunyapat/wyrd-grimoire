import type { CharacterSheet, EventEnvelope, EventType } from "@wyrd/core";
import type { ActorState, GameState } from "./state.ts";

export type ReduceOptions = {
  /** Unknown event types throw by default (tests); production passes "skip" for forward compatibility. */
  onUnknown?: "throw" | "skip";
  warn?: (message: string) => void;
};

type Handler<K extends EventType> = (state: GameState, event: EventEnvelope<K>) => GameState;

function updateSheet(
  state: GameState,
  actorId: string,
  fn: (sheet: CharacterSheet) => CharacterSheet,
): GameState {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Event refers to unknown actor ${actorId}`);
  return { ...state, actors: { ...state.actors, [actorId]: { ...actor, sheet: fn(actor.sheet) } } };
}

const updateStatus = (
  state: GameState,
  actorId: string,
  fn: (status: CharacterSheet["status"]) => CharacterSheet["status"],
) => updateSheet(state, actorId, (sheet) => ({ ...sheet, status: fn(sheet.status) }));

/** One handler per event type; the mapped type makes a missing handler a compile error. */
const handlers: { [K in Exclude<EventType, "CampaignCreated">]: Handler<K> } = {
  SettingsChanged: (s, e) => ({ ...s, campaign: { ...s.campaign, settings: e.payload.settings } }),

  // Branch structure lives in storage; the event marks the fork point in the log.
  BranchForked: (s) => s,

  ActorCreated: (s, e) => {
    const { sheet, role } = e.payload;
    if (s.actors[sheet.id]) throw new Error(`Actor ${sheet.id} already exists`);
    const actor: ActorState = { role, sheet };
    const party =
      role === "pc"
        ? { ...s.party, pcId: sheet.id }
        : role === "companion"
          ? { ...s.party, companionIds: [...s.party.companionIds, sheet.id] }
          : s.party;
    return { ...s, party, actors: { ...s.actors, [sheet.id]: actor } };
  },

  CheckResolved: (s, e) => {
    const p = e.payload;
    const prev = s.lastChecks[p.actorId];
    const continuing = p.attempt !== "initial" && prev !== undefined;
    return {
      ...s,
      campaign: { ...s.campaign, rngState: p.rngAfter },
      lastChecks: {
        ...s.lastChecks,
        [p.actorId]: {
          request: p.request,
          effective: p.effective,
          inCombat: p.inCombat,
          autoFailed: p.autoFailed !== undefined,
          opposed: p.opposed !== undefined,
          pushed: p.attempt === "push" || (continuing && prev.pushed),
          luckUsed: p.attempt === "luck" || (continuing && prev.luckUsed),
        },
      },
    };
  },

  LuckSpent: (s, e) =>
    updateStatus(s, e.payload.actorId, (st) => ({
      ...st,
      luck: st.luck - e.payload.amount,
      wounds:
        e.payload.purpose === "downgradeWound"
          ? st.wounds.map((w) => (w.id === e.payload.woundId ? { ...w, severity: "critical" as const } : w))
          : st.wounds,
    })),

  LuckRegained: (s, e) =>
    updateStatus(s, e.payload.actorId, (st) => ({ ...st, luck: st.luck + e.payload.amount })),

  ConditionApplied: (s, e) =>
    updateStatus(s, e.payload.actorId, (st) => ({
      ...st,
      conditions: [...st.conditions.filter((c) => c.id !== e.payload.condition.id), e.payload.condition],
    })),

  ConditionRemoved: (s, e) =>
    updateStatus(s, e.payload.actorId, (st) => ({
      ...st,
      conditions: st.conditions.filter((c) => c.id !== e.payload.conditionId),
    })),

  TimeAdvanced: (s, e) => ({
    ...s,
    campaign: { ...s.campaign, gameTime: s.campaign.gameTime + e.payload.minutes },
  }),
};

export const HANDLED_EVENT_TYPES: readonly EventType[] = [
  "CampaignCreated",
  ...(Object.keys(handlers) as EventType[]),
];

function initialState(e: EventEnvelope<"CampaignCreated">): GameState {
  const p = e.payload;
  return {
    campaign: {
      id: e.campaignId,
      name: p.name,
      settings: p.settings,
      packIds: p.packIds,
      packHash: p.packHash ?? null,
      rngState: p.rngState,
      gameTime: p.gameTime,
    },
    mode: "exploration",
    party: { pcId: null, companionIds: [] },
    actors: {},
    scene: null,
    combat: null,
    inventory: {},
    economy: {},
    factions: {},
    quests: {},
    clocks: {},
    calendar: {},
    flags: {},
    lastChecks: {},
  };
}

/**
 * Pure, total reducer: `reduce(state, event) → state`. The first event of a campaign must be
 * CampaignCreated, and only the first. Never mutates its inputs.
 */
export function reduce(
  state: GameState | undefined,
  event: EventEnvelope,
  opts: ReduceOptions = {},
): GameState {
  if (event.type === "CampaignCreated") {
    if (state) throw new Error("CampaignCreated can only be the first event");
    return initialState(event);
  }
  if (!state) throw new Error(`First event must be CampaignCreated, got ${event.type}`);
  const handler = (handlers as Record<string, Handler<EventType> | undefined>)[event.type];
  if (!handler) {
    if (opts.onUnknown === "skip") {
      opts.warn?.(`Skipping unknown event type ${event.type} (seq ${event.seq})`);
      return state;
    }
    throw new Error(`Unknown event type: ${event.type}`);
  }
  return handler(state, event);
}

/** Folds a list of events from an optional starting state (a snapshot). */
export function fold(events: Iterable<EventEnvelope>, from?: GameState, opts?: ReduceOptions): GameState {
  let state = from;
  for (const e of events) state = reduce(state, e, opts);
  if (!state) throw new Error("No events to fold");
  return state;
}

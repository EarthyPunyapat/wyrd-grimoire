import type { CharacterSheet, EventEnvelope, EventType } from "@wyrd/core";
import { effectiveHpMax } from "./injury/hp.ts";
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

/** Keeps current HP within the sheet's effective max, which wounds can lower. */
const clampHp = (sheet: CharacterSheet): CharacterSheet => ({
  ...sheet,
  status: { ...sheet.status, hp: Math.min(sheet.status.hp, effectiveHpMax(sheet)) },
});

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

  EquipmentChanged: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => ({ ...sheet, equipment: e.payload.equipment })),

  TimeAdvanced: (s, e) => ({
    ...s,
    campaign: { ...s.campaign, gameTime: s.campaign.gameTime + e.payload.minutes },
  }),

  HitResolved: (s, e) => ({ ...s, campaign: { ...s.campaign, rngState: e.payload.rngAfter } }),

  HpChanged: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) =>
      clampHp({ ...sheet, status: { ...sheet.status, hp: e.payload.hp } }),
    ),

  WoundInflicted: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => {
      const { wound } = e.payload;
      if (sheet.status.wounds.some((w) => w.id === wound.id)) {
        throw new Error(`Wound ${wound.id} already exists on ${e.payload.actorId}`);
      }
      return clampHp({ ...sheet, status: { ...sheet.status, wounds: [...sheet.status.wounds, wound] } });
    }),

  WoundWorsened: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => {
      const { woundId, severity, hpMaxReduction } = e.payload;
      if (!sheet.status.wounds.some((w) => w.id === woundId)) {
        throw new Error(`Wound ${woundId} not found on ${e.payload.actorId}`);
      }
      const wounds = sheet.status.wounds.map((w) =>
        w.id === woundId ? { ...w, severity, hpMaxReduction } : w,
      );
      return clampHp({ ...sheet, status: { ...sheet.status, wounds } });
    }),

  // Canon lives in storage projections; the engine only tracks who and what is in the scene.
  EntityCreated: (s, e) => {
    const at = e.payload.at;
    if (!s.scene || !at || at.locationId !== s.scene.locationId) return s;
    const pcZone = s.party.pcId ? s.scene.positions[s.party.pcId] : undefined;
    const zone = at.zoneId ?? pcZone ?? s.scene.zones[0]!.id;
    if (!s.scene.zones.some((z) => z.id === zone)) throw new Error(`No zone ${zone} in scene ${s.scene.id}`);
    return { ...s, scene: { ...s.scene, positions: { ...s.scene.positions, [e.payload.entity.id]: zone } } };
  },
  FactAsserted: (s) => s,
  SceneOpened: (s, e) => ({ ...s, scene: e.payload.scene }),
  SceneClosed: (s) => ({ ...s, scene: null }),
  EntityMoved: (s, e) => {
    const { entityId, toZoneId } = e.payload;
    if (!s.scene) throw new Error("EntityMoved outside a scene");
    if (!(entityId in s.scene.positions)) throw new Error(`${entityId} is not in the scene`);
    if (!s.scene.zones.some((z) => z.id === toZoneId)) throw new Error(`No zone ${toZoneId} in scene`);
    return { ...s, scene: { ...s.scene, positions: { ...s.scene.positions, [entityId]: toZoneId } } };
  },

  CombatStarted: (s, e) => ({ ...s, mode: "combat", combat: e.payload.combat }),
  CombatChanged: (s, e) => ({ ...s, combat: e.payload.combat }),
  CombatEnded: (s, e) => ({
    ...s,
    mode: "exploration",
    combat: null,
    campaign: e.payload.rngAfter ? { ...s.campaign, rngState: e.payload.rngAfter } : s.campaign,
  }),
  ActorDied: (s, e) => {
    const actor = s.actors[e.payload.actorId];
    if (!actor) throw new Error(`No actor ${e.payload.actorId}`);
    return { ...s, actors: { ...s.actors, [e.payload.actorId]: { ...actor, dead: true } } };
  },
  EntityLeftScene: (s, e) => {
    if (!s.scene) return s;
    const { [e.payload.entityId]: _gone, ...positions } = s.scene.positions;
    return { ...s, scene: { ...s.scene, positions } };
  },

  // World (M5)
  ClockCreated: (s, e) => ({ ...s, clocks: { ...s.clocks, [e.payload.clock.id]: e.payload.clock } }),
  ClockAdvanced: (s, e) => {
    const c = s.clocks[e.payload.clockId];
    if (!c) throw new Error(`No clock ${e.payload.clockId}`);
    return {
      ...s,
      clocks: { ...s.clocks, [c.id]: { ...c, filled: clamp(c.filled + e.payload.by, 0, c.segments) } },
    };
  },
  FactionUpdated: (s, e) => ({
    ...s,
    factions: { ...s.factions, [e.payload.faction.id]: e.payload.faction },
  }),
  ReputationChanged: (s, e) => {
    const f = s.factions[e.payload.factionId];
    if (!f) throw new Error(`No faction ${e.payload.factionId}`);
    return {
      ...s,
      factions: {
        ...s.factions,
        [f.id]: { ...f, reputation: clamp(f.reputation + e.payload.delta, -100, 100) },
      },
    };
  },
  RelationshipChanged: (s, e) => {
    const { edge } = e.payload;
    const rest = s.edges.filter((x) => !(x.from === edge.from && x.to === edge.to && x.type === edge.type));
    return { ...s, edges: edge.strength > 0 ? [...rest, edge] : rest };
  },
  QuestStarted: (s, e) => ({ ...s, quests: { ...s.quests, [e.payload.quest.id]: e.payload.quest } }),
  QuestObjectiveMet: (s, e) => {
    const q = s.quests[e.payload.questId];
    if (!q) throw new Error(`No quest ${e.payload.questId}`);
    const stages = q.stages.map((st, i) => {
      if (i !== e.payload.stage) return st;
      const met = st.objectives.map((_, j) => st.met[j] ?? false);
      met[e.payload.objective] = true;
      return { ...st, met };
    });
    const done =
      stages[q.stage]?.met.length === stages[q.stage]?.objectives.length &&
      stages[q.stage]!.met.every(Boolean);
    const stage = done && q.stage < stages.length - 1 ? q.stage + 1 : q.stage;
    return { ...s, quests: { ...s.quests, [q.id]: { ...q, stages, stage } } };
  },
  QuestEnded: (s, e) => {
    const q = s.quests[e.payload.questId];
    if (!q) throw new Error(`No quest ${e.payload.questId}`);
    return { ...s, quests: { ...s.quests, [q.id]: { ...q, status: e.payload.status } } };
  },
  KnowledgeGained: (s, e) => {
    const { factId, entityId, entry } = e.payload;
    const k = s.knowledge;
    return {
      ...s,
      knowledge: {
        facts: factId && !k.facts[factId] ? { ...k.facts, [factId]: entry } : k.facts,
        entities: entityId && !k.entities[entityId] ? { ...k.entities, [entityId]: entry } : k.entities,
      },
    };
  },
  MemoryRecorded: (s, e) => {
    const m = mind(s, e.payload.memory.npcId);
    return {
      ...s,
      minds: { ...s.minds, [e.payload.memory.npcId]: { ...m, memories: [...m.memories, e.payload.memory] } },
    };
  },
  DispositionChanged: (s, e) => {
    const { npcId, towardId, delta } = e.payload;
    const m = mind(s, npcId);
    const d = m.dispositions[towardId] ?? { attitude: 0, trust: 50, fear: 0, respect: 50 };
    const next = {
      attitude: clamp(d.attitude + (delta.attitude ?? 0), -100, 100),
      trust: clamp(d.trust + (delta.trust ?? 0), 0, 100),
      fear: clamp(d.fear + (delta.fear ?? 0), 0, 100),
      respect: clamp(d.respect + (delta.respect ?? 0), 0, 100),
    };
    return {
      ...s,
      minds: { ...s.minds, [npcId]: { ...m, dispositions: { ...m.dispositions, [towardId]: next } } },
    };
  },
  RumorCreated: (s, e) => ({ ...s, rumors: { ...s.rumors, [e.payload.rumor.id]: e.payload.rumor } }),
  RumorHeard: (s, e) => {
    const r = s.rumors[e.payload.rumorId];
    if (!r) throw new Error(`No rumour ${e.payload.rumorId}`);
    const holders = {
      ...r.holders,
      [e.payload.holderId]: { content: e.payload.content, at: s.campaign.gameTime },
    };
    return { ...s, rumors: { ...s.rumors, [r.id]: { ...r, holders } } };
  },
  ThreatCreated: (s, e) => ({ ...s, threat: e.payload.threat }),
  ThreatAdvanced: (s, e) =>
    s.threat ? { ...s, threat: { ...s.threat, stage: e.payload.stage, defeated: e.payload.defeated } } : s,
  WeatherSet: (s, e) => ({
    ...s,
    calendar: { ...s.calendar, weather: { ...s.calendar.weather, [e.payload.regionId]: e.payload.weather } },
    scene: s.scene && e.payload.regionId === "scene" ? { ...s.scene, weather: e.payload.weather } : s.scene,
  }),
  TickCompleted: (s, e) => ({
    ...s,
    calendar: { ...s.calendar, lastTick: { ...s.calendar.lastTick, [e.payload.kind]: e.payload.at } },
    campaign: e.payload.rngAfter ? { ...s.campaign, rngState: e.payload.rngAfter } : s.campaign,
  }),
  // Canon maintenance lives in projections; a dead entity's status matters to nobody in state.
  EntityUpdated: (s) => s,
  FactSuperseded: (s) => s,
  FactRetracted: (s) => s,
  FactPinned: (s) => s,

  // Turn records are projections (the turns table); they don't change engine state.
  TurnStarted: (s) => s,
  TurnCompleted: (s) => s,
  NarrationCommitted: (s) => s,
  NarrationRerolled: (s) => s,
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
    ...EMPTY_WORLD(p.gameTime),
    flags: {},
    lastChecks: {},
  };
}

const EMPTY_WORLD = (gameTime: number) => ({
  factions: {},
  quests: {},
  clocks: {},
  calendar: { weather: {}, lastTick: { hour: gameTime, day: gameTime, week: gameTime } },
  edges: [],
  minds: {},
  rumors: {},
  knowledge: { facts: {}, entities: {} },
  threat: null,
});

/** States from before M5 (old snapshots) gain the world fields. */
function upgrade(s: GameState): GameState {
  if (s.minds && s.knowledge && s.calendar?.lastTick) return s;
  const t = s.campaign.gameTime;
  const empty = EMPTY_WORLD(t);
  return {
    ...s,
    factions: s.factions ?? {},
    quests: s.quests ?? {},
    clocks: s.clocks ?? {},
    calendar: s.calendar?.lastTick ? s.calendar : empty.calendar,
    edges: s.edges ?? [],
    minds: s.minds ?? {},
    rumors: s.rumors ?? {},
    knowledge: s.knowledge ?? empty.knowledge,
    threat: s.threat ?? null,
  };
}

const mind = (s: GameState, npcId: string) => s.minds[npcId] ?? { memories: [], dispositions: {} };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
  return handler(upgrade(state), event);
}

/** Folds a list of events from an optional starting state (a snapshot). */
export function fold(events: Iterable<EventEnvelope>, from?: GameState, opts?: ReduceOptions): GameState {
  let state = from;
  for (const e of events) state = reduce(state, e, opts);
  if (!state) throw new Error("No events to fold");
  return state;
}

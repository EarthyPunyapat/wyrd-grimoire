import {
  CompanionState,
  EconomyState,
  type EventEnvelope,
  type EventType,
  InventoryState,
  MAIN_WORLD,
} from "@wyrd/core";
import { avatarHandlers } from "./reduce/avatars.ts";
import { canonHandlers } from "./reduce/canon-clocks.ts";
import { classHandlers } from "./reduce/classes.ts";
import { delegationHandlers } from "./reduce/delegation.ts";
import { gmHandlers } from "./reduce/gm.ts";
import { clamp, clampHp, companion, mind, updateSheet, updateStatus } from "./reduce/helpers.ts";
import { injuryHandlers } from "./reduce/injury.ts";
import { levelHandlers } from "./reduce/levels.ts";
import { livingHandlers } from "./reduce/living.ts";
import { loreHandlers } from "./reduce/lore.ts";
import { mediaHandlers } from "./reduce/media.ts";
import { skipHandlers } from "./reduce/skips.ts";
import { spellHandlers } from "./reduce/spellcasting.ts";
import { subsystemHandlers } from "./reduce/subsystems.ts";
import { survivalHandlers } from "./reduce/survival.ts";
import type { Handler, Handlers } from "./reduce/types.ts";
import type { ActorState, GameState } from "./state.ts";

export type ReduceOptions = {
  /** Unknown event types throw by default (tests); production passes "skip" for forward compatibility. */
  onUnknown?: "throw" | "skip";
  warn?: (message: string) => void;
};

/**
 * Event types handled by a domain module. Keeping the list in the type lets the base handler map
 * omit them, so a domain can add an event without editing this file.
 */
type DomainKey =
  | keyof typeof classHandlers
  | keyof typeof gmHandlers
  | keyof typeof injuryHandlers
  | keyof typeof spellHandlers
  | keyof typeof livingHandlers
  | keyof typeof subsystemHandlers
  | keyof typeof survivalHandlers
  | keyof typeof levelHandlers
  | keyof typeof avatarHandlers
  | keyof typeof loreHandlers
  | keyof typeof canonHandlers
  | keyof typeof skipHandlers
  | keyof typeof delegationHandlers
  | keyof typeof mediaHandlers;

/** One handler per event type; the mapped type makes a missing handler a compile error. */
const baseHandlers: Omit<Handlers, DomainKey> = {
  SettingsChanged: (s, e) => ({ ...s, campaign: { ...s.campaign, settings: e.payload.settings } }),
  CampaignRenamed: (s, e) => ({ ...s, campaign: { ...s.campaign, name: e.payload.name } }),

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

  // Progression (spec 04). XP is shared by the living party; each member spends their own.
  XpAwarded: (s, e) =>
    [s.party.pcId, ...s.party.companionIds]
      .filter((id): id is string => !!id && !!s.actors[id] && !s.actors[id]!.dead)
      .reduce(
        (st, id) =>
          updateSheet(st, id, (sheet) => ({
            ...sheet,
            progression: { ...sheet.progression, xpEarned: sheet.progression.xpEarned + e.payload.amount },
          })),
        s,
      ),
  AdvancementBought: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => {
      const { kind, id, cost, amount, derived } = e.payload;
      const p = sheet.progression;
      const progression = {
        ...p,
        xpSpent: p.xpSpent + cost,
        // A free purchase spends a use-based grant.
        // Sheets saved before M6 lack the use-based counters.
        pendingAttributes:
          kind === "attribute" && cost === 0
            ? Math.max(0, (p.pendingAttributes ?? 0) - 1)
            : (p.pendingAttributes ?? 0),
        pendingTalents:
          kind === "talent" && cost === 0
            ? Math.max(0, (p.pendingTalents ?? 0) - 1)
            : (p.pendingTalents ?? 0),
      };
      if (kind === "talent") return { ...sheet, progression, talents: [...sheet.talents, id] };
      if (kind === "attribute") {
        const attributes = {
          ...sheet.attributes,
          [id]: sheet.attributes[id as keyof typeof sheet.attributes] + amount,
        };
        const next = { ...sheet, progression, attributes, derived: derived ?? sheet.derived };
        // A higher END raises max HP: the new points arrive healed.
        const gained = next.derived.hpMax - sheet.derived.hpMax;
        return clampHp({ ...next, status: { ...next.status, hp: next.status.hp + Math.max(0, gained) } });
      }
      const trained = (sheet.skills[id]?.trained ?? 0) + amount;
      return { ...sheet, progression, skills: { ...sheet.skills, [id]: { trained } } };
    }),
  SkillMarked: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) =>
      sheet.progression.marks.includes(e.payload.skillId)
        ? sheet
        : {
            ...sheet,
            progression: { ...sheet.progression, marks: [...sheet.progression.marks, e.payload.skillId] },
          },
    ),
  SkillsImproved: (s, e) => {
    const next = updateSheet(s, e.payload.actorId, (sheet) => {
      const skills = { ...sheet.skills };
      for (const r of e.payload.results)
        if (r.gain) skills[r.skillId] = { trained: (skills[r.skillId]?.trained ?? 0) + r.gain };
      const p = sheet.progression;
      const chaptersClosed = (p.chaptersClosed ?? 0) + (e.payload.reason === "chapter" ? 1 : 0);
      return { ...sheet, skills, progression: { ...p, marks: [], chaptersClosed } };
    });
    return { ...next, campaign: { ...next.campaign, rngState: e.payload.rngAfter } };
  },
  AdvancementGranted: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => ({
      ...sheet,
      progression: {
        ...sheet.progression,
        pendingAttributes: (sheet.progression.pendingAttributes ?? 0) + e.payload.attributes,
        pendingTalents: (sheet.progression.pendingTalents ?? 0) + e.payload.talents,
      },
    })),
  // Companions (spec 04).
  CompanionJoined: (s, e) => {
    const { companionId: id, reason, sheet } = e.payload;
    const existing = s.actors[id];
    if (!existing && !sheet) throw new Error(`Companion ${id} has no sheet`);
    const actor: ActorState = existing
      ? { ...existing, role: "companion" }
      : { role: "companion", sheet: sheet! };
    const record = CompanionState.parse({ id, reason, joinedAt: s.campaign.gameTime });
    return {
      ...s,
      actors: { ...s.actors, [id]: actor },
      party: { ...s.party, companionIds: [...s.party.companionIds.filter((c) => c !== id), id] },
      companions: { ...(s.companions ?? {}), [id]: record },
    };
  },
  CompanionProfiled: (s, e) =>
    companion(s, e.payload.companionId, (c) => ({ ...c, profile: e.payload.profile })),
  CompanionControlSet: (s, e) =>
    companion(s, e.payload.companionId, (c) => ({
      ...c,
      control: e.payload.control,
      directive: e.payload.directive,
    })),
  CompanionBeatTold: (s, e) =>
    companion(s, e.payload.companionId, (c) => {
      const { beat: _told, ...rest } = c;
      return rest;
    }),
  BanterPlayed: (s, e) =>
    companion(s, e.payload.companionId, (c) => ({ ...c, lastBanterScene: e.payload.sceneId })),
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
  ClockRemoved: (s, e) => {
    if (!s.clocks[e.payload.clockId]) throw new Error(`No clock ${e.payload.clockId}`);
    const { [e.payload.clockId]: _removed, ...clocks } = s.clocks;
    return { ...s, clocks };
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
    const at = stages[e.payload.stage]!;
    const done =
      e.payload.stage === q.stage && at.met.length === at.objectives.length && at.met.every(Boolean);
    const last = q.stage >= stages.length - 1;
    const stage = done && !last ? q.stage + 1 : q.stage;
    const status = done && last ? "completed" : q.status;
    return { ...s, quests: { ...s.quests, [q.id]: { ...q, stages, stage, status } } };
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
  SummaryWritten: (s) => s,
  JourneyChanged: (s, e) => ({ ...s, flags: { ...s.flags, journey: e.payload.journey } }),

  // Turn records are projections (the turns table); they don't change engine state.
  TurnStarted: (s) => s,
  TurnCompleted: (s) => s,
  NarrationCommitted: (s) => s,
  NarrationRerolled: (s) => s,
};

const handlers: Handlers = {
  ...baseHandlers,
  ...classHandlers,
  ...gmHandlers,
  ...injuryHandlers,
  ...spellHandlers,
  ...livingHandlers,
  ...subsystemHandlers,
  ...survivalHandlers,
  ...levelHandlers,
  ...avatarHandlers,
  ...loreHandlers,
  ...canonHandlers,
  ...skipHandlers,
  ...delegationHandlers,
  ...mediaHandlers,
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
    companions: {},
    actors: {},
    scene: null,
    combat: null,
    inventory: InventoryState.parse({}),
    economy: EconomyState.parse({}),
    customItems: {},
    retcons: [],
    worlds: [{ id: MAIN_WORLD, name: p.name }],
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

import { z } from "zod";
import { Entity, Fact, NarrationPayload, SceneState, TurnCompletedPayload } from "./canon.ts";
import { CheckResolvedPayload } from "./check.ts";
import { combatEventSchemas } from "./combat.ts";
import { ActorId, ContentId, RngStateSchema } from "./common.ts";
import { CampaignSettings } from "./settings.ts";
import { CharacterSheet, ConditionInstance, Equipment, Wound, WoundSeverity } from "./sheet.ts";

/**
 * Payload schemas for every event type the engine knows. Adding an event means adding it here
 * and handling it in the engine reducer; a test asserts the two stay in sync.
 */
export const eventPayloadSchemas = {
  CampaignCreated: z.object({
    name: z.string().min(1),
    settings: CampaignSettings,
    packIds: z.array(z.string()).min(1),
    packHash: z.string().optional(),
    rngState: RngStateSchema,
    gameTime: z.number().int().nonnegative().default(0),
  }),
  SettingsChanged: z.object({
    settings: CampaignSettings,
    changed: z.array(z.string()), // dotted paths, e.g. "narration.showMath"
  }),
  BranchForked: z.object({ fromBranchId: z.string(), forkSeq: z.number().int().nonnegative() }),
  ActorCreated: z.object({
    role: z.enum(["pc", "companion", "npc"]),
    sheet: CharacterSheet,
  }),
  CheckResolved: CheckResolvedPayload,
  LuckSpent: z.object({
    actorId: ActorId,
    amount: z.number().int().positive(),
    purpose: z.enum(["reroll", "downgradeWound"]),
    woundId: z.string().optional(),
  }),
  LuckRegained: z.object({
    actorId: ActorId,
    amount: z.number().int().positive(),
    reason: z.enum(["chapterClosed", "arcClosed", "ability", "other"]),
  }),
  ConditionApplied: z.object({ actorId: ActorId, condition: ConditionInstance }),
  ConditionRemoved: z.object({ actorId: ActorId, conditionId: ContentId, reason: z.string().optional() }),
  EquipmentChanged: z.object({ actorId: ActorId, equipment: Equipment }),
  TimeAdvanced: z.object({ minutes: z.number().int().positive(), reason: z.string() }),

  // Injury (M4). Hit resolution emits HitResolved, then HP and wound events. The reducer writes rngAfter back.
  HitResolved: z.object({
    attackerId: ActorId.nullable(),
    targetId: ActorId,
    weaponId: ContentId.nullable(),
    location: z.string(),
    locationRoll: z.number().int().nullable(),
    damageRolls: z.array(z.number().int()),
    raw: z.number().int(),
    protection: z.number().int(),
    final: z.number().int(),
    crit: z.boolean(),
    rngAfter: RngStateSchema,
  }),
  /** `hp` is the new current HP; the reducer clamps it to the effective max. */
  HpChanged: z.object({
    actorId: ActorId,
    hp: z.number().int().nonnegative(),
    delta: z.number().int(),
    cause: z.enum(["damage", "bleeding", "healing"]),
  }),
  WoundInflicted: z.object({ actorId: ActorId, wound: Wound }),
  /** `hpMaxReduction` is the new severity's reduction, computed by the emitter; the reducer has no tuning. */
  WoundWorsened: z.object({
    actorId: ActorId,
    woundId: z.string(),
    severity: WoundSeverity,
    hpMaxReduction: z.number().int().nonnegative(),
  }),

  // Canon (projections in storage; the engine only tracks what's present in the scene).
  EntityCreated: z.object({
    entity: Entity,
    /** Puts the entity in the current scene when it names the scene's location. */
    at: z.object({ locationId: z.string(), zoneId: z.string().optional() }).optional(),
  }),
  FactAsserted: z.object({ fact: Fact }),
  SceneOpened: z.object({ scene: SceneState }),
  SceneClosed: z.object({ sceneId: z.string(), reason: z.string() }),
  EntityMoved: z.object({ entityId: z.string(), toZoneId: z.string() }),

  // Turns: what the player typed, how it resolved, and what was narrated.
  TurnStarted: z.object({ input: z.string(), uiContext: z.record(z.string(), z.unknown()).optional() }),
  TurnCompleted: TurnCompletedPayload,
  NarrationCommitted: NarrationPayload,
  NarrationRerolled: NarrationPayload,

  // Combat (M4)
  ...combatEventSchemas,
} as const;

export type EventType = keyof typeof eventPayloadSchemas;
export const EVENT_TYPES = Object.keys(eventPayloadSchemas) as EventType[];
export type EventPayload<T extends EventType = EventType> = z.infer<(typeof eventPayloadSchemas)[T]>;

export const EventSource = z.enum(["engine", "model", "player", "system"]);
export type EventSource = z.infer<typeof EventSource>;

export const CURRENT_EVENT_SCHEMA_VERSION = 1;

export const EventEnvelopeSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  branchId: z.string(),
  seq: z.number().int().positive(),
  turnId: z.string().nullable(),
  type: z.string(),
  payload: z.unknown(),
  source: EventSource,
  gameTime: z.number().int().nonnegative(),
  createdAt: z.string(),
  schemaVersion: z.number().int().positive(),
});

export type EventEnvelope<T extends EventType = EventType> = {
  [K in T]: {
    id: string;
    campaignId: string;
    branchId: string;
    seq: number;
    turnId: string | null;
    type: K;
    payload: EventPayload<K>;
    source: EventSource;
    gameTime: number;
    createdAt: string;
    schemaVersion: number;
  };
}[T];

/** What the engine emits: an event without the envelope fields that storage assigns. */
export type EventDraft<T extends EventType = EventType> = {
  [K in T]: { type: K; payload: EventPayload<K>; source?: EventSource };
}[T];

export function isEventType(type: string): type is EventType {
  return Object.hasOwn(eventPayloadSchemas, type);
}

/** Validate an event payload against its type's schema; throws a ZodError on bad input. */
export function parseEventPayload<T extends EventType>(type: T, payload: unknown): EventPayload<T> {
  return eventPayloadSchemas[type].parse(payload) as EventPayload<T>;
}

/** Build a draft with a type-checked payload. */
export function draft<T extends EventType>(
  type: T,
  payload: EventPayload<T>,
  source?: EventSource,
): EventDraft<T> {
  return { type, payload, ...(source ? { source } : {}) } as EventDraft<T>;
}

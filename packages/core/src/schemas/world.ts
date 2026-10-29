import { z } from "zod";
import { Entity, Fact } from "./canon.ts";
import { RngStateSchema, WorldId } from "./common.ts";
import { SceneResponse } from "./scene-responses.ts";

/**
 * World simulation state (spec 06, spec 07). It lives in GameState so ticks stay pure and
 * replayable; storage projects the parts players browse (codex, journal, map).
 */

const Id = z.string().min(1);

export const Clock = z.object({
  id: Id,
  name: z.string().min(1),
  kind: z.enum(["threat", "faction", "deadline", "progress"]),
  segments: z.number().int().positive(),
  filled: z.number().int().nonnegative().default(0),
  /** Threat clocks: segments added per N in-game days (spec 06, Threat Clock). */
  paceDays: z.number().int().positive().optional(),
  ownerId: Id.optional(),
  /** Shown to the player (journal); faction goal clocks usually aren't. */
  visible: z.boolean().default(false),
  /** Missing means the main world (D141); read it with `worldOf`. */
  worldId: WorldId.optional(),
});
export type Clock = z.infer<typeof Clock>;

export const FactionState = z.object({
  id: Id,
  /** The player's standing, −100..+100 (spec 06, Factions). */
  reputation: z.number().int().min(-100).max(100).default(0),
  resources: z
    .object({
      wealth: z.number().int().min(1).max(5),
      military: z.number().int().min(1).max(5),
      influence: z.number().int().min(1).max(5),
    })
    .default({ wealth: 2, military: 2, influence: 2 }),
  relations: z.record(Id, z.number().int().min(-100).max(100)).default({}),
  goalClockIds: z.array(Id).default([]),
});
export type FactionState = z.infer<typeof FactionState>;

export const REPUTATION_TIERS = [
  [-100, "Hated"],
  [-60, "Hostile"],
  [-20, "Unfriendly"],
  [-5, "Neutral"],
  [20, "Friendly"],
  [60, "Honoured"],
  [90, "Exalted"],
] as const;
export function reputationTier(value: number): string {
  let tier: string = REPUTATION_TIERS[0][1];
  for (const [from, name] of REPUTATION_TIERS) if (value >= from) tier = name;
  return tier;
}

export const Objective = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reach"), locationId: Id }),
  z.object({ kind: z.literal("obtain"), itemId: Id, qty: z.number().int().positive().default(1) }),
  z.object({
    kind: z.literal("npcState"),
    npcId: Id,
    state: z.enum(["dead", "alive", "recruited", "persuaded", "captured"]),
  }),
  z.object({ kind: z.literal("flag"), key: z.string(), value: z.unknown() }),
  z.object({ kind: z.literal("narrative"), description: z.string().min(1) }),
]);
export type Objective = z.infer<typeof Objective>;

export const QuestState = z.object({
  id: Id,
  title: z.string().min(1),
  kind: z.enum(["main", "side", "personal", "companion", "faction", "job"]),
  giverId: Id.optional(),
  stages: z
    .array(
      z.object({
        id: Id,
        summary: z.string(),
        objectives: z.array(Objective),
        met: z.array(z.boolean()).default([]),
      }),
    )
    .min(1),
  stage: z.number().int().nonnegative().default(0),
  status: z.enum(["active", "completed", "failed", "abandoned", "retconned"]).default("active"),
  deadlineClockId: Id.optional(),
  pathOf: Id.optional(),
});
export type QuestState = z.infer<typeof QuestState>;

export const EdgeType = z.string().min(1); // memberOf, leads, knows, family, friend, rival, owes, employs, reportsTo, locatedIn, owns, routeTo…
export const Edge = z.object({
  from: Id,
  to: Id,
  type: EdgeType,
  /** 0–1, used by rumour spread; 0 removes the edge. */
  strength: z.number().min(0).max(1).default(0.5),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type Edge = z.infer<typeof Edge>;

export const NpcMemory = z.object({
  id: Id,
  npcId: Id,
  gameTime: z.number().int().nonnegative(),
  kind: z.enum(["witnessed", "told", "heard"]),
  /** One sentence from the NPC's point of view. */
  content: z.string().min(1),
  about: z.array(Id).default([]),
  importance: z.number().int().min(1).max(5).default(2),
  feeling: z.number().int().min(-3).max(3).default(0),
  /** 0–1: how much they believe it (told, heard). */
  belief: z.number().min(0).max(1).default(1),
  sourceId: Id.optional(),
  /** Set when the engine knows the content is false (a lie the PC told). */
  false: z.boolean().optional(),
  /** Optional engine-owned incident metadata; old memories remain valid. */
  response: SceneResponse.optional(),
});
export type NpcMemory = z.infer<typeof NpcMemory>;

export const Disposition = z.object({
  attitude: z.number().int().min(-100).max(100).default(0),
  trust: z.number().int().min(0).max(100).default(50),
  fear: z.number().int().min(0).max(100).default(0),
  respect: z.number().int().min(0).max(100).default(50),
});
export type Disposition = z.infer<typeof Disposition>;

export const Rumor = z.object({
  id: Id,
  content: z.string().min(1),
  about: z.array(Id).default([]),
  truth: z.object({ factId: Id.optional(), accuracy: z.enum(["true", "distorted", "false"]) }),
  originId: Id.optional(),
  heat: z.number().min(0).max(1),
  secrecy: z.number().min(0).max(1),
  createdAt: z.number().int().nonnegative(),
  /** Crimes and threats travel fast along reportsTo edges. */
  urgent: z.boolean().default(false),
  /** Who has heard it, and the version they heard. */
  holders: z.record(Id, z.object({ content: z.string(), at: z.number().int().nonnegative() })).default({}),
});
export type Rumor = z.infer<typeof Rumor>;

export const KnowledgeHow = z.enum(["witnessed", "told", "rumour", "read", "public", "deduced"]);
export const KnowledgeEntry = z.object({
  how: KnowledgeHow,
  sourceId: Id.optional(),
  gameTime: z.number().int().nonnegative(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntry>;

export const Threat = z.object({
  name: z.string().min(1),
  nature: z.string(),
  agentFactionId: Id.optional(),
  motive: z.string(),
  paths: z
    .array(z.object({ id: Id, name: z.string(), description: z.string() }))
    .min(1)
    .max(3),
  clockId: Id,
  /** Stages crossed so far (4 by default over 12 segments). */
  stage: z.number().int().nonnegative().default(0),
  stages: z.number().int().positive().default(4),
  defeated: z.boolean().default(false),
});
export type Threat = z.infer<typeof Threat>;

export const worldEventSchemas = {
  ClockCreated: z.object({ clock: Clock }),
  ClockAdvanced: z.object({ clockId: Id, by: z.number().int(), reason: z.string() }),
  FactionUpdated: z.object({ faction: FactionState }),
  ReputationChanged: z.object({ factionId: Id, delta: z.number().int(), reason: z.string() }),
  RelationshipChanged: z.object({ edge: Edge }),
  QuestStarted: z.object({ quest: QuestState }),
  QuestObjectiveMet: z.object({
    questId: Id,
    stage: z.number().int().nonnegative(),
    objective: z.number().int().nonnegative(),
    evidence: z.string(),
  }),
  QuestEnded: z.object({
    questId: Id,
    status: z.enum(["completed", "failed", "abandoned", "retconned"]),
    reason: z.string(),
  }),
  /** The PC learns a fact or that an entity exists (codex), and how. */
  KnowledgeGained: z.object({ factId: Id.optional(), entityId: Id.optional(), entry: KnowledgeEntry }),
  MemoryRecorded: z.object({ memory: NpcMemory }),
  DispositionChanged: z.object({
    npcId: Id,
    towardId: Id,
    delta: z.object({
      attitude: z.number().int().optional(),
      trust: z.number().int().optional(),
      fear: z.number().int().optional(),
      respect: z.number().int().optional(),
    }),
    reason: z.string(),
  }),
  RumorCreated: z.object({ rumor: Rumor }),
  RumorHeard: z.object({ rumorId: Id, holderId: Id, content: z.string(), fromId: Id.optional() }),
  ThreatCreated: z.object({ threat: Threat }),
  ThreatAdvanced: z.object({
    stage: z.number().int().nonnegative(),
    defeated: z.boolean().default(false),
    summary: z.string(),
  }),
  WeatherSet: z.object({ regionId: Id, weather: z.string() }),
  /** A tick boundary was processed; seeded choices during it store the generator state. */
  TickCompleted: z.object({
    kind: z.enum(["hour", "day", "week"]),
    at: z.number().int().nonnegative(),
    rngAfter: RngStateSchema.optional(),
  }),
  // Canon maintenance (projections; spec 07 "Pin, edit, retcon").
  EntityUpdated: z.object({
    entityId: Id,
    patch: Entity.pick({
      name: true,
      summary: true,
      detail: true,
      status: true,
      data: true,
      aliases: true,
      importance: true,
    }).partial(),
  }),
  FactSuperseded: z.object({ oldFactId: Id, fact: Fact }),
  FactRetracted: z.object({ factId: Id, reason: z.string() }),
  FactPinned: z.object({ factId: Id, pinned: z.boolean() }),
  /** Memory pyramid (spec 07): a scene, chapter or arc summary. Memory, not canon. */
  SummaryWritten: z.object({
    summary: z.object({
      id: Id,
      level: z.enum(["scene", "chapter", "arc"]),
      fromSeq: z.number().int().positive(),
      toSeq: z.number().int().positive(),
      gameTime: z.number().int().nonnegative(),
      text: z.string().min(1),
      entityIds: z.array(Id).default([]),
      importance: z.number().int().min(1).max(5).default(3),
    }),
  }),
  /** A journey interrupted on the road (an encounter); travelling again resumes it (spec 06, Travel). */
  JourneyChanged: z.object({
    journey: z
      .object({ fromSiteId: Id, toSiteId: Id, minutesLeft: z.number().int().nonnegative() })
      .nullable(),
  }),
} as const;

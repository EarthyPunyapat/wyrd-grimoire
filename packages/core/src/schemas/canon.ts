import { z } from "zod";
import { MechanicsLine, WorldId } from "./common.ts";

/** Canon entity and fact shapes (spec 07). They live in projections, not in GameState. */

export const EntityKind = z.enum([
  "npc",
  "location",
  "site",
  "region",
  "faction",
  "item",
  "quest",
  "creature",
  "concept",
]);
export type EntityKind = z.infer<typeof EntityKind>;

export const EntityId = z.string().min(1);

export const Entity = z.object({
  id: EntityId,
  kind: EntityKind,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  detail: z.enum(["stub", "sketch", "full"]),
  /** Kind-specific record; the canonical one-line description lives in `summary`. */
  summary: z.string().default(""),
  data: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(["active", "destroyed", "dead", "lost", "retconned"]).default("active"),
  importance: z.number().int().min(1).max(5).default(2),
  /** Missing means the main world (D141); read it with `worldOf`. */
  worldId: WorldId.optional(),
});
export type Entity = z.infer<typeof Entity>;
export type EntityInput = z.input<typeof Entity>;

export const Fact = z.object({
  id: z.string().min(1),
  entityId: EntityId,
  /** Controlled vocabulary ("appearance.hair", "location", "owes", "secret", "personality"…) plus "note". */
  predicate: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.unknown())]),
  source: z.enum(["engine", "model", "player", "pack", "lore"]),
  confidence: z.enum(["high", "low"]).optional(),
  evidence: z.object({ eventIds: z.array(z.string()).default([]), quote: z.string().optional() }).optional(),
  visibility: z.enum(["public", "secret"]).default("public"),
  importance: z.number().int().min(1).max(5).default(2),
  /** Projection-only: set by FactSuperseded / FactRetracted / FactPinned (spec 07). */
  supersededBy: z.string().optional(),
  retracted: z.boolean().optional(),
  pinned: z.boolean().optional(),
  /** Missing means the main world (D141); read it with `worldOf`. */
  worldId: WorldId.optional(),
});
export type Fact = z.infer<typeof Fact>;
export type FactInput = z.input<typeof Fact>;

/** Zones (spec 03). Exploration uses them too: the rooms and areas of the current location. */
export const Prop = z.object({
  id: z.string(),
  name: z.string(),
  affordances: z.array(z.string()).default([]),
});
export const Zone = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()).default([]),
  props: z.array(Prop).default([]),
  capacity: z.number().int().positive().optional(),
});
export type Zone = z.infer<typeof Zone>;
export const ZoneEdge = z.object({
  a: z.string(),
  b: z.string(),
  moveCost: z.union([z.literal(1), z.literal(2)]).default(1),
  blocksSight: z.boolean().optional(),
  requires: z.string().optional(),
});
export type ZoneEdge = z.infer<typeof ZoneEdge>;

export const Light = z.enum(["bright", "dim", "dark"]);

export const SceneState = z.object({
  id: z.string(),
  locationId: EntityId,
  zones: z.array(Zone).min(1),
  edges: z.array(ZoneEdge).default([]),
  /** Where every present actor and entity is: id → zone id. Presence = having a position. */
  positions: z.record(z.string(), z.string()),
  light: Light.default("bright"),
  weather: z.string().default(""),
  openedAt: z.number().int().nonnegative(),
});
export type SceneState = z.infer<typeof SceneState>;
export type SceneInput = z.input<typeof SceneState>;

/** What the turn record keeps about the clarification the player was offered. */
export const Clarification = z.object({
  question: z.string(),
  options: z.array(z.object({ label: z.string(), actions: z.array(z.unknown()).optional() })),
});
export type Clarification = z.infer<typeof Clarification>;

export const GuardSummary = z.object({
  checked: z.boolean(),
  regenerated: z.boolean(),
  /** Blocking issues that survived regeneration; the player resolves them. */
  flagged: z.array(z.object({ kind: z.string(), quote: z.string(), detail: z.string() })).default([]),
});
export type GuardSummary = z.infer<typeof GuardSummary>;

export const NarrationPayload = z.object({
  text: z.string(),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  /** True when narration failed and this is the plain mechanical summary. */
  fallback: z.boolean().default(false),
  guard: GuardSummary,
});

export const TurnStatus = z.enum(["resolved", "clarify", "ooc", "failed"]);

export const TurnCompletedPayload = z.object({
  status: TurnStatus,
  intent: z.string().optional(),
  /** The validated plan the engine resolved (actions as the parser proposed them). */
  plan: z.array(z.unknown()).default([]),
  mechanics: z.array(MechanicsLine).default([]),
  /** The structured resolution the narrator voiced; reroll reuses it unchanged. */
  resolution: z.unknown().optional(),
  clarification: Clarification.optional(),
  answer: z.string().optional(),
});

import { z } from "zod";
import { ActorId, RngStateSchema } from "./common.ts";

/** Combat (spec 03). The zone graph is the open scene's; combat adds turn order, AP and engagement. */

export const Side = z.enum(["party", "enemy"]);
export type Side = z.infer<typeof Side>;

export const TacticsProfile = z.enum([
  "aggressive",
  "defensive",
  "cowardly",
  "cunning",
  "berserk",
  "protector",
  "sniper",
  "caster",
]);
export type TacticsProfile = z.infer<typeof TacticsProfile>;

/** What the enemy side wants; drives surrender acceptance and defeat outcomes. */
export const CombatIntent = z.enum(["kill", "rob", "capture", "arrest", "driveOff", "prey"]);
export type CombatIntent = z.infer<typeof CombatIntent>;

export const CombatantStatus = z.enum([
  "active",
  "dying",
  "stable",
  "dead",
  "fled",
  "surrendered",
  "defeated",
]);
export type CombatantStatus = z.infer<typeof CombatantStatus>;

export const Combatant = z.object({
  actorId: ActorId,
  side: Side,
  /** Morale group; identical enemies share one. */
  group: z.string(),
  leader: z.boolean().default(false),
  tactics: TacticsProfile.default("aggressive"),
  status: CombatantStatus.default("active"),
  ap: z.number().int().nonnegative().default(0),
  reaction: z.boolean().default(true),
  /** Extra defence-only reaction from Defend. */
  defendReaction: z.boolean().default(false),
  defending: z.boolean().default(false),
  /** Aim steps banked for the next ranged attack (0–2). */
  aim: z.number().int().min(0).max(2).default(0),
  attacks: z.number().int().nonnegative().default(0),
  surprised: z.boolean().default(false),
  fleeing: z.boolean().default(false),
  /** Rounds until death while dying (spec 03, Lethal). */
  dyingRounds: z.number().int().nonnegative().optional(),
  /** Initiative result, for display: degree rank × 1000 + margin. */
  initiative: z.number().int().default(0),
  /** Player-controlled (the PC); everyone else uses the tactics AI. */
  controlled: z.boolean().default(false),
  /** Whether a weapon with reload AP is ready to fire. */
  loaded: z.boolean().default(true),
  size: z.enum(["tiny", "small", "medium", "large", "huge"]).default("medium"),
});
export type Combatant = z.infer<typeof Combatant>;

export const CombatState = z.object({
  id: z.string(),
  round: z.number().int().positive(),
  /** Index into `order` of the combatant whose turn it is. */
  turn: z.number().int().nonnegative(),
  order: z.array(ActorId),
  combatants: z.record(ActorId, Combatant),
  /** Melee engagements, each pair once. */
  engaged: z.array(z.tuple([ActorId, ActorId])).default([]),
  intent: CombatIntent.default("kill"),
  /** Prop affordances changed during the fight (a toppled table gives cover). */
  props: z
    .record(z.string(), z.object({ add: z.array(z.string()), remove: z.array(z.string()) }))
    .default({}),
  /** Morale triggers already spent, by "group:reason". */
  morale: z.array(z.string()).default([]),
});
export type CombatState = z.infer<typeof CombatState>;

export const CombatOutcome = z.enum(["victory", "defeat", "death", "fled", "surrender", "truce"]);
export type CombatOutcome = z.infer<typeof CombatOutcome>;

export const combatEventSchemas = {
  CombatStarted: z.object({ combat: CombatState }),
  /** The whole combat block after an action or turn change; the reducer replaces it. */
  CombatChanged: z.object({ combat: CombatState }),
  CombatEnded: z.object({
    combatId: z.string(),
    outcome: CombatOutcome,
    /** Seeded choices made while ending (defeat outcome) store the generator state. */
    rngAfter: RngStateSchema.optional(),
    summary: z.string(),
  }),
  ActorDied: z.object({ actorId: ActorId, cause: z.string() }),
  /** An actor leaves the open scene (fled, carried off). */
  EntityLeftScene: z.object({ entityId: z.string(), reason: z.string() }),
} as const;

// ── Combat actions (spec 03 "Action points") ──────────────────────────────────

const Id = z.string().min(1);

export const StrikeAction = z.object({
  type: z.literal("strike"),
  targetId: Id,
  /** A held weapon's id; omitted = what's in the main hand (or unarmed). */
  weaponId: Id.optional(),
  /** Body-plan location id for a called shot. */
  calledLocation: z.string().optional(),
});
export const CombatMoveAction = z.object({ type: z.literal("move"), toZoneId: Id });
export const EngageAction = z.object({ type: z.literal("engage"), targetId: Id });
export const DisengageAction = z.object({ type: z.literal("disengage") });
export const AimAction = z.object({ type: z.literal("aim"), targetId: Id.optional() });
export const DefendAction = z.object({ type: z.literal("defend") });
export const TakeCoverAction = z.object({ type: z.literal("takeCover"), propId: Id.optional() });
export const DrawAction = z.object({ type: z.literal("draw"), weaponId: Id });
export const ReloadAction = z.object({ type: z.literal("reload") });
export const FirstAidAction = z.object({ type: z.literal("firstAid"), targetId: Id });
export const StandUpAction = z.object({ type: z.literal("standUp") });
export const ShoveAction = z.object({ type: z.literal("shove"), targetId: Id, toZoneId: Id.optional() });
export const TripAction = z.object({ type: z.literal("trip"), targetId: Id });
export const GrappleAction = z.object({ type: z.literal("grapple"), targetId: Id });
export const DisarmAction = z.object({ type: z.literal("disarm"), targetId: Id });
export const StuntEffect = z.enum([
  "createCover",
  "removeCover",
  "knockProne",
  "blind",
  "push",
  "disarm",
  "createHazard",
  "extinguishLight",
  "climb",
  "swing",
  "barricade",
  "distract",
  "bindTarget",
]);
export type StuntEffect = z.infer<typeof StuntEffect>;
export const StuntAction = z.object({
  type: z.literal("stunt"),
  effect: StuntEffect,
  propId: Id.optional(),
  targetId: Id.optional(),
  /** What the player described, for the narrator. */
  description: z.string().default(""),
});
export const IntimidateAction = z.object({ type: z.literal("intimidate"), targetId: Id });
export const RallyAction = z.object({ type: z.literal("rally"), targetId: Id });
export const SpeakAction = z.object({
  type: z.literal("speak"),
  utterance: z.string().min(1),
  targetId: Id.optional(),
});
export const SurrenderAction = z.object({ type: z.literal("surrender") });
export const FleeAction = z.object({ type: z.literal("flee") });
export const EndTurnAction = z.object({ type: z.literal("endTurn") });

export const CombatAction = z.discriminatedUnion("type", [
  StrikeAction,
  CombatMoveAction,
  EngageAction,
  DisengageAction,
  AimAction,
  DefendAction,
  TakeCoverAction,
  DrawAction,
  ReloadAction,
  FirstAidAction,
  StandUpAction,
  ShoveAction,
  TripAction,
  GrappleAction,
  DisarmAction,
  StuntAction,
  IntimidateAction,
  RallyAction,
  SpeakAction,
  SurrenderAction,
  FleeAction,
  EndTurnAction,
]);
export type CombatAction = z.infer<typeof CombatAction>;
export type CombatActionInput = z.input<typeof CombatAction>;
export const COMBAT_ACTION_TYPES = CombatAction.options.map((o) => o.shape.type.value);

/** What the browser shows for a fight (spec 13), filtered to what the PC can perceive. */
export const CombatView = z.object({
  round: z.number().int(),
  currentActorId: z.string(),
  yourTurn: z.boolean(),
  ap: z.object({ current: z.number().int(), max: z.number().int() }),
  zones: z.array(z.object({ id: z.string(), name: z.string(), tags: z.array(z.string()) })),
  edges: z.array(z.object({ a: z.string(), b: z.string() })),
  combatants: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      side: z.enum(["pc", "ally", "enemy"]),
      status: z.string(),
      /** Exact for the party; perceived (0, 0.25, 0.5, 0.75, 1) for others. */
      health: z.number(),
      condition: z.string(),
      zoneId: z.string(),
      engagedWith: z.array(z.string()),
      wounds: z.array(z.object({ location: z.string(), severity: z.string() })),
      conditions: z.array(z.string()),
    }),
  ),
  actions: z.array(
    z.object({
      label: z.string(),
      ap: z.number().int(),
      legal: z.boolean(),
      reason: z.string().optional(),
      fill: z.string(),
    }),
  ),
});
export type CombatView = z.infer<typeof CombatView>;

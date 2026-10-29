import type {
  ActorId,
  CampaignSettings,
  CharacterSheet,
  CheckRequest,
  CheckResult,
  Clock,
  CombatState,
  CompanionState,
  Disposition,
  EconomyState,
  Edge,
  FactionState,
  InventoryState,
  KnowledgeEntry,
  LivingState,
  NpcMemory,
  QuestState,
  RngState,
  Rumor,
  SceneState,
  Threat,
  Tuning,
} from "@wyrd/core";
import type { ClassCatalog } from "./classes.ts";
import type { SkillCatalog } from "./skills.ts";

export type ActorRole = "pc" | "companion" | "npc";

export type ActorState = { role: ActorRole; sheet: CharacterSheet; dead?: true };

/** The most recent check per actor, so a push or a Luck reroll can be validated against it. */
export type LastCheck = {
  request: CheckRequest;
  effective: CheckResult;
  inCombat: boolean;
  autoFailed: boolean;
  opposed: boolean;
  pushed: boolean;
  luckUsed: boolean;
};

/**
 * Top-level engine state (spec 01). Fields later milestones fill (scene, combat, inventory,
 * economy, factions, quests, clocks, calendar) start empty; plugin state lives under flags[pluginId].
 */
export type GameState = {
  campaign: {
    id: string;
    name: string;
    settings: CampaignSettings;
    packIds: string[];
    packHash: string | null;
    rngState: RngState;
    gameTime: number;
  };
  mode: "exploration" | "dialogue" | "combat" | "downtime" | "creation";
  party: { pcId: ActorId | null; companionIds: ActorId[] };
  /** Companions (spec 04): approval, control, profile, by actor id; those who left stay on record. */
  companions: Record<ActorId, CompanionState>;
  actors: Record<ActorId, ActorState>;
  scene: SceneState | null;
  combat: CombatState | null;
  /** Detailed item stacks per actor (spec 11). `sheet.equipment` is the combat-facing projection. */
  inventory: InventoryState;
  /** Coins, wealth levels and shop stock (spec 11). */
  economy: EconomyState;
  factions: Record<string, FactionState>;
  quests: Record<string, QuestState>;
  clocks: Record<string, Clock>;
  /** Weather per region and the last tick processed of each kind (game minutes). */
  calendar: { weather: Record<string, string>; lastTick: { hour: number; day: number; week: number } };
  /** Social graph (spec 07 Edge): who knows, serves, leads and is related to whom. */
  edges: Edge[];
  /** NPC minds (spec 07): memories and dispositions, by NPC id. */
  minds: Record<string, { memories: NpcMemory[]; dispositions: Record<string, Disposition> }>;
  rumors: Record<string, Rumor>;
  /** Living World (M7): news, NPC life state, the job board and festivals held. Optional for old states. */
  living?: LivingState;
  /** What the PC knows (spec 07): facts and entities, each with how they learned it. */
  knowledge: { facts: Record<string, KnowledgeEntry>; entities: Record<string, KnowledgeEntry> };
  threat: Threat | null;
  flags: Record<string, unknown>;
  lastChecks: Record<ActorId, LastCheck>;
};

/** What rules functions need beyond state: content and tuning. Never IO. */
export type RulesContext = {
  skills: SkillCatalog;
  tuning: Tuning;
  /** Class data for class campaigns (spec 04); missing means class levels can't advance. */
  classes?: ClassCatalog;
};

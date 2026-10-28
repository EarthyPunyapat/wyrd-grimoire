import type {
  ActorId,
  CampaignSettings,
  CharacterSheet,
  CheckRequest,
  CheckResult,
  RngState,
  SceneState,
  Tuning,
} from "@wyrd/core";
import type { SkillCatalog } from "./skills.ts";

export type ActorRole = "pc" | "companion" | "npc";

export type ActorState = { role: ActorRole; sheet: CharacterSheet };

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
  actors: Record<ActorId, ActorState>;
  scene: SceneState | null;
  combat: null;
  inventory: Record<string, never>;
  economy: Record<string, never>;
  factions: Record<string, never>;
  quests: Record<string, never>;
  clocks: Record<string, never>;
  calendar: Record<string, never>;
  flags: Record<string, unknown>;
  lastChecks: Record<ActorId, LastCheck>;
};

/** What rules functions need beyond state: content and tuning. Never IO. */
export type RulesContext = { skills: SkillCatalog; tuning: Tuning };

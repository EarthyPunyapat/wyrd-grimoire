import type { Difficulty, PenaltyScope } from "./schemas/common.ts";
import { defaultSceneReactionTuning, type SceneReactionTuning } from "./schemas/scene-responses.ts";

export type LocationKind = "head" | "torso" | "arm" | "leg";

/** What one wound severity does at one body location. Read by hit resolution and the check penalties. */
export type WoundEffect = {
  penalty?: { scope: PenaltyScope; value: number };
  /** Applied when the wound is inflicted. */
  conditions?: Array<{ id: string; level?: number }>;
  /** Bleeding levels the wound adds. */
  bleeding?: number;
  /** By damage type; replaces `bleeding` and the cut bonus. */
  bleedingIf?: Record<string, number>;
  /** Damage types that fracture. */
  fractureIf?: string[];
  lethalCheck?: boolean;
  /** Read in steps B and C. */
  moveCost?: number;
  dropHeld?: boolean;
  armUseless?: boolean;
  cantStand?: boolean;
  /** Cut only. */
  severAtWtMultiple?: number;
  permanentRisk?: boolean;
  /** Required narration beat, e.g. "internal injury". */
  beat?: string;
};

/**
 * Every tuning number the rules use. Defaults live here; the app overrides them from `app.db`.
 * Spec numbers are defaults, not constants: rules code reads them from a Tuning value.
 */
export type Tuning = {
  version: number;
  /** Percent shift per difficulty step (d100). */
  difficultyShift: Record<Difficulty, number>;
  /** d20 DC per difficulty step. */
  difficultyDc: Record<Difficulty, number>;
  /** Situational modifiers sum and are clamped to ± this. */
  modifierCap: number;
  /** Player-side modifier from the campaign difficulty setting. */
  campaignDifficultyModifier: Record<"story" | "standard" | "hard", number>;
  skillCap: number;
  untrainedMultiplier: number;
  derived: {
    hpBase: number;
    hpPerEnd: number;
    carryKgPerStr: number;
    initiativePerAgi: number;
    initiativePerAwa: number;
    composureBase: number;
    composurePerWil: number;
  };
  luckMax: Record<"gritty" | "brutal", number>;
  luckCost: { reroll: number; downgradeWound: number };
  creation: {
    attributeStart: number;
    attributePoints: number;
    attributeMax: number;
    attributeMaxWithTrait: number;
    corePoints: number;
    coreMaxPerSkill: number;
    interestPoints: number;
    interestMaxPerSkill: number;
    archetypeTalents: number;
    freeTalents: number;
  };
  combat: {
    woundThresholdMultiples: Record<"minor" | "serious" | "critical", number>;
    hpMaxReduction: Record<"minor" | "serious" | "critical", number>;
    /** Strength bonus is floor((STR − strBonusBase) / strBonusDivisor). */
    strBonusBase: number;
    strBonusDivisor: number;
    maxArmourLayers: number;
    critArmourDivisor: number;
    cutBleedingBonus: number;
    maxBleeding: number;
    downCheck: Difficulty;
    lethalCheck: Difficulty;
    unarmed: { damage: string; damageType: string };
    woundEffects: Record<LocationKind, Record<"minor" | "serious" | "critical", WoundEffect>>;
    simpleWoundPenalty: Record<"minor" | "serious" | "critical", number>;
  };
  /** Turn structure and action numbers (spec 03, "Turn order" through "Enemy and companion tactics"). */
  fight: {
    apPerTurn: number;
    apLoss: { stunned: number; dazed: number; surprised: number };
    apCost: Record<string, number>;
    /** Penalty for the 1st, 2nd and 3rd attack in a turn; agile weapons use their own row. */
    multiAttack: number[];
    agileMultiAttack: number[];
    aimBonus: number;
    maxAim: number;
    defendBonus: number;
    calledShot: Record<LocationKind, number>;
    cover: { partial: number; full: number };
    light: { dim: number; dark: number };
    disarmPenalty: number;
    improvisedFirstAid: number;
    firstAidDifficulty: Difficulty;
    stabiliseDifficulty: Difficulty;
    moraleDifficulty: Difficulty;
    stuntDifficulty: Difficulty;
    size: Record<
      "tiny" | "small" | "medium" | "large" | "huge",
      { toHit: number; hpMultiplier: number; wtBonus: number }
    >;
    /** Utility AI: random jitter added to each plan score (fraction of the best score). */
    aiJitter: number;
    /** Utility AI: how much an aware defender's reaction cuts the chance to hit. */
    aiDefenceFactor: number;
    /** Morale modifier for cowardly combatants. */
    cowardlyMorale: number;
    /** Rounds per in-game minute when a fight's time is added. */
    roundsPerMinute: number;
    /** Defeat outcomes: in-game minutes each takes, and weights by enemy intent (spec 03, Defeat). */
    defeatMinutes: Record<"robbed" | "leftForDead" | "captured" | "rescued", number>;
    defeatWeights: Record<string, Partial<Record<"robbed" | "leftForDead" | "captured" | "rescued", number>>>;
    /** Safety stop for automated rounds. */
    maxRounds: number;
  };
  /** World simulation (spec 06): calendar defaults, tick rates, rumour spread. Packs may override the calendar. */
  world: {
    monthNames: string[];
    daysPerMonth: number;
    seasons: string[];
    /** Hours: dawn starts day, dusk starts night. */
    dawn: number;
    dusk: number;
    weatherByClimate: Record<string, string[]>;
    /** Long time skips run at most this many daily ticks (the most recent ones). */
    maxDailyTicks: number;
    rumourDailyHeatDecay: number;
    rumourDistortChance: number;
    /** reportsTo spreads urgent rumours (crimes, threats) this many times faster. */
    urgentReportsToFactor: number;
    /** Daily chance per average resource point that a faction goal clock advances. */
    factionGoalChancePerResource: number;
    /** Threat clocks: default days per segment and the told-memory importance that starts a rumour. */
    threatPaceDays: number;
    toldRumourImportance: number;
    /** Travel (spec 06): time factor per pace, Navigation difficulty per route danger (index into the difficulty ladder), and costs. */
    travel: {
      pace: Record<"careful" | "normal" | "fast", number>;
      paceShift: Record<"careful" | "normal" | "fast", number>;
      dangerDifficulty: number[];
      failureTimeFactor: number;
      minRoadMinutes: number;
    };
  };
  /** Memory (spec 07): pyramid cadence, retrieval scoring, pins. */
  memory: {
    turnsPerScene: number;
    scenesPerChapter: number;
    chaptersPerArc: number;
    halfLifeDays: number;
    rrfK: number;
    candidates: number;
    /** Items scored by vector per query: the full-text pool plus the most recent (bounds cost). */
    candidatePool: number;
    weights: { relevance: number; recency: number; importance: number; pinned: number };
    maxPins: number;
  };
  /** Progression (spec 04): XP awards, classless costs, use-based improvement. */
  progression: {
    xp: {
      questStage: Record<"main" | "major" | "minor", number>;
      encounter: { min: number; max: number };
      discovery: { region: number; site: number };
      bond: number;
      chapter: number;
      cleverPerScene: number;
    };
    /** Hybrid campaigns earn this share of every award, rounded half up. */
    hybridShare: number;
    /** Skill +step costs by current trained value: up to each `below`, that many XP. */
    skillStep: number;
    skillCosts: { below: number; cost: number }[];
    /** Past this value a skill needs a Mastery talent. */
    skillMasteryAt: number;
    /** Attribute +1 costs this × the new value; attributes stop at `attributeMax` without a pack ability. */
    attributeCostPerPoint: number;
    attributeMax: number;
    talentCost: Record<1 | 2 | 3, number>;
    fieldSkill: { cost: number; trained: number };
    /** Use-based: an improvement roll above the value (or at least `alwaysAt`) adds 1d`gainDie`. */
    improvement: { alwaysAt: number; gainDie: number; restMinutes: number };
    /** Use-based: a new talent every N chapter closes. */
    talentEveryChapters: number;
  };
  /** Companions (spec 04): party size, willingness to join, approval caps and thresholds. */
  companions: {
    max: number;
    /** An NPC joins only with at least this attitude toward the PC, a bond edge, or a recruit objective. */
    willingAttitude: number;
    approvalPerEvent: number;
    approvalPerScene: number;
    thresholds: { confront: number; leave: number; quest: number; loyal: number };
  };
  snapshotEvery: number;
  sceneReactions?: SceneReactionTuning;
};

export const defaultTuning: Tuning = {
  sceneReactions: defaultSceneReactionTuning,
  version: 1,
  difficultyShift: { easy: 20, normal: 0, hard: -20, extreme: -40, heroic: -60 },
  difficultyDc: { easy: 7, normal: 11, hard: 15, extreme: 19, heroic: 23 },
  modifierCap: 40,
  campaignDifficultyModifier: { story: 10, standard: 0, hard: -10 },
  skillCap: 99,
  untrainedMultiplier: 3,
  derived: {
    hpBase: 10,
    hpPerEnd: 2,
    carryKgPerStr: 5,
    initiativePerAgi: 5,
    initiativePerAwa: 5,
    composureBase: 10,
    composurePerWil: 2,
  },
  luckMax: { gritty: 3, brutal: 1 },
  luckCost: { reroll: 1, downgradeWound: 2 },
  creation: {
    attributeStart: 3,
    attributePoints: 18,
    attributeMax: 7,
    attributeMaxWithTrait: 8,
    corePoints: 200,
    coreMaxPerSkill: 50,
    interestPoints: 100,
    interestMaxPerSkill: 30,
    archetypeTalents: 1,
    freeTalents: 1,
  },
  combat: {
    woundThresholdMultiples: { minor: 1, serious: 2, critical: 3 },
    hpMaxReduction: { minor: 2, serious: 5, critical: 10 },
    strBonusBase: 5,
    strBonusDivisor: 2,
    maxArmourLayers: 2,
    critArmourDivisor: 2,
    cutBleedingBonus: 1,
    maxBleeding: 3,
    downCheck: "normal",
    lethalCheck: "hard",
    unarmed: { damage: "1d3", damageType: "blunt" },
    woundEffects: {
      head: {
        minor: { conditions: [{ id: "core:dazed" }], bleeding: 1 },
        serious: { conditions: [{ id: "core:stunned" }, { id: "core:concussed" }], bleeding: 1 },
        critical: {
          conditions: [{ id: "core:unconscious" }, { id: "core:concussed" }],
          bleeding: 2,
          lethalCheck: true,
          permanentRisk: true,
        },
      },
      torso: {
        minor: { bleeding: 1, penalty: { scope: "physical", value: -10 } },
        serious: {
          bleeding: 2,
          penalty: { scope: "physical", value: -20 },
          fractureIf: ["blunt"],
        },
        critical: {
          bleeding: 3,
          conditions: [{ id: "core:down" }],
          lethalCheck: true,
          beat: "internal injury",
        },
      },
      arm: {
        minor: { penalty: { scope: "sameArm", value: -10 } },
        serious: {
          dropHeld: true,
          penalty: { scope: "sameArm", value: -20 },
          fractureIf: ["blunt"],
          bleedingIf: { cut: 2 },
        },
        critical: { armUseless: true, bleeding: 3, severAtWtMultiple: 4 },
      },
      leg: {
        minor: { penalty: { scope: "movement", value: -10 } },
        serious: {
          conditions: [{ id: "core:prone" }],
          moveCost: 2,
          fractureIf: ["blunt"],
        },
        critical: { cantStand: true, bleeding: 3, permanentRisk: true },
      },
    },
    simpleWoundPenalty: { minor: -10, serious: -20, critical: -30 },
  },
  fight: {
    apPerTurn: 3,
    apLoss: { stunned: 2, dazed: 1, surprised: 2 },
    apCost: {
      strike: 1,
      move: 1,
      engage: 1,
      disengage: 1,
      aim: 1,
      defend: 1,
      takeCover: 1,
      draw: 1,
      reload: 0,
      firstAid: 2,
      standUp: 1,
      shove: 1,
      trip: 1,
      grapple: 1,
      disarm: 1,
      stunt: 1,
      intimidate: 1,
      rally: 1,
      speak: 0,
      surrender: 0,
      flee: 2,
      endTurn: 0,
    },
    multiAttack: [0, -20, -40],
    agileMultiAttack: [0, -10, -20],
    aimBonus: 20,
    maxAim: 2,
    defendBonus: 20,
    calledShot: { head: -40, torso: -10, arm: -20, leg: -20 },
    cover: { partial: -20, full: -40 },
    light: { dim: -20, dark: -40 },
    disarmPenalty: -20,
    improvisedFirstAid: -20,
    firstAidDifficulty: "normal",
    stabiliseDifficulty: "hard",
    moraleDifficulty: "normal",
    stuntDifficulty: "normal",
    size: {
      tiny: { toHit: -20, hpMultiplier: 0.25, wtBonus: -4 },
      small: { toHit: -10, hpMultiplier: 0.5, wtBonus: -2 },
      medium: { toHit: 0, hpMultiplier: 1, wtBonus: 0 },
      large: { toHit: 10, hpMultiplier: 2, wtBonus: 5 },
      huge: { toHit: 20, hpMultiplier: 4, wtBonus: 10 },
    },
    aiJitter: 0.05,
    aiDefenceFactor: 0.65,
    cowardlyMorale: -20,
    roundsPerMinute: 10,
    defeatMinutes: { robbed: 60, leftForDead: 240, captured: 480, rescued: 360 },
    defeatWeights: {
      kill: { leftForDead: 2, rescued: 1 },
      rob: { robbed: 3, leftForDead: 1 },
      capture: { captured: 3, rescued: 1 },
      arrest: { captured: 3 },
      driveOff: { leftForDead: 1, rescued: 1 },
      prey: { leftForDead: 2, rescued: 1 },
    },
    maxRounds: 30,
  },
  world: {
    monthNames: [
      "Thaw",
      "Seedtime",
      "Greening",
      "Highsun",
      "Haymonth",
      "Harvest",
      "Leaffall",
      "Mistmonth",
      "Frost",
      "Deepwinter",
      "Longnight",
      "Thawing",
    ],
    daysPerMonth: 30,
    seasons: [
      "spring",
      "spring",
      "spring",
      "summer",
      "summer",
      "summer",
      "autumn",
      "autumn",
      "autumn",
      "winter",
      "winter",
      "winter",
    ],
    dawn: 6,
    dusk: 19,
    weatherByClimate: {
      temperate: ["clear", "overcast", "light rain", "steady rain", "fog", "wind"],
      cold: ["clear and bitter", "snow", "sleet", "freezing fog", "overcast"],
      arid: ["clear and hot", "dust haze", "hot wind", "clear"],
      tropical: ["humid and clear", "heavy rain", "thunderstorm", "muggy overcast"],
      marine: ["sea fog", "squalls", "grey and blustery", "clear"],
      indoor: ["still"],
    },
    maxDailyTicks: 60,
    rumourDailyHeatDecay: 0.9,
    rumourDistortChance: 0.3,
    urgentReportsToFactor: 3,
    factionGoalChancePerResource: 0.02,
    threatPaceDays: 10,
    toldRumourImportance: 3,
    travel: {
      pace: { careful: 1.25, normal: 1, fast: 0.8 },
      paceShift: { careful: -1, normal: 0, fast: 1 },
      // easy, normal, hard, extreme, heroic → danger 1..5 starts at easy..extreme
      dangerDifficulty: [0, 1, 1, 2, 3],
      failureTimeFactor: 1.25,
      minRoadMinutes: 60,
    },
  },
  memory: {
    turnsPerScene: 25,
    scenesPerChapter: 8,
    chaptersPerArc: 5,
    halfLifeDays: 30,
    rrfK: 60,
    candidates: 30,
    candidatePool: 300,
    weights: { relevance: 0.5, recency: 0.25, importance: 0.2, pinned: 1 },
    maxPins: 20,
  },
  progression: {
    xp: {
      questStage: { main: 8, major: 5, minor: 2 },
      encounter: { min: 1, max: 3 },
      discovery: { region: 2, site: 1 },
      bond: 2,
      chapter: 2,
      cleverPerScene: 1,
    },
    hybridShare: 0.5,
    skillStep: 5,
    skillCosts: [
      { below: 25, cost: 1 },
      { below: 50, cost: 2 },
      { below: 75, cost: 3 },
      { below: 90, cost: 4 },
    ],
    skillMasteryAt: 90,
    attributeCostPerPoint: 4,
    attributeMax: 8,
    talentCost: { 1: 8, 2: 15, 3: 25 },
    fieldSkill: { cost: 2, trained: 10 },
    improvement: { alwaysAt: 96, gainDie: 10, restMinutes: 480 },
    talentEveryChapters: 2,
  },
  companions: {
    max: 3,
    willingAttitude: 25,
    approvalPerEvent: 10,
    approvalPerScene: 20,
    thresholds: { confront: -50, leave: -75, quest: 50, loyal: 75 },
  },
  snapshotEvery: 200,
};

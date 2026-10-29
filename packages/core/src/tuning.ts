import type { Degree, Difficulty, PenaltyScope } from "./schemas/common.ts";
import { defaultSceneReactionTuning, type SceneReactionTuning } from "./schemas/scene-responses.ts";
import type { NeedLadder, NeedStageDef, ScheduleEntry, WeatherKind } from "./schemas/survival.ts";

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
  levels: {
    start: number;
    step: number;
    minRank: number;
    maxRank: number;
    oneStepBonus: number;
    autoGap: number;
    rankBonus: { divisor: number };
    bands: { from: number; through?: number; name: string }[];
    powerRating: { base: number; exponent: number; rankDivisor: number };
    xpThresholds: Record<number, number>;
    xpCurve: { base: number; exponent: number };
    breakthroughDifficulty: Difficulty;
  };
  lore: {
    requestIntervalMs: number;
    requestTimeoutMs: number;
    searchLimit: number;
    canonLimit: number;
    maxSourceChars: number;
    maxFacts: number;
    maxFactChars: number;
    maxVerbatimWords: number;
  };
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
    playerGearWeightKg: number;
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
  /** Injury recovery (spec 03, Healing; spec 11, Injuries). */
  injury: {
    /** Days a wound of each severity takes to heal, by treatment. */
    healingDays: Record<"minor" | "serious" | "critical" | "lethal", number>;
    /** Simple injuries heal this share of the realistic time. */
    simpleScale: number;
    /** A treated wound heals an extra day per day. */
    treatedExtraDays: number;
    /** Infection: ENd difficulty for an untreated serious+ wound, chance per day, damage while infected. */
    infectionDifficulty: Difficulty;
    infectionChance: number;
    infectedDamagePerDay: number;
    /** A critical wound that heals without treatment can leave a permanent injury on this roll (1–100). */
    permanentChance: number;
    /** Rest: minutes for a short and a long rest, and HP regained. */
    shortRestMinutes: number;
    longRestMinutes: number;
    longRestHeal: number;
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
      /** Reduced travel encounters never ambush on routes above this danger (spec 11). */
      reducedMaxDanger: number;
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
  /** Inventory and encumbrance (spec 11). Carry capacity itself is `derived.carryKgPerStr`. */
  inventory: {
    /** Multiples of carry capacity where each band begins. */
    bands: { burdened: number; heavily: number };
    agiPenalty: { burdened: number; heavilyBurdened: number; overloaded: number };
    travelFactor: { burdened: number; heavilyBurdened: number; overloaded: number };
    /** Heavily burdened: the first Move each turn costs this many AP. */
    heavilyFirstMoveAp: number;
    /** Overloaded: at most this many Moves per turn. */
    overloadedMoves: number;
    /** Drawing an item in combat, by where it is. */
    drawAp: { held: number; belt: number; worn: number; pack: number };
    /** Used when neither the pack nor economy.yaml gives a container capacity. */
    defaultContainerKg: number;
  };
  /** Money and shops (spec 11). Selling rates and haggling come from the pack's economy.yaml. */
  economy: {
    shopRefreshDays: number;
    /** How long a haggled price lasts, in game minutes. */
    bargainMinutes: number;
    /** A purchase above this fraction of the wealth band's top price lowers the level by one. */
    wealthDropAt: number;
    /** Coins a new PC starts with (spec 11). */
    startingCoins: number;
    selling: { min: number; max: number };
    /** Price multiplier the PC pays after haggling, by degree. */
    haggle: Record<"critSuccess" | "success" | "failure" | "critFailure", number>;
  };
  /** Durability (spec 11): when items degrade and what damage they do. */
  durability: {
    weaponPenalty: number;
    armourPenalty: number;
    /** A parry against a hit of at least this many × WT degrades the parrying weapon. */
    parryWtMultiple: number;
    /** A hit whose raw damage exceeds protection by this much degrades the armour. */
    armourExcess: number;
  };
  /** Crafting quality bonuses (spec 11). */
  crafting: {
    crudePenalty: number;
    fineBonus: number;
    masterworkBonus: number;
    masterworkDamage: number;
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
  /** Content-dial enforcement (spec 12): deterministic phrase matching for lines and veils. */
  content: {
    /** Language glue ignored when matching a line or veil. Never content words. */
    stopwords: string[];
    /** A token at least this long matches on its stem ("harm" matches "harming"). */
    stemMin: number;
    /** Longest quote kept in a violation report. */
    quoteMax: number;
  };
  /** Living World (spec 06): weekly faction goals, NPC life events, festivals and the job board. */
  living: {
    /** Base weekly chance a faction goal clock advances; scaled by resources vs opposition. */
    goalChance: number;
    /** Opposition on the 1–5 resource scale when no rival faction is known. */
    oppositionBaseline: number;
    /** New goal clocks get this many segments. */
    goalSegments: { min: number; max: number };
    /** Weekly chance that some NPC life event happens. */
    lifeEventChance: number;
    /** NPCs at or above this age can die of old age. */
    oldAge: number;
    /** Job board size after a weekly refresh. */
    jobBoard: { min: number; max: number };
    /** News items kept in state; older ones are dropped. */
    maxNews: number;
    /** Job postings kept in state. */
    maxJobBoard: number;
    /** Generic faction goal names (pack worldgen can replace them later). */
    goalNames: string[];
    /** Generic job titles for the board. */
    jobTitles: string[];
  };
  /** Downtime (spec 06): time costs and outcome tables. */
  downtime: {
    minutes: Record<"train" | "craft" | "work" | "research" | "carouse" | "recover", number>;
    /** Coins earned for a day's work by degree. */
    workPay: Record<Degree, number>;
    /** HP restored by care by degree. */
    recoverHp: Record<Degree, number>;
    /** Segments in a new research clock. */
    researchSegments: number;
    /** Chance that carousing turns up a rumour (else just a quiet night). */
    carouseRumourChance: number;
    /** Chance that carousing brings trouble (intoxication) even on a good night. */
    carouseTroubleChance: number;
  };
  /** Survival, disease, weather effects, lighting and language barriers (spec 11, M7). */
  survival: {
    /** One ration a day. */
    rationPerDay: number;
    /** Litres of water a day by climate; the exertion bonus is added on top. */
    litresPerDay: Record<string, number>;
    /** A waterskin holds this many litres, so hot climates need more than one. */
    litresPerWaterskin: number;
    exertionBonusLitres: number;
    sleep: { minHours: number; maxHours: number; assumedHours: number; awakeHoursPerDay: number };
    /** Exposure: clothing warmth vs the temperature the weather and season give. */
    exposure: {
      baseWarmth: number;
      /** Worn item tags that add warmth. */
      warmthByTag: Record<string, number>;
      coldBelow: number;
      hotAbove: number;
      /** Temperature steps beyond the threshold that make the second (severe) stage. */
      severeAt: number;
      /** Temperature by season, added to the weather's own. */
      seasonTemperature: Record<string, number>;
    };
    /** Escalation ladders; the first stage whose `at` is reached applies. */
    stages: Record<NeedLadder, NeedStageDef[]>;
    /** HP regained on a day of rest when no need blocks recovery. */
    dailyHeal: number;
    forage: {
      difficulty: Difficulty;
      huntDifficulty: Difficulty;
      /** Difficulty steps added or removed by season. */
      seasonShift: Record<string, number>;
      /** Rations found or killed on a success. */
      yield: [number, number];
      /** Rations gathered on a critical success. */
      critYield: [number, number];
    };
    disease: { checkDifficulty: Difficulty; maxChecksPerDay: number };
    weather: {
      /** What each weather family does. Missing rows are harmless. */
      effects: Partial<
        Record<
          WeatherKind,
          {
            rangedPenalty: number;
            perceptionPenalty: number;
            travelFactor: number;
            blocksRoutes: boolean;
          }
        >
      >;
      /** Degrees relative to comfortable, by weather family. */
      temperature: Partial<Record<WeatherKind, number>>;
    };
    light: { dimPenalty: number; darkPenalty: number; torchMinutes: number; lanternMinutes: number };
    language: {
      commonTongue: string;
      /** Language check to understand an unknown tongue; Insight to read gestures. */
      checkDifficulty: Difficulty;
      insightDifficulty: Difficulty;
    };
    /** Time detail: shop and archetype hours, by archetype name. */
    schedules: Record<string, ScheduleEntry>;
  };
  /** The GM-with-tools turn (Wyrd 2.0, D144): tool rounds, context and the structural check. */
  gm: {
    maxToolRounds: number;
    contextTokens: number;
    checkTimeoutMs: number;
  };
  /** Spellcasting (spec 05): strain by tier, miscast consequences and default condition lengths. */
  spellcasting: {
    /** HP strain paid for casting a spell of each tier. */
    strainByTier: Record<1 | 2 | 3, number>;
    /** Damage a miscast deals before the school's wild effect. */
    miscastDamage: number;
    /** Condition a miscast leaves behind (Exhausted, usually). */
    miscastCondition: string;
    /** Default minutes a cast condition lasts. */
    conditionMinutes: number;
  };
  snapshotEvery: number;
  sceneReactions?: SceneReactionTuning;
  /** Structured model calls: extra attempts that feed validation errors back before failing. */
  structuredOutput: { repairs: number };
};

export const defaultTuning: Tuning = {
  levels: {
    start: 1,
    step: 1,
    minRank: 1,
    maxRank: 10,
    oneStepBonus: 10,
    autoGap: 2,
    rankBonus: { divisor: 2 },
    bands: [
      { from: 1, through: 4, name: "Human to street" },
      { from: 5, through: 8, name: "City to country" },
      { from: 9, through: 12, name: "Planet to star system" },
      { from: 13, through: 16, name: "Galaxy to universe" },
      { from: 17, through: 20, name: "Multiversal and beyond" },
      { from: 21, name: "Open-ended" },
    ],
    powerRating: { base: 2, exponent: 1.5, rankDivisor: 20 },
    xpThresholds: { 1: 0, 2: 10, 3: 40, 4: 90 },
    xpCurve: { base: 10, exponent: 2 },
    breakthroughDifficulty: "normal",
  },
  lore: {
    requestIntervalMs: 1000,
    requestTimeoutMs: 15000,
    searchLimit: 5,
    canonLimit: 5,
    maxSourceChars: 40000,
    maxFacts: 12,
    maxFactChars: 1500,
    maxVerbatimWords: 25,
  },
  sceneReactions: defaultSceneReactionTuning,
  structuredOutput: { repairs: 2 },
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
    /** Weight of a piece of player-written starting gear (spec 04). */
    playerGearWeightKg: 0.5,
  },
  injury: {
    healingDays: { minor: 3, serious: 7, critical: 14, lethal: 21 },
    simpleScale: 0.5,
    treatedExtraDays: 1,
    infectionDifficulty: "normal",
    infectionChance: 15,
    infectedDamagePerDay: 1,
    permanentChance: 25,
    shortRestMinutes: 60,
    longRestMinutes: 480,
    longRestHeal: 2,
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
      reducedMaxDanger: 3,
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
  content: {
    stopwords: [
      "a",
      "an",
      "and",
      "are",
      "as",
      "at",
      "be",
      "but",
      "by",
      "for",
      "from",
      "in",
      "into",
      "is",
      "it",
      "its",
      "of",
      "on",
      "or",
      "that",
      "the",
      "their",
      "them",
      "then",
      "there",
      "these",
      "this",
      "to",
      "was",
      "were",
      "with",
    ],
    stemMin: 4,
    quoteMax: 240,
  },
  living: {
    goalChance: 0.35,
    oppositionBaseline: 2,
    goalSegments: { min: 3, max: 6 },
    lifeEventChance: 0.25,
    oldAge: 65,
    jobBoard: { min: 1, max: 3 },
    maxNews: 60,
    maxJobBoard: 8,
    goalNames: [
      "open a new trade route",
      "settle an old feud",
      "win the next election",
      "raise a new hall",
      "buy out a rival",
      "secure a marriage alliance",
      "clear the roads of bandits",
      "found a guild chapter",
    ],
    jobTitles: [
      "Escort a wagon",
      "Clear out a cellar",
      "Find a missing goat",
      "Guard a warehouse",
      "Deliver a sealed letter",
      "Search the old well",
      "Stand watch at the fair",
      "Recover a pledged ring",
    ],
  },
  downtime: {
    minutes: { train: 480, craft: 240, work: 480, research: 360, carouse: 240, recover: 480 },
    workPay: { critSuccess: 20, success: 12, failure: 4, critFailure: 0 },
    recoverHp: { critSuccess: 6, success: 4, failure: 2, critFailure: 0 },
    researchSegments: 4,
    carouseRumourChance: 0.8,
    carouseTroubleChance: 0.2,
  },
  inventory: {
    bands: { burdened: 1.5, heavily: 2 },
    agiPenalty: { burdened: -10, heavilyBurdened: -20, overloaded: -40 },
    travelFactor: { burdened: 1.25, heavilyBurdened: 1.5, overloaded: 1.5 },
    heavilyFirstMoveAp: 2,
    overloadedMoves: 1,
    drawAp: { held: 0, belt: 1, worn: 1, pack: 2 },
    defaultContainerKg: 20,
  },
  economy: {
    shopRefreshDays: 7,
    bargainMinutes: 1440,
    wealthDropAt: 0.75,
    startingCoins: 50,
    selling: { min: 0.4, max: 0.6 },
    haggle: { critSuccess: 0.8, success: 0.9, failure: 1, critFailure: 1.1 },
  },
  durability: {
    weaponPenalty: -10,
    armourPenalty: -1,
    parryWtMultiple: 2,
    armourExcess: 5,
  },
  crafting: {
    crudePenalty: -10,
    fineBonus: 10,
    masterworkBonus: 20,
    masterworkDamage: 1,
  },
  survival: {
    rationPerDay: 1,
    litresPerDay: { temperate: 2.5, cold: 2, arid: 4, tropical: 3.5, marine: 2.5, indoor: 2 },
    litresPerWaterskin: 2,
    exertionBonusLitres: 1,
    sleep: { minHours: 6, maxHours: 8, assumedHours: 8, awakeHoursPerDay: 16 },
    exposure: {
      baseWarmth: 1,
      warmthByTag: { warm: 2, winter: 2, cloak: 1, light: 0, armour: 0 },
      coldBelow: -1,
      hotAbove: 2,
      severeAt: 2,
      seasonTemperature: { spring: 0, summer: 2, autumn: 0, winter: -3 },
    },
    stages: {
      food: [
        { id: "hungry", name: "Hungry", at: 1, penalty: -10, condition: "core:hungry" },
        {
          id: "starving",
          name: "Starving",
          at: 3,
          penalty: -20,
          condition: "core:starving",
          noRecovery: true,
          checkEveryHours: 24,
          checkDifficulty: "normal",
          failureDamage: 1,
        },
      ],
      water: [
        { id: "thirsty", name: "Thirsty", at: 1, penalty: -10, condition: "core:thirsty" },
        {
          id: "dehydrated",
          name: "Dehydrated",
          at: 2,
          penalty: -30,
          condition: "core:dehydrated",
          noRecovery: true,
          checkEveryHours: 6,
          checkDifficulty: "hard",
          failureDamage: 1,
        },
      ],
      sleep: [
        { id: "tired", name: "Tired", at: 16, penalty: -10, condition: "core:exhausted", level: 1 },
        { id: "weary", name: "Weary", at: 40, penalty: -20, condition: "core:exhausted", level: 2 },
        { id: "worn", name: "Worn down", at: 64, penalty: -30, condition: "core:exhausted", level: 3 },
        { id: "spent", name: "Spent", at: 88, penalty: -40, condition: "core:exhausted", level: 4 },
        { id: "collapsed", name: "Collapsed", at: 112, penalty: -50, condition: "core:exhausted", level: 5 },
      ],
      cold: [
        { id: "cold", name: "Cold", at: 1, penalty: -10, condition: "core:cold" },
        {
          id: "hypothermic",
          name: "Hypothermic",
          at: 2,
          penalty: -20,
          condition: "core:hypothermic",
          noRecovery: true,
          checkEveryHours: 1,
          checkDifficulty: "hard",
          failureDamage: 1,
        },
      ],
      hot: [
        { id: "hot", name: "Hot", at: 1, penalty: -10, condition: "core:hot" },
        {
          id: "heatstroke",
          name: "Heatstroke",
          at: 2,
          penalty: -20,
          condition: "core:heatstroke",
          noRecovery: true,
          checkEveryHours: 1,
          checkDifficulty: "hard",
          failureDamage: 1,
        },
      ],
    },
    dailyHeal: 1,
    forage: {
      difficulty: "normal",
      huntDifficulty: "hard",
      seasonShift: { spring: -1, summer: 0, autumn: -1, winter: 1 },
      yield: [1, 2],
      critYield: [2, 3],
    },
    disease: { checkDifficulty: "normal", maxChecksPerDay: 4 },
    weather: {
      effects: {
        clear: { rangedPenalty: 0, perceptionPenalty: 0, travelFactor: 1, blocksRoutes: false },
        overcast: { rangedPenalty: 0, perceptionPenalty: 0, travelFactor: 1, blocksRoutes: false },
        rain: { rangedPenalty: -10, perceptionPenalty: -10, travelFactor: 1.15, blocksRoutes: false },
        fog: { rangedPenalty: -20, perceptionPenalty: -20, travelFactor: 1.25, blocksRoutes: false },
        wind: { rangedPenalty: -10, perceptionPenalty: -10, travelFactor: 1.1, blocksRoutes: false },
        snow: { rangedPenalty: 0, perceptionPenalty: -10, travelFactor: 1.5, blocksRoutes: false },
        storm: { rangedPenalty: -20, perceptionPenalty: -20, travelFactor: 1.75, blocksRoutes: true },
        heat: { rangedPenalty: 0, perceptionPenalty: 0, travelFactor: 1.1, blocksRoutes: false },
        mud: { rangedPenalty: 0, perceptionPenalty: 0, travelFactor: 1.5, blocksRoutes: false },
      },
      temperature: {
        clear: 0,
        overcast: -1,
        rain: -1,
        fog: -1,
        wind: -1,
        snow: -3,
        storm: -2,
        heat: 4,
        mud: 0,
      },
    },
    light: { dimPenalty: -20, darkPenalty: -40, torchMinutes: 60, lanternMinutes: 240 },
    language: { commonTongue: "common", checkDifficulty: "normal", insightDifficulty: "normal" },
    schedules: {
      shopkeeper: { archetype: "shopkeeper", openHour: 8, closeHour: 18, note: "keeps shop hours" },
      tavern: { archetype: "tavern", openHour: 11, closeHour: 2, note: "fills at night" },
      guard: { archetype: "guard", openHour: 6, closeHour: 18, note: "day shift" },
      guardNight: { archetype: "guard", openHour: 18, closeHour: 6, note: "night shift" },
      smith: { archetype: "smith", openHour: 7, closeHour: 17, note: "works by daylight" },
      priest: { archetype: "priest", openHour: 6, closeHour: 20, note: "keeps the temple" },
    },
  },
  gm: {
    maxToolRounds: 8,
    contextTokens: 32_000,
    checkTimeoutMs: 20_000,
  },
  spellcasting: {
    strainByTier: { 1: 1, 2: 2, 3: 4 },
    miscastDamage: 2,
    miscastCondition: "core:exhausted",
    conditionMinutes: 10,
  },
  snapshotEvery: 200,
};

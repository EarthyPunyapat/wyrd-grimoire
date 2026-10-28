import type { Difficulty, PenaltyScope } from "./schemas/common.ts";

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
  snapshotEvery: number;
};

export const defaultTuning: Tuning = {
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
  snapshotEvery: 200,
};

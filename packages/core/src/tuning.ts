import type { Difficulty } from "./schemas/common.ts";

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
  snapshotEvery: 200,
};

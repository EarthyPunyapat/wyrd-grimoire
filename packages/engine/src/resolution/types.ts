import type { CheckResult, PreparedCheck, ResolutionId, Rng, Tuning } from "@wyrd/core";

/**
 * A dice system. Modules roll against a fully prepared check; preparing it (skill value,
 * conditions, campaign difficulty, the modifier cap) is shared engine code, so both modules
 * see exactly the same inputs. Downstream rules only consume `degree` and `margin`.
 */
export interface ResolutionModule {
  id: ResolutionId;
  resolve(prepared: PreparedCheck, rng: Rng, tuning: Tuning): CheckResult;
  /** "65%" or "+3". */
  displaySkill(value: number): string;
}

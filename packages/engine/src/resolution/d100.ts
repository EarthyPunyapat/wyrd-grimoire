import type { CheckResult, Degree, PreparedCheck, Rng, Tuning } from "@wyrd/core";
import { DEGREE_WORDS, DIFFICULTY_WORDS, modifierParts, signed } from "./format.ts";
import type { ResolutionModule } from "./types.ts";

/** Target T = skill + modifiers + difficulty shift, clamped to 1–99. */
export function d100Target(p: PreparedCheck, tuning: Tuning): number {
  const t = p.skillValue + p.modifierTotal + tuning.difficultyShift[p.difficulty];
  return Math.max(1, Math.min(99, t));
}

/** Degree for a roll of 1–100 against target T (spec 02, d100 table). */
export function degreeD100(target: number, roll: number): Degree {
  if (roll <= Math.max(1, Math.floor(target / 5))) return "critSuccess";
  if (roll <= target) return "success";
  if (roll === 100 || (roll >= 96 && target < 50)) return "critFailure";
  return "failure";
}

/** Tens digit (0–9) and units digit (0–9) to a d100 result; "00" + "0" reads as 100. */
const d100Value = (tens: number, units: number): number => tens * 10 + units || 100;

export const d100Module: ResolutionModule = {
  id: "d100",

  resolve(p: PreparedCheck, rng: Rng, tuning: Tuning): CheckResult {
    const target = d100Target(p, tuning);
    // Boons/banes: roll the tens die 1 + |net| times, keep the best (boons) or worst (banes) result.
    const tensDice = Array.from({ length: 1 + Math.abs(p.netBoons) }, () => rng.int(0, 9));
    const units = rng.int(0, 9);
    const candidates = tensDice.map((t) => d100Value(t, units));
    const roll = p.netBoons >= 0 ? Math.min(...candidates) : Math.max(...candidates);
    const degree = degreeD100(target, roll);

    const head = [`${p.label} ${p.skillValue}%`];
    if (p.difficulty !== "normal") {
      head.push(`${DIFFICULTY_WORDS[p.difficulty]} (${signed(tuning.difficultyShift[p.difficulty])})`);
    }
    head.push(...modifierParts(p));
    const showTarget = target !== p.skillValue;
    const text = `${head.join(" · ")}${showTarget ? ` → ${target}%` : ""} · rolled ${roll} · ${DEGREE_WORDS[degree]}`;

    return {
      degree,
      margin: target - roll,
      rolls: [...tensDice.map((t) => t * 10), units],
      display: { text, degree },
    };
  },

  displaySkill: (value) => `${value}%`,
};

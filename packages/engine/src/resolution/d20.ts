import type { CheckResult, Degree, PreparedCheck, Rng, Tuning } from "@wyrd/core";
import { DEGREE_WORDS, DIFFICULTY_WORDS, modifierParts, signed } from "./format.ts";
import type { ResolutionModule } from "./types.ts";

const DEGREES: Degree[] = ["critFailure", "failure", "success", "critSuccess"];

/** Round half away from zero, so the skill conversion is symmetric around 50. */
function roundHalfAway(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** Skill-only modifier: round((skill − 50) / 5). */
export function d20SkillModifier(skillValue: number): number {
  return roundHalfAway((skillValue - 50) / 5);
}

/** Full modifier m = round((skill − 50) / 5) + round(Σ modifiers / 5). */
export function d20Modifier(p: PreparedCheck): number {
  return d20SkillModifier(p.skillValue) + roundHalfAway(p.modifierTotal / 5);
}

/** Degree for a d20 total against a DC; a natural 20 moves one degree up, a natural 1 one down. */
export function degreeD20(total: number, dc: number, natural: number): Degree {
  let i: number;
  if (total >= dc + 10) i = 3;
  else if (total >= dc) i = 2;
  else if (total <= dc - 10) i = 0;
  else i = 1;
  if (natural === 20) i = Math.min(3, i + 1);
  if (natural === 1) i = Math.max(0, i - 1);
  return DEGREES[i]!;
}

export const d20Module: ResolutionModule = {
  id: "d20",

  resolve(p: PreparedCheck, rng: Rng, tuning: Tuning): CheckResult {
    const m = d20Modifier(p);
    const dc = tuning.difficultyDc[p.difficulty];
    // Net ±1: advantage/disadvantage. Net ±2: the same plus ±2 to the total.
    const dice = p.netBoons === 0 ? [rng.die(20)] : [rng.die(20), rng.die(20)];
    const natural = p.netBoons >= 0 ? Math.max(...dice) : Math.min(...dice);
    const extra = p.netBoons === 2 ? 2 : p.netBoons === -2 ? -2 : 0;
    const total = natural + m + extra;
    const degree = degreeD20(total, dc, natural);

    const head = [
      `${p.label} ${signed(d20SkillModifier(p.skillValue))} vs DC ${dc} (${DIFFICULTY_WORDS[p.difficulty]})`,
    ];
    head.push(...modifierParts(p));
    const sum = [`${natural}`];
    if (m !== 0) sum.push(m > 0 ? `+ ${m}` : `− ${-m}`);
    if (extra !== 0) sum.push(extra > 0 ? `+ ${extra}` : `− ${-extra}`);
    const shownTotal = total < 0 ? `−${-total}` : `${total}`;
    const text = `${head.join(" · ")} · rolled ${sum.join(" ")} = ${shownTotal} · ${DEGREE_WORDS[degree]}`;

    return {
      degree,
      margin: total - dc,
      rolls: dice,
      display: {
        text,
        degree,
        roll: { die: "d20", sides: 20, natural, modifier: m + extra, total, dc },
      },
    };
  },

  displaySkill: (value) => signed(d20SkillModifier(value)),
};

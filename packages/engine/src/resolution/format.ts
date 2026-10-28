import type { Degree, Difficulty, PreparedCheck } from "@wyrd/core";

export const DEGREE_WORDS: Record<Degree, string> = {
  critSuccess: "Critical success",
  success: "Success",
  failure: "Failure",
  critFailure: "Critical failure",
};

export const DIFFICULTY_WORDS: Record<Difficulty, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
  extreme: "Extreme",
  heroic: "Heroic",
};

/** Signed number with a real minus sign, as shown in the mechanics log: +20, −20, 0. */
export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

/** "darkness −20 · 1 boon" style suffixes for modifiers and boons/banes; empty when there are none. */
export function modifierParts(p: PreparedCheck): string[] {
  const parts = p.modifiers.filter((m) => m.value !== 0).map((m) => `${m.source} ${signed(m.value)}`);
  const raw = p.modifiers.reduce((s, m) => s + m.value, 0);
  if (raw !== p.modifierTotal) parts.push(`capped at ${signed(p.modifierTotal)}`);
  if (p.netBoons > 0) parts.push(`${p.netBoons} ${p.netBoons === 1 ? "boon" : "boons"}`);
  if (p.netBoons < 0) parts.push(`${-p.netBoons} ${p.netBoons === -1 ? "bane" : "banes"}`);
  return parts;
}

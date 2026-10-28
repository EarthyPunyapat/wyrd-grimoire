import type { CharacterSheet } from "@wyrd/core";

/** Max HP after wounds: derived hpMax minus every wound's hpMaxReduction, never below 0. */
export function effectiveHpMax(sheet: CharacterSheet): number {
  const reduction = sheet.status.wounds.reduce((sum, w) => sum + w.hpMaxReduction, 0);
  return Math.max(0, sheet.derived.hpMax - reduction);
}

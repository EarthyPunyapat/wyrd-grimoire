import type { ArmorDef, BodyPlanDef, Tuning, WoundSeverity } from "@wyrd/core";

/** A wound severity a hit can cause; lethal is reached only through a lethal check or a repeat critical. */
export type HitSeverity = Exclude<WoundSeverity, "lethal">;

/** The body location a d100 roll lands on. A roll outside every band means the plan is broken. */
export function locationFor(plan: BodyPlanDef, roll: number): BodyPlanDef["locations"][number] {
  const found = plan.locations.find((l) => roll >= l.from && roll <= l.to);
  if (!found) throw new RangeError(`Body plan ${plan.id} has no location for a roll of ${roll}`);
  return found;
}

/** Protection at one location: the sum of the best `maxLayers` pieces that cover it. */
export function protectionAt(
  worn: ArmorDef[],
  locationId: string,
  damageType: string,
  maxLayers: number,
): number {
  return worn
    .filter((a) => a.covers.includes(locationId))
    .map((a) => a.protection[damageType] ?? 0)
    .sort((a, b) => b - a)
    .slice(0, maxLayers)
    .reduce((sum, p) => sum + p, 0);
}

/**
 * Spec 03, attacks 5–6: a critical divides protection (round down), armour piercing comes off what
 * is left (minimum 0), and the location multiplier scales the remainder (round down).
 * Returns the protection after the critical, before armour piercing.
 */
export function computeDamage(
  i: { raw: number; protection: number; armorPiercing: number; crit: boolean; multiplier: number },
  t: Tuning["combat"],
): { protection: number; final: number } {
  const protection = i.crit ? Math.floor(i.protection / t.critArmourDivisor) : i.protection;
  const effective = Math.max(0, protection - i.armorPiercing);
  return { protection, final: Math.floor(Math.max(0, i.raw - effective) * i.multiplier) };
}

/**
 * The wound a hit's final damage causes (spec 03, Wounds), or null below the threshold. A Down
 * actor wounds on any damaging hit, one severity worse (a hit below WT is Minor), capped at Critical.
 */
export function woundSeverity(
  final: number,
  wt: number,
  wasDown: boolean,
  t: Tuning["combat"],
): HitSeverity | null {
  if (final <= 0) return null;
  const m = t.woundThresholdMultiples;
  const base: HitSeverity | null =
    final >= wt * m.critical
      ? "critical"
      : final >= wt * m.serious
        ? "serious"
        : final >= wt * m.minor
          ? "minor"
          : null;
  if (!wasDown) return base;
  if (base === null) return "minor";
  return base === "minor" ? "serious" : "critical";
}

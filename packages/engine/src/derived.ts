import type { Attributes, DerivedStats, Tuning } from "@wyrd/core";

export function deriveStats(a: Attributes, tuning: Tuning): DerivedStats {
  const t = tuning.derived;
  return {
    hpMax: t.hpBase + a.end * t.hpPerEnd,
    wt: a.end + Math.floor(a.str / 2),
    carryKg: a.str * t.carryKgPerStr,
    initiative: a.agi * t.initiativePerAgi + a.awa * t.initiativePerAwa,
    composure: t.composureBase + a.wil * t.composurePerWil,
  };
}

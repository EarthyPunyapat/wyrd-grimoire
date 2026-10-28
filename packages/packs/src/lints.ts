import { ATTRIBUTE_IDS, averageDice, type CompiledPack, defaultTuning } from "@wyrd/core";
import type { PackIssue } from "./loader.ts";

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Average of a dice expression like "2d6+1". */
export function averageDamage(expr: string): number {
  return averageDice(expr);
}

/**
 * Balance lints: rules-legal archetypes (errors) and outliers worth a second look (warnings).
 * Thresholds are deliberately loose; they catch typos like "1d80" or a 5000-coin dagger.
 */
export function lintPack(
  pack: CompiledPack,
  where: (id: string) => { file: string; path: string },
): PackIssue[] {
  const issues: PackIssue[] = [];
  const at = (id: string, sub: string) => {
    const o = where(id);
    return { file: o.file, path: `${o.path}.${sub}` };
  };
  const c = defaultTuning.creation;

  for (const a of Object.values(pack.archetypes)) {
    let spent = 0;
    for (const id of ATTRIBUTE_IDS) {
      const v = a.suggestedAttributes[id];
      if (v < c.attributeStart || v > c.attributeMax) {
        issues.push({
          severity: "error",
          code: "ARCHETYPE_ATTRIBUTE_ILLEGAL",
          ...at(a.id, `suggestedAttributes.${id}`),
          message: `${a.name}: ${id} ${v} is outside the creation range ${c.attributeStart}–${c.attributeMax}`,
        });
      }
      spent += v - c.attributeStart;
    }
    if (spent !== c.attributePoints) {
      issues.push({
        severity: "error",
        code: "ARCHETYPE_ATTRIBUTE_POINTS",
        ...at(a.id, "suggestedAttributes"),
        message: `${a.name} spends ${spent} attribute points; the budget is exactly ${c.attributePoints}`,
      });
    }
    const pool = c.corePoints + c.interestPoints;
    const perSkill = c.coreMaxPerSkill + c.interestMaxPerSkill;
    const total = Object.values(a.skills).reduce((s, v) => s + v, 0);
    if (total > pool) {
      issues.push({
        severity: "error",
        code: "ARCHETYPE_SKILL_POINTS",
        ...at(a.id, "skills"),
        message: `${a.name} spends ${total} skill points; ${pool} available`,
      });
    }
    for (const [skill, v] of Object.entries(a.skills)) {
      if (v > perSkill) {
        issues.push({
          severity: "error",
          code: "ARCHETYPE_SKILL_ABOVE_MAX",
          ...at(a.id, `skills.${skill}`),
          message: `${a.name}: +${v} in ${skill}; at most +${perSkill} at creation`,
        });
      }
    }
    const talent = pack.talents[a.talent];
    if (talent && talent.tier !== 1) {
      issues.push({
        severity: "warning",
        code: "ARCHETYPE_TALENT_TIER",
        ...at(a.id, "talent"),
        message: `${a.name} starts with a tier ${talent.tier} talent`,
      });
    }
  }

  const weapons = Object.values(pack.items.weapons);
  for (const w of weapons) {
    if (Object.keys(w.ranges).length === 0) {
      issues.push({
        severity: "error",
        code: "WEAPON_NO_RANGE",
        ...at(w.id, "ranges"),
        message: `${w.name} works at no range band`,
      });
    }
  }
  if (weapons.length >= 4) {
    const med = median(weapons.map((w) => averageDamage(w.damage)));
    for (const w of weapons) {
      const avg = averageDamage(w.damage);
      if (avg > med * 2.5 || avg < med * 0.4) {
        issues.push({
          severity: "warning",
          code: "WEAPON_DAMAGE_OUTLIER",
          ...at(w.id, "damage"),
          message: `${w.name} averages ${avg} damage; the pack's median is ${med}`,
        });
      }
    }
  }

  for (const [category, items] of Object.entries(pack.items)) {
    const list = Object.values(items) as { id: string; name: string; price: number; tags: string[] }[];
    if (list.length < 3) continue;
    const med = median(list.map((i) => i.price).filter((p) => p > 0));
    for (const i of list) {
      if (i.price === 0 && category !== "gear" && !i.tags.includes("natural")) {
        issues.push({
          severity: "warning",
          code: "PRICE_ZERO",
          ...at(i.id, "price"),
          message: `${i.name} costs nothing`,
        });
      } else if (med > 0 && i.price > med * 20) {
        issues.push({
          severity: "warning",
          code: "PRICE_OUTLIER",
          ...at(i.id, "price"),
          message: `${i.name} costs ${i.price}, over 20× the ${category} median (${med})`,
        });
      }
    }
  }

  for (const a of Object.values(pack.items.armor)) {
    for (const [type, v] of Object.entries(a.protection)) {
      if (v > 12) {
        issues.push({
          severity: "warning",
          code: "ARMOR_PROTECTION_OUTLIER",
          ...at(a.id, `protection.${type}`),
          message: `${a.name} gives ${v} ${type} protection; plate is about 8`,
        });
      }
    }
  }
  return issues;
}

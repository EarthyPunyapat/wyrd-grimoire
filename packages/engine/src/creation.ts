import {
  type AncestryDef,
  type ArchetypeDef,
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  type Attributes,
  type CampaignSettings,
  CharacterSheet,
  type CharacterSheetInput,
  type TalentDef,
  type Tuning,
} from "@wyrd/core";
import { deriveStats } from "./derived.ts";
import { luckMax } from "./luck.ts";
import type { RuleError } from "./result.ts";
import { CORE_SKILL_CATALOG, lookupSkill, type SkillCatalog, skillValue } from "./skills.ts";

/** Translate generated preferences into training under the same budgets as authored characters. */
export function allocateStartingTraining(
  priority: readonly (keyof Attributes)[],
  skillIds: readonly string[],
  tuning: Tuning,
): Pick<ArchetypeDef, "suggestedAttributes" | "skills"> {
  if (
    priority.length !== ATTRIBUTE_IDS.length ||
    new Set(priority).size !== ATTRIBUTE_IDS.length ||
    priority.some((id) => !ATTRIBUTE_IDS.includes(id)) ||
    skillIds.length !== 6 ||
    new Set(skillIds).size !== 6
  )
    throw new Error("Choose seven distinct attributes and six distinct skills");
  for (const id of skillIds) {
    const skill = lookupSkill(id, CORE_SKILL_CATALOG);
    if (skill.field) throw new Error("Generated starting training requires non-field core skills");
  }
  const c = tuning.creation;
  const attributes = Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, c.attributeStart])) as Attributes;
  for (let point = 0; point < c.attributePoints; point++) {
    const candidates = priority.filter((id) => attributes[id] < c.attributeMax);
    candidates.sort(
      (a, b) =>
        (attributes[a] - c.attributeStart) / (priority.length - priority.indexOf(a)) -
        (attributes[b] - c.attributeStart) / (priority.length - priority.indexOf(b)),
    );
    if (!candidates[0]) throw new Error("The configured attribute pool exceeds starting capacity");
    attributes[candidates[0]]++;
  }
  const skills = Object.fromEntries(skillIds.map((id) => [id, 0]));
  for (const [pool, cap] of [
    [c.corePoints, c.coreMaxPerSkill],
    [c.interestPoints, c.interestMaxPerSkill],
  ]) {
    if (pool! > cap! * skillIds.length)
      throw new Error("The configured skill pool exceeds starting capacity");
    skillIds.forEach((id, i) => {
      skills[id] = skills[id]! + Math.floor(pool! / skillIds.length) + (i < pool! % skillIds.length ? 1 : 0);
    });
  }
  return { suggestedAttributes: attributes, skills };
}

/** Pack content the creation rules need, with full namespaced IDs. */
export type CreationContent = {
  skills: SkillCatalog;
  talents: Record<string, Omit<TalentDef, "id"> & { id: string }>;
  ancestries: Record<string, Omit<AncestryDef, "id"> & { id: string }>;
  archetypes: Record<string, Omit<ArchetypeDef, "id"> & { id: string }>;
};

export type SheetDraft = Omit<CharacterSheetInput, "derived" | "status"> & {
  status?: Partial<CharacterSheetInput["status"]>;
};

/** Fills in derived stats and a fresh status (full HP, full Luck) from a draft sheet. */
export function buildSheet(input: SheetDraft, settings: CampaignSettings, tuning: Tuning): CharacterSheet {
  const derived = deriveStats(input.attributes as Attributes, tuning);
  return CharacterSheet.parse({
    ...input,
    derived,
    status: { hp: derived.hpMax, luck: luckMax(settings, tuning), ...input.status },
  });
}

export type CreationIssue = RuleError & { severity: "error" | "warning" };

/**
 * Validates a new character against the creation budget (spec 04) and reports exactly which rule
 * each problem breaks. Warnings (unspent points) don't block; errors do.
 */
export function validateCreation(
  sheet: CharacterSheet,
  content: CreationContent,
  settings: CampaignSettings,
  tuning: Tuning,
): CreationIssue[] {
  const issues: CreationIssue[] = [];
  const err = (code: string, path: string, message: string) =>
    issues.push({ code, path, message, severity: "error" });
  const warn = (code: string, path: string, message: string) =>
    issues.push({ code, path, message, severity: "warning" });
  const c = tuning.creation;

  // Ancestry and archetype.
  const ancestry = content.ancestries[sheet.identity.ancestry];
  if (!ancestry) err("ANCESTRY_UNKNOWN", "identity.ancestry", `Unknown ancestry ${sheet.identity.ancestry}`);
  const archetype = sheet.archetypeId ? content.archetypes[sheet.archetypeId] : undefined;
  if (sheet.archetypeId && !archetype)
    err("ARCHETYPE_UNKNOWN", "archetypeId", `Unknown archetype ${sheet.archetypeId}`);

  // Attributes: start at 3, 18 points, max 7 (8 with an ancestry trait).
  let spent = 0;
  for (const id of ATTRIBUTE_IDS) {
    const v = sheet.attributes[id];
    const max = ancestry?.attributeMaxBonus.includes(id) ? c.attributeMaxWithTrait : c.attributeMax;
    if (v < c.attributeStart) {
      err(
        "ATTR_BELOW_START",
        `attributes.${id}`,
        `${ATTRIBUTE_NAMES[id]} ${v} is below the starting ${c.attributeStart}`,
      );
    }
    if (v > max)
      err(
        "ATTR_ABOVE_MAX",
        `attributes.${id}`,
        `${ATTRIBUTE_NAMES[id]} ${v} is above the creation max ${max}`,
      );
    spent += v - c.attributeStart;
  }
  if (spent > c.attributePoints) {
    err(
      "ATTR_POINTS_OVERSPENT",
      "attributes",
      `${spent} attribute points spent, ${c.attributePoints} available`,
    );
  } else if (spent < c.attributePoints) {
    warn("ATTR_POINTS_UNSPENT", "attributes", `${c.attributePoints - spent} attribute points unspent`);
  }

  // Skills: core and interest pools. The sheet stores only totals, so check that some split
  // into core (≤ coreMaxPerSkill each, ≤ corePoints total) and interest (≤ interestMaxPerSkill,
  // ≤ interestPoints) exists. With two pools this reduces to three sums.
  const perSkillMax = c.coreMaxPerSkill + c.interestMaxPerSkill;
  let total = 0;
  let needInterest = 0;
  let needCore = 0;
  for (const [id, { trained }] of Object.entries(sheet.skills)) {
    const path = `skills.${id}`;
    try {
      lookupSkill(id, content.skills);
    } catch (e) {
      err("SKILL_UNKNOWN", path, (e as Error).message);
      continue;
    }
    if (trained > perSkillMax) {
      err("SKILL_ABOVE_CREATION_MAX", path, `+${trained} in ${id}; at most +${perSkillMax} at creation`);
    }
    total += trained;
    needInterest += Math.max(0, trained - c.coreMaxPerSkill);
    needCore += Math.max(0, trained - c.interestMaxPerSkill);
  }
  const pool = c.corePoints + c.interestPoints;
  if (total > pool) {
    err(
      "SKILL_POINTS_OVERSPENT",
      "skills",
      `${total} skill points spent, ${pool} available (${c.corePoints} core + ${c.interestPoints} interest)`,
    );
  }
  if (needInterest > c.interestPoints) {
    err(
      "SKILL_INTEREST_POINTS_OVERSPENT",
      "skills",
      `Skills above +${c.coreMaxPerSkill} need ${needInterest} interest points; ${c.interestPoints} available`,
    );
  }
  if (needCore > c.corePoints) {
    err(
      "SKILL_CORE_POINTS_OVERSPENT",
      "skills",
      `Skills above +${c.interestMaxPerSkill} need ${needCore} core points; ${c.corePoints} available`,
    );
  }
  if (total < pool) warn("SKILL_POINTS_UNSPENT", "skills", `${pool - total} skill points unspent`);

  // Talents: one from the archetype plus free picks, with prerequisites.
  const maxTalents = c.archetypeTalents + c.freeTalents;
  if (new Set(sheet.talents).size !== sheet.talents.length)
    err("TALENT_DUPLICATE", "talents", "A talent is listed twice");
  if (sheet.talents.length > maxTalents) {
    err("TALENT_TOO_MANY", "talents", `${sheet.talents.length} talents; at most ${maxTalents} at creation`);
  }
  if (archetype && !sheet.talents.includes(archetype.talent)) {
    err("TALENT_ARCHETYPE_MISSING", "talents", `The ${archetype.name} archetype grants ${archetype.talent}`);
  }
  for (const id of sheet.talents) {
    const t = content.talents[id];
    if (!t) {
      err("TALENT_UNKNOWN", "talents", `Unknown talent ${id}`);
      continue;
    }
    for (const [attr, min] of Object.entries(t.prerequisites.attributes)) {
      const have = sheet.attributes[attr as keyof Attributes];
      if (have < (min ?? 0)) {
        err(
          "TALENT_PREREQ_UNMET",
          "talents",
          `${t.name} needs ${ATTRIBUTE_NAMES[attr as keyof Attributes]} ${min}`,
        );
      }
    }
    for (const [skill, min] of Object.entries(t.prerequisites.skills)) {
      let have = 0;
      try {
        have = skillValue(sheet, skill, content.skills, tuning);
      } catch {
        // An unknown skill in a prerequisite is a pack error, reported by pack validate.
      }
      if (have < min) err("TALENT_PREREQ_UNMET", "talents", `${t.name} needs ${skill} ${min}%`);
    }
    for (const req of t.prerequisites.talents) {
      if (!sheet.talents.includes(req))
        err("TALENT_PREREQ_UNMET", "talents", `${t.name} needs the talent ${req}`);
    }
  }

  // Derived stats and starting status must match the rules.
  const derived = deriveStats(sheet.attributes, tuning);
  for (const key of ["hpMax", "wt", "carryKg", "initiative"] as const) {
    if (sheet.derived[key] !== derived[key]) {
      err(
        "DERIVED_MISMATCH",
        `derived.${key}`,
        `${key} is ${sheet.derived[key]}, rules give ${derived[key]}`,
      );
    }
  }
  if (sheet.status.hp !== derived.hpMax)
    err("STATUS_HP", "status.hp", `A new character starts at full HP (${derived.hpMax})`);
  const luck = luckMax(settings, tuning);
  if (sheet.status.luck !== luck)
    err("STATUS_LUCK", "status.luck", `A new character starts with full Luck (${luck})`);

  return issues;
}

export const hasErrors = (issues: CreationIssue[]): boolean => issues.some((i) => i.severity === "error");

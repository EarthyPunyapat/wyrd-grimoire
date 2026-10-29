import {
  type AncestryDef,
  type ArchetypeDef,
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  type Attributes,
  type CampaignSettings,
  CharacterSheet,
  type CharacterSheetInput,
  type DraftSheet,
  type ItemCatalog,
  localIdOf,
  type PregenDef,
  type SessionZeroProposals,
  type TalentDef,
  type Tuning,
} from "@wyrd/core";
import { deriveStats } from "./derived.ts";
import { startingEquipment } from "./equipment.ts";
import { type ClassCatalog, classForArchetype } from "./classes.ts";
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
  /** Class data for class campaigns (spec 04); empty when the pack has none. */
  classes?: ClassCatalog;
};

/**
 * A draft sheet. `bodyPlan` is the ancestry's resolved plan (callers copy `ancestry.bodyPlan`); it
 * defaults to the plain "humanoid" when omitted.
 */
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
  // Plans are compared by local id, as findBodyPlan matches them, so a plain "humanoid" matches "core:humanoid".
  if (ancestry && localIdOf(sheet.bodyPlan) !== localIdOf(ancestry.bodyPlan))
    err(
      "BODYPLAN_MISMATCH",
      "bodyPlan",
      `The ${ancestry.name} ancestry uses the ${ancestry.bodyPlan} body plan, not ${sheet.bodyPlan}`,
    );
  const archetype = sheet.archetypeId ? content.archetypes[sheet.archetypeId] : undefined;
  if (sheet.archetypeId && !archetype)
    err("ARCHETYPE_UNKNOWN", "archetypeId", `Unknown archetype ${sheet.archetypeId}`);

  // Class campaigns need pack class data and a class on the sheet (spec 04).
  if (settings.structural.progression === "classes") {
    const classes = content.classes ?? {};
    if (!Object.keys(classes).length)
      err("CLASSES_UNAVAILABLE", "progression", "This pack has no classes, so class mode isn't available");
    for (const classId of Object.keys(sheet.progression.classLevels))
      if (!classes[classId]) err("CLASS_UNKNOWN", "progression.classLevels", `Unknown class ${classId}`);
    if (!Object.keys(sheet.progression.classLevels).length)
      err("CLASS_MISSING", "progression.classLevels", "Choose a class");
  }

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
    for (const problem of talentProblems(sheet, t, content, tuning))
      err("TALENT_PREREQ_UNMET", "talents", problem);
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

/** Why a sheet can't take a talent yet: each unmet prerequisite, in words (empty when it can). */
export function talentProblems(
  sheet: CharacterSheet,
  t: CreationContent["talents"][string],
  content: CreationContent,
  tuning: Tuning,
): string[] {
  const problems: string[] = [];
  for (const [attr, min] of Object.entries(t.prerequisites.attributes)) {
    if (sheet.attributes[attr as keyof Attributes] < (min ?? 0))
      problems.push(`${t.name} needs ${ATTRIBUTE_NAMES[attr as keyof Attributes]} ${min}`);
  }
  for (const [skill, min] of Object.entries(t.prerequisites.skills)) {
    let have = 0;
    try {
      have = skillValue(sheet, skill, content.skills, tuning);
    } catch {
      // An unknown skill in a prerequisite is a pack error, reported by pack validate.
    }
    if (have < min) problems.push(`${t.name} needs ${skill} ${min}%`);
  }
  for (const req of t.prerequisites.talents)
    if (!sheet.talents.includes(req)) problems.push(`${t.name} needs the talent ${req}`);
  return problems;
}

export const hasErrors = (issues: CreationIssue[]): boolean => issues.some((i) => i.severity === "error");

type Archetype = CreationContent["archetypes"][string];

/** A draft from an origin and an archetype: its suggested attributes, skills and talent (spec 04). */
export function draftFromArchetype(ancestry: string, archetype: Archetype, name = ""): DraftSheet {
  return {
    name,
    pronouns: "",
    ancestry,
    archetype: archetype.id,
    attributes: { ...archetype.suggestedAttributes } as Attributes,
    skills: { ...archetype.skills },
    talents: [archetype.talent],
    appearance: { marks: [] },
    background: archetype.description,
    personality: [],
    backstory: "",
    hooks: [],
  };
}

/** A pregenerated character's draft: the archetype's numbers plus the pregen's person. */
export function draftFromPregen(pregen: PregenDef, archetype: Archetype): DraftSheet {
  const base = draftFromArchetype(pregen.ancestry, archetype, pregen.name);
  return {
    ...base,
    pronouns: pregen.pronouns,
    talents: pregen.freeTalent ? [archetype.talent, pregen.freeTalent] : base.talents,
    appearance: pregen.appearance,
    personality: pregen.personality,
    backstory: pregen.backstory,
    hooks: pregen.hooks,
  };
}

/**
 * The sheet a draft describes: derived stats, a fresh status and the archetype's kit. It isn't
 * validated here; `validateCreation` reports what's wrong. Unknown origins and archetypes build
 * anyway (plain humanoid, no kit) so the editor can show the error beside the rest of the sheet.
 */
export function sheetFromDraft(
  id: string,
  draft: DraftSheet,
  content: CreationContent,
  items: ItemCatalog,
  settings: CampaignSettings,
  tuning: Tuning,
): CharacterSheet {
  const archetype = content.archetypes[draft.archetype];
  // Class campaigns start at level 1 in the class their background maps to (spec 04).
  const classDef =
    settings.structural.progression === "classes"
      ? classForArchetype(draft.archetype, content.classes ?? {})
      : undefined;
  return buildSheet(
    {
      id,
      identity: {
        name: draft.name || "Unnamed",
        ...(draft.pronouns ? { pronouns: draft.pronouns } : {}),
        ancestry: draft.ancestry,
        appearance: draft.appearance,
        background: draft.background,
        personality: draft.personality,
        backstory: draft.backstory,
      },
      bodyPlan: content.ancestries[draft.ancestry]?.bodyPlan ?? "humanoid",
      archetypeId: draft.archetype,
      attributes: draft.attributes,
      skills: Object.fromEntries(Object.entries(draft.skills).map(([sk, trained]) => [sk, { trained }])),
      talents: draft.talents,
      ...(classDef ? { progression: { classLevels: { [classDef.id]: 1 } } } : {}),
      equipment: startingEquipment(archetype?.kit ?? [], items),
    },
    settings,
    tuning,
  );
}

/** Which validator paths belong to each part of a proposal. */
const PROPOSAL_PATHS: Record<keyof SessionZeroProposals, (path: string) => boolean> = {
  identity: (p) =>
    p.startsWith("identity") || p === "archetypeId" || p === "bodyPlan" || p.startsWith("attributes"),
  attributes: (p) => p.startsWith("attributes") || p === "talents",
  skills: (p) => p.startsWith("skills") || p === "talents",
  talents: (p) => p === "talents",
  appearance: () => false,
  hooks: () => false,
};

/**
 * Applies session-zero proposals part by part (spec 04): a part that would break a creation rule it
 * touches is refused and reported, and the rest still apply. Unknown origins, backgrounds, skills
 * and talents are refused by the same check.
 */
export function applyProposals(
  draft: DraftSheet,
  proposals: SessionZeroProposals,
  content: CreationContent,
  items: ItemCatalog,
  settings: CampaignSettings,
  tuning: Tuning,
): { draft: DraftSheet; refused: string[] } {
  const refused: string[] = [];
  const errors = (d: DraftSheet) =>
    validateCreation(
      sheetFromDraft("pc", d, content, items, settings, tuning),
      content,
      settings,
      tuning,
    ).filter((i) => i.severity === "error");
  let current = draft;
  for (const part of ["identity", "attributes", "skills", "talents", "appearance", "hooks"] as const) {
    const value = proposals[part];
    if (!value) continue;
    let next: DraftSheet;
    switch (part) {
      case "identity": {
        const v = value as NonNullable<SessionZeroProposals["identity"]>;
        const archetype = v.archetype ? content.archetypes[v.archetype] : undefined;
        if (v.archetype && !archetype) {
          refused.push(`identity: unknown background ${v.archetype}`);
          continue;
        }
        next =
          archetype && archetype.id !== current.archetype
            ? { ...draftFromArchetype(current.ancestry, archetype), ...pick(current) }
            : current;
        next = {
          ...next,
          ...(v.name ? { name: v.name } : {}),
          ...(v.pronouns !== undefined ? { pronouns: v.pronouns } : {}),
          ...(v.ancestry ? { ancestry: v.ancestry } : {}),
          ...(v.personality ? { personality: v.personality } : {}),
          ...(v.backstory !== undefined ? { backstory: v.backstory } : {}),
        };
        break;
      }
      case "attributes":
        next = { ...current, attributes: { ...current.attributes, ...(value as Partial<Attributes>) } };
        break;
      case "skills":
        next = { ...current, skills: { ...(value as Record<string, number>) } };
        break;
      case "talents": {
        const background = content.archetypes[current.archetype]?.talent;
        next = {
          ...current,
          talents: [
            ...(background ? [background] : []),
            ...(value as string[]).filter((t) => t !== background),
          ],
        };
        break;
      }
      case "appearance": {
        const v = value as NonNullable<SessionZeroProposals["appearance"]>;
        next = {
          ...current,
          appearance: { ...current.appearance, ...v, marks: v.marks ?? current.appearance.marks },
        };
        break;
      }
      case "hooks":
        next = { ...current, hooks: value as DraftSheet["hooks"] };
        break;
    }
    const before = new Set(errors(current).map((i) => `${i.code}:${i.path}`));
    const added = errors(next).filter(
      (i) => PROPOSAL_PATHS[part](i.path ?? "") && !before.has(`${i.code}:${i.path}`),
    );
    if (added.length) refused.push(`${part}: ${added.map((i) => i.message).join("; ")}`);
    else current = next;
  }
  return { draft: current, refused };
}

/** The person-level fields a background change keeps. */
const pick = (d: DraftSheet) => ({
  name: d.name,
  pronouns: d.pronouns,
  appearance: d.appearance,
  personality: d.personality,
  backstory: d.backstory,
  hooks: d.hooks,
});

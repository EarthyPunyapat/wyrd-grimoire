import type { AttributeId, Attributes, SkillDef, Tuning } from "@wyrd/core";

/** A skill definition with its full namespaced ID. */
export type SkillEntry = Omit<SkillDef, "id"> & { id: string };
export type SkillCatalog = Record<string, SkillEntry>;

const core = (
  id: string,
  name: string,
  group: SkillDef["group"],
  attributes: AttributeId[],
  field = false,
): SkillEntry => ({ id: `core:${id}`, name, group, attributes, field, fields: [], description: "" });

/** The core skills every pack shares (spec 02). Packs add their own on top. */
export const CORE_SKILLS: readonly SkillEntry[] = [
  core("melee", "Melee", "combat", ["str", "agi"]),
  core("ranged", "Ranged", "combat", ["agi"]),
  core("unarmed", "Unarmed", "combat", ["str", "agi"]),
  core("dodge", "Dodge", "combat", ["agi"]),
  core("throwing", "Throwing", "combat", ["agi"]),
  core("athletics", "Athletics", "physical", ["str"]),
  core("acrobatics", "Acrobatics", "physical", ["agi"]),
  core("stealth", "Stealth", "physical", ["agi"]),
  core("sleight-of-hand", "Sleight of Hand", "physical", ["agi"]),
  core("riding", "Riding / Driving", "physical", ["agi"], true),
  core("perception", "Perception", "senses", ["awa"]),
  core("insight", "Insight", "senses", ["awa"]),
  core("survival", "Survival", "senses", ["awa"]),
  core("navigation", "Navigation", "senses", ["int", "awa"]),
  core("persuasion", "Persuasion", "social", ["pre"]),
  core("deception", "Deception", "social", ["pre"]),
  core("intimidation", "Intimidation", "social", ["pre", "str"]),
  core("performance", "Performance", "social", ["pre"], true),
  core("streetwise", "Streetwise", "social", ["pre", "awa"]),
  core("lore", "Lore", "knowledge", ["int"], true),
  core("investigation", "Investigation", "knowledge", ["int"]),
  core("medicine", "Medicine", "knowledge", ["int"]),
  core("mechanics", "Mechanics", "knowledge", ["int"]),
  core("craft", "Craft", "knowledge", ["int", "agi"], true),
  core("language", "Language", "knowledge", ["int"], true),
];

export const CORE_SKILL_CATALOG: SkillCatalog = Object.fromEntries(CORE_SKILLS.map((s) => [s.id, s]));

/** Splits `core:lore/history` into its base skill and field specialisation. */
export function parseSkillId(skillId: string): { base: string; field: string | undefined } {
  const slash = skillId.indexOf("/");
  return slash === -1
    ? { base: skillId, field: undefined }
    : { base: skillId.slice(0, slash), field: skillId.slice(slash + 1) };
}

/** Looks up a skill (or field specialisation) and checks the ID is well-formed for it. */
export function lookupSkill(skillId: string, catalog: SkillCatalog): SkillEntry {
  const { base, field } = parseSkillId(skillId);
  const def = catalog[base];
  if (!def) throw new Error(`Unknown skill: ${skillId}`);
  if (def.field && field === undefined) {
    throw new Error(`${def.name} is a field skill and needs a specialisation, e.g. ${base}/history`);
  }
  if (!def.field && field !== undefined) throw new Error(`${def.name} is not a field skill: ${skillId}`);
  return def;
}

/** The governing attribute: with two, the higher (ties go to the first listed). */
export function governingAttribute(attributes: Attributes, def: SkillEntry): AttributeId {
  let best = def.attributes[0]!;
  for (const a of def.attributes) if (attributes[a] > attributes[best]) best = a;
  return best;
}

export type SkillHolder = { attributes: Attributes; skills: Record<string, { trained: number }> };

/** Skill value on the canonical 0–100 scale: untrained (attribute × 3) + trained, capped at 99. */
export function skillValue(
  holder: SkillHolder,
  skillId: string,
  catalog: SkillCatalog,
  tuning: Tuning,
): number {
  const def = lookupSkill(skillId, catalog);
  const untrained =
    holder.attributes[governingAttribute(holder.attributes, def)] * tuning.untrainedMultiplier;
  const trained = holder.skills[skillId]?.trained ?? 0;
  return Math.min(tuning.skillCap, untrained + trained);
}

export function skillLabel(skillId: string, catalog: SkillCatalog): string {
  const def = lookupSkill(skillId, catalog);
  const { field } = parseSkillId(skillId);
  return field ? `${def.name} (${titleCase(field)})` : def.name;
}

function titleCase(s: string): string {
  return s
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

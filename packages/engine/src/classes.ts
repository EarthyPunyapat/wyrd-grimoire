import { type CharacterSheet, type ClassDef, type ClassLevel, localIdOf } from "@wyrd/core";

/** Classes compiled from a campaign's packs, by namespaced ID. */
export type ClassCatalog = Record<string, ClassDef & { id: string }>;

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

/** Every class in the catalog, in a stable order. */
export const classList = (classes: ClassCatalog): (ClassDef & { id: string })[] =>
  Object.values(classes).sort(byId);

/**
 * The class a background maps to (spec 04: "In class mode, archetypes map to classes"). Exact
 * matches win, then local IDs, then the first class in the pack so every class campaign has one.
 */
export function classForArchetype(
  archetypeId: string | undefined,
  classes: ClassCatalog,
): (ClassDef & { id: string }) | undefined {
  const list = classList(classes);
  if (!list.length) return undefined;
  if (archetypeId) {
    const exact = list.find((c) => c.archetypes.includes(archetypeId));
    if (exact) return exact;
    const local = localIdOf(archetypeId);
    const loose = list.find((c) => c.archetypes.some((a) => localIdOf(a) === local));
    if (loose) return loose;
  }
  return list[0];
}

/** Whether a skill belongs to a class. A field skill in the class list covers every specialisation. */
export function isClassSkill(def: ClassDef, skillId: string): boolean {
  const [skillBase, skillField] = skillId.split("/") as [string, string | undefined];
  return def.skills.some((ref) => {
    const [refBase, refField] = ref.split("/") as [string, string | undefined];
    if (refBase !== skillBase) return false;
    return refField === undefined || refField === skillField;
  });
}

/** The highest level whose XP threshold the total has reached. */
export function levelAtXp(def: ClassDef, totalXp: number): number {
  let level = 1;
  for (const row of def.levels) if (row.xp <= totalXp && row.level > level) level = row.level;
  return level;
}

/** The next row in the level table, or null at the top. */
export function nextClassLevel(def: ClassDef, level: number): ClassLevel | null {
  return def.levels.find((row) => row.level > level) ?? null;
}

/** The class with the highest level on the sheet (ties go by ID), with its level. */
export function primaryClass(
  sheet: CharacterSheet,
  classes: ClassCatalog,
): { def: ClassDef & { id: string }; level: number } | null {
  const entries = Object.entries(sheet.progression.classLevels)
    .filter(([id]) => classes[id])
    .sort(([a, la], [b, lb]) => lb - la || a.localeCompare(b));
  const first = entries[0];
  return first ? { def: classes[first[0]]!, level: first[1] } : null;
}

/** XP progress inside the current class level, for the Party tab. */
export function classProgress(def: ClassDef, totalXp: number) {
  const level = levelAtXp(def, totalXp);
  const current = def.levels.find((row) => row.level === level) ?? def.levels[0]!;
  const next = nextClassLevel(def, level);
  return {
    level,
    xpIntoLevel: totalXp - current.xp,
    xpForNext: next ? next.xp - totalXp : null,
  };
}

/** Class training points still unspent, summed over every pending level grant. */
export function pendingClassPoints(sheet: CharacterSheet): {
  classSkillPoints: number;
  anySkillPoints: number;
} {
  return sheet.progression.pendingClassGrants.reduce(
    (sum, grant) => ({
      classSkillPoints: sum.classSkillPoints + grant.classSkillPoints,
      anySkillPoints: sum.anySkillPoints + grant.anySkillPoints,
    }),
    { classSkillPoints: 0, anySkillPoints: 0 },
  );
}

import { updateSheet } from "./helpers.ts";
import type { Handlers } from "./types.ts";

/**
 * Class-progression event handlers (M7). The events carry their grants, so the reducer needs no
 * pack data: replaying the log rebuilds levels, features and pending training exactly.
 */
export const classHandlers = {
  ClassLevelGained: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => {
      const p = sheet.progression;
      const { classId, level } = e.payload;
      // A repeated event for the same level changes nothing (rebuilds apply each event once).
      if ((p.classLevels[classId] ?? 0) >= level) return sheet;
      const grants =
        e.payload.classSkillPoints > 0 || e.payload.anySkillPoints > 0
          ? [
              ...p.pendingClassGrants,
              {
                classId,
                level,
                classSkillPoints: e.payload.classSkillPoints,
                anySkillPoints: e.payload.anySkillPoints,
                spent: {},
              },
            ]
          : p.pendingClassGrants;
      const features = e.payload.features.map((f) => ({
        classId,
        level,
        name: f.name,
        description: f.description,
      }));
      const talents = e.payload.features.flatMap((f) => (f.talent ? [f.talent] : []));
      return {
        ...sheet,
        talents: talents.length ? [...new Set([...sheet.talents, ...talents])] : sheet.talents,
        progression: {
          ...p,
          classLevels: { ...p.classLevels, [classId]: level },
          pendingClassGrants: grants,
          classFeatures: [...p.classFeatures, ...features],
          pendingAttributes: p.pendingAttributes + e.payload.attributes,
        },
      };
    }),

  ClassTrainingSpent: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => {
      const { classId, level, pool, skillId, amount } = e.payload;
      const p = sheet.progression;
      const index = p.pendingClassGrants.findIndex((g) => g.classId === classId && g.level === level);
      const grant = p.pendingClassGrants[index];
      if (!grant) throw new Error(`No pending class grant for ${classId} level ${level}`);
      const left = pool === "class" ? grant.classSkillPoints : grant.anySkillPoints;
      if (left < amount)
        throw new Error(`Class grant for ${classId} level ${level} has ${left} points, not ${amount}`);
      const updated = {
        ...grant,
        classSkillPoints: pool === "class" ? grant.classSkillPoints - amount : grant.classSkillPoints,
        anySkillPoints: pool === "any" ? grant.anySkillPoints - amount : grant.anySkillPoints,
        spent: { ...grant.spent, [skillId]: (grant.spent[skillId] ?? 0) + amount },
      };
      const empty = updated.classSkillPoints === 0 && updated.anySkillPoints === 0;
      const grants = empty
        ? p.pendingClassGrants.filter((_, i) => i !== index)
        : p.pendingClassGrants.map((g, i) => (i === index ? updated : g));
      return {
        ...sheet,
        skills: {
          ...sheet.skills,
          [skillId]: { trained: (sheet.skills[skillId]?.trained ?? 0) + amount },
        },
        progression: { ...p, pendingClassGrants: grants },
      };
    }),
} satisfies Pick<Handlers, "ClassLevelGained" | "ClassTrainingSpent">;

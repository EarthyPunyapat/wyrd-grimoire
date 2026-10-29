import {
  type ActorId,
  ATTRIBUTE_IDS,
  type AttributeId,
  type CharacterSheet,
  type CheckResolvedPayload,
  draft,
  type EventDraft,
  Rng,
  type Tuning,
} from "@wyrd/core";
import { type CreationContent, talentProblems } from "./creation.ts";
import { deriveStats } from "./derived.ts";
import { fail, ok, type Result } from "./result.ts";
import { lookupSkill, type SkillCatalog, skillValue } from "./skills.ts";
import type { GameState } from "./state.ts";

// Progression (spec 04): the engine awards XP on events, never on narration, and prices purchases.

export type Purchase = { kind: "skill" | "attribute" | "talent" | "fieldSkill"; id: string };

const mode = (state: GameState) => state.campaign.settings.structural.progression;
const earnsXp = (state: GameState) =>
  mode(state) === "classless" || mode(state) === "hybrid" || mode(state) === "classes";
const marksSkills = (state: GameState) => mode(state) === "useBased" || mode(state) === "hybrid";
const party = (state: GameState): ActorId[] =>
  [state.party.pcId, ...state.party.companionIds].filter(
    (id): id is ActorId => !!id && !!state.actors[id] && !state.actors[id]!.dead,
  );

export const xpAvailable = (sheet: CharacterSheet) => sheet.progression.xpEarned - sheet.progression.xpSpent;

/** The XP for raising a skill one step from its current value, or null past the mastery cap. */
export function skillStepCost(value: number, tuning: Tuning): number | null {
  const p = tuning.progression;
  if (value >= p.skillMasteryAt) return null;
  return p.skillCosts.find((c) => value < c.below)?.cost ?? null;
}

/** An award, scaled for hybrid campaigns (half, rounded half up). */
function award(
  state: GameState,
  amount: number,
  source: "quest" | "encounter" | "discovery" | "bond" | "chapter" | "clever",
  reason: string,
  tuning: Tuning,
): EventDraft[] {
  if (!earnsXp(state) || amount <= 0) return [];
  const scaled =
    mode(state) === "hybrid" ? Math.floor(amount * tuning.progression.hybridShare + 0.5) : amount;
  return scaled > 0 ? [draft("XpAwarded", { amount: scaled, source, reason }, "engine")] : [];
}

/**
 * XP for what a turn did (spec 04 table): completed quest stages (main, major or minor), won
 * encounters (by how many enemies stood against the party), and discoveries of new regions and sites.
 */
export function turnAwards(
  before: GameState,
  after: GameState,
  events: readonly EventDraft[],
  kindOf: (id: string) => string | undefined,
  tuning: Tuning,
): EventDraft[] {
  const x = tuning.progression.xp;
  const out: EventDraft[] = [];
  for (const q of Object.values(after.quests)) {
    const was = before.quests[q.id];
    if (was?.status !== "active") continue;
    const stagesDone = q.stage - was.stage + (q.status === "completed" ? 1 : 0);
    if (stagesDone <= 0) continue;
    const size = q.kind === "main" ? "main" : q.kind === "side" || q.kind === "job" ? "minor" : "major";
    const bond = q.kind === "personal" || q.kind === "companion";
    for (let i = 0; i < stagesDone; i++) {
      out.push(...award(before, x.questStage[size], "quest", `A stage of "${q.title}"`, tuning));
      if (bond) out.push(...award(before, x.bond, "bond", `A personal goal in "${q.title}"`, tuning));
    }
  }
  for (const e of events) {
    if (e.type === "CombatEnded" && e.payload.outcome === "victory") {
      // A fight that started this turn isn't in `before`; its roster is in CombatStarted.
      const started = events.find((x) => x.type === "CombatStarted");
      const combat = before.combat ?? (started?.type === "CombatStarted" ? started.payload.combat : null);
      if (!combat) continue;
      const enemies = Object.values(combat.combatants).filter((c) => c.side === "enemy").length;
      const amount = Math.min(x.encounter.max, x.encounter.min + Math.floor(enemies / 3));
      out.push(...award(before, amount, "encounter", "A fight won", tuning));
    }
    if (
      e.type === "KnowledgeGained" &&
      e.payload.entityId &&
      !before.knowledge.entities[e.payload.entityId]
    ) {
      const kind = kindOf(e.payload.entityId);
      if (kind === "region")
        out.push(...award(before, x.discovery.region, "discovery", "A new region", tuning));
      if (kind === "site" && e.payload.entry.how === "witnessed")
        out.push(...award(before, x.discovery.site, "discovery", "A new place reached", tuning));
    }
  }
  return out;
}

/**
 * Use-based marks (spec 04): a party member's skill succeeds at Normal or harder, with real stakes
 * (combat, an opposed roll, a Hard+ task or a push), and not thanks to a Luck reroll.
 */
export function turnMarks(state: GameState, events: readonly EventDraft[]): EventDraft[] {
  if (!marksSkills(state)) return [];
  const members = new Set(party(state));
  const marked = new Set<string>();
  const out: EventDraft[] = [];
  for (const e of events) {
    if (e.type !== "CheckResolved") continue;
    const p = e.payload as CheckResolvedPayload;
    const skill = p.request.skill;
    // Attribute checks (shock, morale, bleeding) have no skill to mark.
    if (typeof skill !== "string" || !members.has(p.actorId) || p.attempt === "luck" || p.autoFailed)
      continue;
    if (p.effective.degree !== "success" && p.effective.degree !== "critSuccess") continue;
    const difficulty = p.prepared.difficulty;
    if (difficulty === "easy") continue;
    const stakes = p.inCombat || !!p.opposed || difficulty !== "normal" || p.attempt === "push";
    const key = `${p.actorId}|${skill}`;
    if (!stakes || marked.has(key) || state.actors[p.actorId]!.sheet.progression.marks.includes(skill))
      continue;
    marked.add(key);
    out.push(draft("SkillMarked", { actorId: p.actorId, skillId: skill }, "engine"));
  }
  return out;
}

/** An improvement opportunity (spec 04): each marked skill rolls d100; above its value (or 96+) gains 1d10. */
export function improvementRolls(
  state: GameState,
  reason: "rest" | "chapter",
  content: { skills: SkillCatalog },
  tuning: Tuning,
): EventDraft[] {
  if (!marksSkills(state)) return [];
  const rng = new Rng(state.campaign.rngState);
  const imp = tuning.progression.improvement;
  const out: EventDraft[] = [];
  for (const id of party(state)) {
    const sheet = state.actors[id]!.sheet;
    if (reason === "rest" && !sheet.progression.marks.length) continue;
    const results = sheet.progression.marks.map((skillId) => {
      const value = safeValue(sheet, skillId, content, tuning);
      const roll = rng.int(1, 100);
      const room = Math.max(0, tuning.skillCap - value);
      const gain = roll > value || roll >= imp.alwaysAt ? Math.min(room, rng.int(1, imp.gainDie)) : 0;
      return { skillId, roll, gain };
    });
    out.push(
      draft("SkillsImproved", { actorId: id, reason, results, rngAfter: [...rng.state] as never }, "engine"),
    );
  }
  return out;
}

const safeValue = (
  sheet: CharacterSheet,
  skillId: string,
  content: { skills: SkillCatalog },
  tuning: Tuning,
) => {
  try {
    return skillValue(sheet, skillId, content.skills, tuning);
  } catch {
    return 0;
  }
};

/** A long rest out of danger is an improvement opportunity in use-based and hybrid campaigns. */
export function restImprovements(
  after: GameState,
  events: readonly EventDraft[],
  content: { skills: SkillCatalog },
  tuning: Tuning,
): EventDraft[] {
  if (after.combat) return [];
  // Only a long wait counts as rest: not travel, and not lying captured after a defeat.
  const rested = events.some(
    (e) =>
      e.type === "TimeAdvanced" &&
      e.payload.reason === "exploration" &&
      e.payload.minutes >= tuning.progression.improvement.restMinutes,
  );
  return rested ? improvementRolls(after, "rest", content, tuning) : [];
}

/**
 * A chapter or arc closes (spec 04): chapter XP; use-based improvement rolls and a talent every
 * N chapters; an attribute point when an arc closes (use-based only).
 */
export function closeEvents(
  state: GameState,
  level: "chapter" | "arc",
  content: { skills: SkillCatalog },
  tuning: Tuning,
): EventDraft[] {
  const out: EventDraft[] = [];
  if (level === "arc") {
    if (mode(state) === "useBased")
      for (const id of party(state))
        out.push(
          draft(
            "AdvancementGranted",
            { actorId: id, attributes: 1, talents: 0, reason: "An arc closed" },
            "engine",
          ),
        );
    return out;
  }
  out.push(...award(state, tuning.progression.xp.chapter, "chapter", "A chapter closed", tuning));
  out.push(...improvementRolls(state, "chapter", content, tuning));
  if (mode(state) === "useBased")
    for (const id of party(state)) {
      const closed = (state.actors[id]!.sheet.progression.chaptersClosed ?? 0) + 1;
      if (closed % tuning.progression.talentEveryChapters === 0)
        out.push(
          draft(
            "AdvancementGranted",
            { actorId: id, attributes: 0, talents: 1, reason: "Two chapters closed" },
            "engine",
          ),
        );
    }
  return out;
}

/** The total XP needed for a class level (spec 04): level n needs 10 × n(n−1)/2. */
export function classXpForLevel(level: number, tuning: Tuning): number {
  const n = Math.max(1, Math.min(tuning.progression.classes.maxLevel, level));
  return tuning.progression.classes.xpPerLevel * ((n * (n - 1)) / 2);
}

/** The class level a character's total earned XP reaches. */
export function classLevelForXp(xp: number, tuning: Tuning): number {
  let level = 1;
  while (level < tuning.progression.classes.maxLevel && xp >= classXpForLevel(level + 1, tuning)) level++;
  return level;
}

/**
 * Class levels from XP (spec 04): each level trains the class skills, adds a little to one other
 * skill, and grants the level's class features; levels 4 and 8 give an attribute point to spend.
 * Everything is emitted so class progress replays exactly and the reducer needs no content.
 */
export function classLevelEvents(
  state: GameState,
  content: {
    classes?: Record<
      string,
      {
        id: string;
        name: string;
        skills: string[];
        features: Array<{ level: number; name: string; talent?: string }>;
      }
    >;
    skills: SkillCatalog;
  },
  tuning: Tuning,
): EventDraft[] {
  if (state.campaign.settings.structural.progression !== "classes") return [];
  const classes = content.classes ?? {};
  const c = tuning.progression.classes;
  const out: EventDraft[] = [];
  for (const id of party(state)) {
    const sheet = state.actors[id]!.sheet;
    const classId = sheet.progression.classId ?? Object.keys(classes)[0];
    const cls = classId ? classes[classId] : undefined;
    if (!classId || !cls) continue;
    const current = sheet.progression.classLevels?.[classId] ?? 1;
    const target = classLevelForXp(sheet.progression.xpEarned, tuning);
    if (target <= current) continue;
    // Training already applied by earlier levels in this same batch.
    const trained = new Map(Object.entries(sheet.skills).map(([skill, v]) => [skill, v.trained]));
    const skillAt = (skill: string) => {
      try {
        return Math.min(
          tuning.skillCap,
          skillValue(
            { ...sheet, skills: Object.fromEntries([...trained].map(([k, v]) => [k, { trained: v }])) },
            skill,
            content.skills,
            tuning,
          ),
        );
      } catch {
        return 0;
      }
    };
    for (let level = current + 1; level <= target; level++) {
      const training: Array<{ skillId: string; amount: number }> = [];
      let left = c.skillPointsPerLevel;
      const classSkills = [...new Set(cls.skills)].sort(
        (a, b) => skillAt(a) - skillAt(b) || a.localeCompare(b),
      );
      for (const skill of classSkills) {
        if (left <= 0) break;
        const room = Math.max(0, tuning.skillCap - skillAt(skill));
        const amount = Math.min(c.maxPerSkillPerLevel, left, room);
        if (amount > 0) {
          training.push({ skillId: skill, amount });
          trained.set(skill, (trained.get(skill) ?? 0) + amount);
          left -= amount;
        }
      }
      // Any leftover class points go to the next class skill, then the first skill with room.
      if (left > 0) {
        const fallback = Object.keys(sheet.skills).find((s) => tuning.skillCap - skillAt(s) > 0);
        if (fallback) {
          const amount = Math.min(left, tuning.skillCap - skillAt(fallback));
          training.push({ skillId: fallback, amount });
          trained.set(fallback, (trained.get(fallback) ?? 0) + amount);
          left -= amount;
        }
      }
      // +5 to any skill: broaden the character's best non-class skill when there is room.
      let anySkill: { skillId: string; amount: number } | undefined;
      const candidates = Object.keys(sheet.skills)
        .filter((s) => !cls.skills.includes(s))
        .sort((a, b) => skillAt(b) - skillAt(a) || a.localeCompare(b));
      const pick = candidates.find((s) => tuning.skillCap - skillAt(s) > 0) ?? classSkills[0];
      if (pick) {
        const amount = Math.min(c.anySkillPoints, tuning.skillCap - skillAt(pick));
        if (amount > 0) {
          anySkill = { skillId: pick, amount };
          trained.set(pick, (trained.get(pick) ?? 0) + amount);
        }
      }
      const features = cls.features.filter((f) => f.level === level);
      out.push(
        draft(
          "ClassLevelGained",
          {
            actorId: id,
            classId,
            level,
            training,
            ...(anySkill ? { anySkill } : {}),
            attributes: c.attributeLevels.includes(level) ? 1 : 0,
            talents: features.flatMap((f) => (f.talent ? [f.talent] : [])),
            features: features.map((f) => f.name),
          },
          "engine",
        ),
      );
    }
  }
  return out;
}

/** What a purchase costs and whether it's allowed, with the reason when it isn't. */
export function priceOf(
  state: GameState,
  actorId: ActorId,
  purchase: Purchase,
  content: CreationContent,
  tuning: Tuning,
): Result<{ cost: number; amount: number; free: boolean }> {
  const actor = state.actors[actorId];
  if (!actor || actor.dead || !party(state).includes(actorId))
    return fail("NOT_IN_PARTY", "Only the party can advance");
  const sheet = actor.sheet;
  const p = tuning.progression;
  const m = mode(state);
  const free =
    (purchase.kind === "attribute" && sheet.progression.pendingAttributes > 0) ||
    (purchase.kind === "talent" && sheet.progression.pendingTalents > 0);
  if (m === "classes" && !free)
    return fail(
      "CLASSES_TRAINING",
      "Class levels grant training and features automatically; only level-up attribute picks are spent here",
    );
  if (!free && !earnsXp(state))
    return fail(
      "USE_BASED",
      "In a use-based campaign skills improve by use; attributes and talents come with chapters and arcs",
    );
  let cost: number;
  let amount = 0;
  switch (purchase.kind) {
    case "skill": {
      let def: ReturnType<typeof lookupSkill>;
      try {
        def = lookupSkill(purchase.id, content.skills);
      } catch (e) {
        return fail("SKILL_UNKNOWN", (e as Error).message);
      }
      if (def.field && !sheet.skills[purchase.id])
        return fail("FIELD_SKILL_NEW", "Learn a new field skill with a field-skill purchase");
      const value = safeValue(sheet, purchase.id, content, tuning);
      const step = skillStepCost(value, tuning);
      if (step === null)
        return fail("SKILL_MASTERY", `Raising a skill past ${p.skillMasteryAt}% needs a Mastery talent`);
      cost = step;
      amount = Math.min(p.skillStep, p.skillMasteryAt - value, tuning.skillCap - value);
      break;
    }
    case "fieldSkill": {
      let def: ReturnType<typeof lookupSkill>;
      try {
        def = lookupSkill(purchase.id, content.skills);
      } catch (e) {
        return fail("SKILL_UNKNOWN", (e as Error).message);
      }
      if (!def.field || !purchase.id.includes("/"))
        return fail("NOT_FIELD_SKILL", `${def.name} isn't a field skill`);
      if (sheet.skills[purchase.id])
        return fail("FIELD_SKILL_KNOWN", "That specialisation is already trained");
      cost = p.fieldSkill.cost;
      amount = p.fieldSkill.trained;
      break;
    }
    case "attribute": {
      if (!ATTRIBUTE_IDS.includes(purchase.id as AttributeId))
        return fail("ATTRIBUTE_UNKNOWN", `No attribute ${purchase.id}`);
      const next = sheet.attributes[purchase.id as AttributeId] + 1;
      if (next > p.attributeMax) return fail("ATTRIBUTE_MAX", `Attributes stop at ${p.attributeMax}`);
      cost = free ? 0 : p.attributeCostPerPoint * next;
      amount = 1;
      break;
    }
    case "talent": {
      const t = content.talents[purchase.id];
      if (!t) return fail("TALENT_UNKNOWN", `Unknown talent ${purchase.id}`);
      if (sheet.talents.includes(t.id)) return fail("TALENT_OWNED", `Already has ${t.name}`);
      const problems = talentProblems(sheet, t, content, tuning);
      if (problems.length) return fail("TALENT_PREREQ_UNMET", problems.join("; "));
      cost = free ? 0 : p.talentCost[t.tier as 1 | 2 | 3];
      break;
    }
  }
  if (cost > xpAvailable(sheet)) return fail("XP_SHORT", `Needs ${cost} XP; ${xpAvailable(sheet)} available`);
  return ok({ cost, amount, free });
}

/** Buys an advancement with XP (or a pending use-based grant) as one event. */
export function buyAdvancement(
  state: GameState,
  actorId: ActorId,
  purchase: Purchase,
  content: CreationContent,
  tuning: Tuning,
): Result<EventDraft[]> {
  const price = priceOf(state, actorId, purchase, content, tuning);
  if (!price.ok) return price;
  const sheet = state.actors[actorId]!.sheet;
  const derived =
    purchase.kind === "attribute"
      ? deriveStats(
          { ...sheet.attributes, [purchase.id]: sheet.attributes[purchase.id as AttributeId] + 1 },
          tuning,
        )
      : undefined;
  return ok([
    draft(
      "AdvancementBought",
      {
        actorId,
        kind: purchase.kind,
        id: purchase.id,
        cost: price.value.cost,
        amount: price.value.amount,
        ...(derived ? { derived } : {}),
      },
      "player",
    ),
  ]);
}

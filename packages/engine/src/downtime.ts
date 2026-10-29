import {
  type ActorId,
  ConditionInstance,
  type Degree,
  type Difficulty,
  type DowntimeAction,
  DowntimeResult,
  draft,
  type EventDraft,
  type ItemCatalog,
  type RecipeDef,
} from "@wyrd/core";
import { resolveCheck } from "./checks.ts";
import { fail, ok, type Result } from "./result.ts";
import { lookupSkill } from "./skills.ts";
import type { GameState, RulesContext } from "./state.ts";

/**
 * Downtime (spec 06): train, craft, work, research, carouse or recover when time passes in a safe
 * place. Every outcome is an event; the narrator only summarises the resolved result.
 */

export type DowntimeContext = RulesContext & {
  nameOf: (id: string) => string;
  /** Crafting recipes from the frozen pack. */
  recipes?: Record<string, RecipeDef & { id: string }>;
  /** The pack's item catalog, for recipe tool tags and readable input names. */
  items?: ItemCatalog;
};

export type DowntimeOutcome = { events: EventDraft[]; result: DowntimeResult };

/** A readable reason the skill can't be used, or null. Never throws: downtime input is untrusted. */
function skillProblem(skillId: string, ctx: DowntimeContext): string | null {
  try {
    lookupSkill(skillId, ctx.skills);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : `Unknown skill "${skillId}"`;
  }
}

const WORDS: Record<Degree, string> = {
  critSuccess: "exceptionally well",
  success: "well",
  failure: "poorly",
  critFailure: "badly",
};

export function resolveDowntime(
  state: GameState,
  actorId: ActorId,
  action: DowntimeAction,
  ctx: DowntimeContext,
): Result<DowntimeOutcome> {
  const actor = state.actors[actorId];
  if (!actor) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  if (actor.dead) return fail("ACTOR_DEAD", `${ctx.nameOf(actorId)} is dead`);
  if (state.combat) return fail("IN_COMBAT", "You can't take downtime in the middle of a fight");
  const t = ctx.tuning.downtime;
  let minutes = t.minutes[action.type];
  const events: EventDraft[] = [];
  const rewards: DowntimeResult["rewards"] = {};
  let degree: Degree | undefined;
  let summary = "";

  const roll = (
    skill: string,
    difficulty: Difficulty,
    purpose: string,
    tags: string[] = [],
  ): Result<Degree> => {
    const check = resolveCheck(state, { actorId, skill, difficulty, purpose, tags }, ctx);
    if (!check.ok) return check;
    events.push(...check.value.events);
    return ok(check.value.effective.degree);
  };

  switch (action.type) {
    case "train": {
      const problem = skillProblem(action.skill, ctx);
      if (problem) return fail("SKILL_UNKNOWN", problem);
      const present = state.scene?.positions[action.teacherId ?? ""] !== undefined;
      if (present) {
        events.push(draft("SkillMarked", { actorId, skillId: action.skill }, "engine"));
        rewards.improvement = true;
      }
      summary = present
        ? `${ctx.nameOf(actorId)} trains ${action.skill.replace(/^.*:/, "")} with ${ctx.nameOf(action.teacherId!)} and has a chance to improve.`
        : `${ctx.nameOf(actorId)} trains ${action.skill.replace(/^.*:/, "")} alone; the work is slow without a teacher.`;
      break;
    }
    case "craft": {
      if (!state.campaign.settings.subsystems.crafting)
        return fail("CRAFTING_OFF", "Crafting is off in this campaign");
      const recipe = ctx.recipes?.[action.recipeId];
      if (!recipe) return fail("RECIPE_UNKNOWN", `No recipe called ${action.recipeId}`);
      const stacks = state.inventory?.actors[actorId]?.stacks ?? [];
      const itemOf = (itemId: string) =>
        ctx.items?.weapons[itemId] ?? ctx.items?.armor[itemId] ?? ctx.items?.gear[itemId];
      const have = (itemId: string) =>
        stacks.filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.qty, 0);
      const missing = recipe.inputs.filter((input) => have(input.item) < input.qty);
      if (missing.length) {
        const list = missing
          .map((input) => `${input.qty} × ${itemOf(input.item)?.name ?? input.item}`)
          .join(", ");
        return fail("CRAFT_MISSING_INPUTS", `You don't have the materials: ${list}`);
      }
      const missingTools = recipe.tools.filter(
        (tool) => !stacks.some((stack) => (itemOf(stack.itemId)?.tags ?? []).includes(tool)),
      );
      if (missingTools.length)
        return fail("CRAFT_MISSING_TOOLS", `You need these tools: ${missingTools.join(", ")}`);
      minutes = recipe.minutes;
      const r = roll(recipe.skill, recipe.difficulty, `craft ${recipe.name}`);
      if (!r.ok) return r;
      degree = r.value;
      // The attempt spends its materials even when the result is crude, nothing, or ruined.
      for (const input of recipe.inputs)
        events.push(
          draft(
            "ItemTransferred",
            { actorId, itemId: input.item, qty: input.qty, reason: `used for ${recipe.name}` },
            "engine",
          ),
        );
      if (degree === "critFailure") {
        summary = `The ${recipe.name.toLowerCase()} is ruined; the materials are lost.`;
      } else if (degree === "failure" && recipe.complex) {
        summary = `${ctx.nameOf(actorId)} fails to finish the ${recipe.name.toLowerCase()}; the materials are spent.`;
      } else {
        const quality = degree === "critSuccess" ? "fine" : degree === "success" ? "standard" : "crude";
        events.push(
          draft(
            "ItemTransferred",
            {
              actorId,
              itemId: recipe.output.item,
              qty: recipe.output.qty,
              location: { kind: "carried" },
              reason: `crafted ${quality} ${recipe.name}`,
            },
            "engine",
          ),
        );
        rewards.itemId = recipe.output.item;
        rewards.itemQty = recipe.output.qty;
        summary = `${ctx.nameOf(actorId)} makes a ${quality} ${recipe.name.toLowerCase()}.`;
      }
      break;
    }
    case "work": {
      const skill = action.skill ?? "core:mechanics";
      const problem = skillProblem(skill, ctx);
      if (problem) return fail("SKILL_UNKNOWN", problem);
      const r = roll(skill, "normal", "a day's work", ["work"]);
      if (!r.ok) return r;
      degree = r.value;
      const coins = t.workPay[degree];
      if (coins > 0) {
        events.push(draft("CoinsChanged", { actorId, delta: coins, reason: "a day's work" }, "engine"));
        rewards.coins = coins;
      }
      summary = `${ctx.nameOf(actorId)} works ${WORDS[degree]}${coins > 0 ? ` and earns ${coins} coins` : ""}.`;
      break;
    }
    case "research": {
      if (action.clockId) {
        const clock = state.clocks[action.clockId];
        if (!clock) return fail("CLOCK_UNKNOWN", `No research called ${action.clockId}`);
        events.push(
          draft("ClockAdvanced", { clockId: action.clockId, by: 1, reason: "a spell of research" }, "engine"),
        );
        rewards.clockId = action.clockId;
        summary = `${ctx.nameOf(actorId)} advances the research on ${clock.name}.`;
      } else {
        const id = `clock:research:${actorId}:${state.campaign.gameTime}`;
        events.push(
          draft(
            "ClockCreated",
            {
              clock: {
                id,
                name: action.topic,
                kind: "progress",
                segments: t.researchSegments,
                filled: 1,
                ownerId: actorId,
                visible: true,
              },
            },
            "engine",
          ),
        );
        rewards.clockId = id;
        summary = `${ctx.nameOf(actorId)} begins research into ${action.topic}.`;
      }
      break;
    }
    case "carouse": {
      const r = roll("core:persuasion", "normal", "carouse for news", ["social"]);
      if (!r.ok) return r;
      degree = r.value;
      summary =
        degree === "critFailure"
          ? `${ctx.nameOf(actorId)} drinks too much and wakes with a sore head and no news.`
          : `${ctx.nameOf(actorId)} spends the evening among talkative strangers.`;
      if (degree === "critFailure")
        events.push(
          draft(
            "ConditionApplied",
            { actorId, condition: ConditionInstance.parse({ id: "core:intoxicated", level: 1 }) },
            "engine",
          ),
        );
      break;
    }
    case "recover": {
      const r = roll("core:medicine", "normal", "rest and care", ["healing"]);
      if (!r.ok) return r;
      degree = r.value;
      const healed = t.recoverHp[degree];
      if (healed > 0) {
        const hp = actor.sheet.status.hp;
        const max = actor.sheet.derived.hpMax;
        const next = Math.min(max, hp + healed);
        if (next > hp)
          events.push(
            draft("HpChanged", { actorId, hp: next, delta: next - hp, cause: "healing" }, "engine"),
          );
      }
      summary = `${ctx.nameOf(actorId)} rests and recovers ${healed} vitality.`;
      break;
    }
  }

  // Time passes first in the log, then the check and its consequences.
  events.unshift(draft("TimeAdvanced", { minutes, reason: action.type }, "engine"));
  const result = DowntimeResult.parse({
    action: action.type,
    minutes,
    ...(degree ? { degree } : {}),
    summary,
    rewards,
  });
  events.push(
    draft(
      "DowntimeResolved",
      {
        id: `downtime:${actorId}:${state.campaign.gameTime}:${action.type}`,
        actorId,
        action: action.type,
        minutes,
        ...(degree ? { degree } : {}),
        summary,
        rewards,
      },
      "engine",
    ),
  );
  return ok({ events, result });
}

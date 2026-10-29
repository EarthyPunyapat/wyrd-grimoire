import { Ability, defaultTuning, draft, Level, RollArgs } from "@wyrd/core";
import {
  breakthrough,
  gmLevelChange,
  grantAbility,
  proposeLevelUp,
  rankAbility,
  resolveCheck,
} from "@wyrd/engine";
import { z } from "zod";
import { registerGmTool } from "../registry.ts";

registerGmTool({
  name: "roll",
  description:
    "Resolve a check. In d20, specify opposition by level or actor, an optional owned abilityId, and a cited exploit for a large level disadvantage. Infinity never rolls.",
  schema: RollArgs,
  run: (a, x) => {
    const rolled = resolveCheck(
      x.state,
      {
        actorId: a.actorId ?? x.pcId,
        skill: a.skill,
        difficulty: a.difficulty,
        purpose: a.goal,
        opposition: a.opposition,
        abilityId: a.abilityId,
        exploit: a.exploit,
      },
      x.ctx,
    );
    if (!rolled.ok) return { ok: false, body: { errors: rolled.errors } };
    const result = rolled.value.effective;
    return {
      ok: true,
      body: {
        degree: result.degree,
        rolls: result.rolls,
        mechanics: result.display.text,
        automatic: result.rolls.length === 0,
      },
      effects: {
        drafts: rolled.value.events,
        mechanics: [{ ...result.display, purpose: a.goal }],
        progress: { phase: "rolling", detail: a.goal },
      },
    };
  },
});
registerGmTool({
  name: "propose_level_up",
  description:
    "Propose a milestone level-up card. Only the player can accept it; this never silently raises a level.",
  schema: z.object({
    actorId: z.string().optional(),
    level: Level.optional(),
    reason: z.string().trim().min(1),
  }),
  run: (a, x) => {
    const actorId = a.actorId ?? x.pcId;
    const current = x.state.actors[actorId]?.sheet.level ?? defaultTuning.levels.start;
    const level = a.level ?? (current === "infinite" ? current : current + x.ctx.tuning.levels.step);
    const id = x.newId();
    const r = proposeLevelUp(x.state, actorId, level, a.reason, id);
    return r.ok
      ? {
          ok: true,
          body: { proposalId: id, awaitingPlayer: true },
          effects: { drafts: r.value, cards: [{ type: "levelUp", proposalId: id }] },
        }
      : { ok: false, body: { errors: r.errors } };
  },
});
registerGmTool({
  name: "grant_ability",
  description:
    "Grant a new ability with its level, cost or limit, and rank. Existing abilities must be ranked instead.",
  schema: z.object({ actorId: z.string().optional(), ability: Ability }),
  run: (a, x) => {
    const r = grantAbility(x.state, a.actorId ?? x.pcId, a.ability);
    return r.ok
      ? { ok: true, body: { ability: a.ability }, effects: { drafts: r.value } }
      : { ok: false, body: { errors: r.errors } };
  },
});
registerGmTool({
  name: "rank_ability",
  description: "Increase an existing ability's rank within the configured rank bounds.",
  schema: z.object({
    actorId: z.string().optional(),
    abilityId: z.string().min(1),
    rank: Ability.shape.rank,
  }),
  run: (a, x) => {
    const r = rankAbility(x.state, a.actorId ?? x.pcId, a.abilityId, a.rank);
    return r.ok
      ? { ok: true, body: { rank: a.rank }, effects: { drafts: r.value } }
      : { ok: false, body: { errors: r.errors } };
  },
});
registerGmTool({
  name: "breakthrough",
  description:
    "Attempt training past the next level with a real d20 check; failure keeps the level, success applies the stated HP cost.",
  schema: z.object({
    actorId: z.string().optional(),
    skill: z.string().min(1),
    reason: z.string().trim().min(1),
    hpCost: z.number().int().nonnegative(),
  }),
  run: (a, x) => {
    const r = breakthrough(x.state, a.actorId ?? x.pcId, a.skill, a.reason, a.hpCost, x.ctx);
    if (!r.ok) return { ok: false, body: { errors: r.errors } };
    return {
      ok: true,
      body: { gained: r.value.some((e) => e.type === "LevelGained") },
      effects: {
        drafts: r.value,
        mechanics: r.value.flatMap((e) =>
          e.type === "CheckResolved" ? [{ ...e.payload.effective.display, purpose: a.reason }] : [],
        ),
        progress: { phase: "rolling", detail: a.reason },
      },
    };
  },
});

registerGmTool({
  name: "set_level",
  description:
    "Explicit GM mode only: correct a character's level with a Retcon and Undo. Never use this for ordinary advancement.",
  schema: z.object({ actorId: z.string().optional(), level: Level, reason: z.string().trim().min(1) }),
  run: (a, x) => {
    if (!x.gmMode) return { ok: false, body: { errors: "set_level requires explicit /gm mode" } };
    const r = gmLevelChange(x.state, a.actorId ?? x.pcId, a.level, a.reason);
    if (!r.ok) return { ok: false, body: { errors: r.errors } };
    const retconId = x.newId();
    return {
      ok: true,
      body: { level: a.level },
      effects: {
        drafts: [
          ...r.value.drafts,
          draft("RetconApplied", { retconId, turnId: x.turnId, summary: a.reason, inverse: r.value.inverse }),
        ],
        cards: [{ type: "retcon", retconId }],
        retcon: { retconId, summary: a.reason, inverse: r.value.inverse },
      },
    };
  },
});

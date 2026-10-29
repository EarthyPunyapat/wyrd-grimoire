import {
  type ActorId,
  averageDice,
  type CastAction,
  draft,
  type EventDraft,
  type MechanicsLine,
  Rng,
  SpellcastingConfig,
  type SpellDef,
  type Tuning,
} from "@wyrd/core";
import { resolveCheck, resolveOpposedCheck } from "../checks.ts";
import {
  type CombatContext,
  type CombatStep,
  combatant,
  combatOf,
  replaceCombatant,
  sheetOf,
  zoneOf,
} from "../combat/common.ts";
import { applyCondition, removeCondition } from "../conditions.ts";
import { downCheck, resolveHit } from "../injury/hit.ts";
import { effectiveHpMax } from "../injury/hp.ts";
import { isSuccess } from "../resolution/index.ts";
import { fail, ok, type Result, unwrap } from "../result.ts";
import type { GameState } from "../state.ts";
import type { Working } from "../working.ts";

/**
 * The spellcasting plugin (spec 05): spells are pack data, casting costs strain, a critical failure
 * miscasts from the school's table, and effects reuse the engine's event vocabulary. Pure and
 * replayable: every random choice stores the generator state on the SpellCast event.
 */

export type SpellContext = CombatContext;

export type CastProblem = { code: string; message: string; legalAlternatives?: CastAction[] };

const config = (ctx: SpellContext): SpellcastingConfig => {
  const parsed = SpellcastingConfig.safeParse(ctx.plugins?.spellcasting ?? {});
  return parsed.success ? parsed.data : SpellcastingConfig.parse({});
};

const spellOf = (ctx: SpellContext, id: string): (SpellDef & { id: string }) | undefined => {
  if (ctx.spells?.[id]) return ctx.spells[id];
  const local = id.split(":").pop();
  return Object.values(ctx.spells ?? {}).find((s) => s.id.split(":").pop() === local);
};

const strainOf = (spell: SpellDef, tuning: Tuning) =>
  spell.strain ?? tuning.spellcasting.strainByTier[spell.tier as 1 | 2 | 3];

/** The actor or zone a spell is aimed at, or why the aim doesn't work. */
function aim(
  state: GameState,
  actorId: ActorId,
  spell: SpellDef,
  a: CastAction,
  ctx: SpellContext,
): { targetId?: ActorId; zoneId?: string } | CastProblem {
  const zone = a.zoneId ?? (a.targetId ? zoneOf(state, a.targetId) : undefined);
  if (spell.target === "self") return { targetId: actorId };
  if (spell.target === "actor") {
    if (!a.targetId) return { code: "TARGET_REQUIRED", message: `${spell.name} needs a target` };
    if (!state.actors[a.targetId])
      return {
        code: "TARGET_NOT_ACTOR",
        message: `${ctx.nameOf(a.targetId)} can't be the target of that spell`,
      };
    return { targetId: a.targetId };
  }
  if (!zone)
    return {
      code: "ZONE_REQUIRED",
      message: `${spell.name} needs a place to affect`,
    };
  return { zoneId: zone };
}

export function castProblem(
  state: GameState,
  actorId: ActorId,
  a: CastAction,
  ctx: SpellContext,
): CastProblem | null {
  if (!state.actors[actorId]) return { code: "ACTOR_UNKNOWN", message: `No actor ${actorId}` };
  const spell = spellOf(ctx, a.spellId);
  if (!spell) return { code: "SPELL_UNKNOWN", message: `No spell ${a.spellId}` };
  if (spell.target === "actor" && !a.targetId)
    return { code: "TARGET_REQUIRED", message: `${spell.name} needs a target` };
  if (spell.target === "actor" && a.targetId && !state.actors[a.targetId] && a.targetId !== actorId)
    return {
      code: "TARGET_NOT_ACTOR",
      message: `${ctx.nameOf(a.targetId)} can't be the target of that spell`,
    };
  if (
    (spell.target === "zone" || spell.target === "area") &&
    !(a.zoneId ?? (a.targetId && zoneOf(state, a.targetId)))
  )
    return { code: "ZONE_REQUIRED", message: `${spell.name} needs a place to affect` };
  // In a fight, a targeted spell must reach the target's band.
  if (state.combat && a.targetId) {
    const me = combatant(state, actorId);
    if (!me) return { code: "NOT_IN_FIGHT", message: "You're not in this fight" };
    const band = zoneOf(state, actorId) === zoneOf(state, a.targetId) ? "engaged" : spell.range;
    if (band === "engaged" && zoneOf(state, actorId) !== zoneOf(state, a.targetId))
      return {
        code: "OUT_OF_RANGE",
        message: `${spell.name} needs you in the same place as ${ctx.nameOf(a.targetId)}`,
      };
  }
  return null;
}

type EffectResult = { summaries: string[]; lines: MechanicsLine[] };

function applyEffect(
  w: Working,
  actorId: ActorId,
  spell: SpellDef,
  effect: SpellDef["effects"][number],
  targetId: ActorId | undefined,
  zoneId: string | undefined,
  ctx: SpellContext,
): EffectResult {
  const summaries: string[] = [];
  const lines: MechanicsLine[] = [];
  const name = ctx.nameOf;
  const target = targetId ?? actorId;
  switch (effect.kind) {
    case "damage": {
      if (!targetId || !w.state.actors[targetId]) break;
      const hit = resolveHit(
        w.state,
        {
          attackerId: actorId,
          targetId,
          weaponId: null,
          damage: { dice: effect.dice, damageType: effect.damageType, armorPiercing: effect.armorPiercing },
          degree: "success",
        },
        ctx,
      );
      if (!hit.ok) break;
      w.apply(hit.value.events);
      summaries.push(`${name(targetId)} takes ${hit.value.final} ${effect.damageType} damage`);
      lines.push({ text: `${spell.name}: ${hit.value.final} ${effect.damageType} damage` });
      if (hit.value.wound) summaries.push(`a ${hit.value.wound.severity} wound`);
      if (hit.value.downed) summaries.push(`${name(targetId)} is ${hit.value.downed}`);
      // A spell that kills or drops someone changes their place in the fight.
      if (w.state.combat && combatant(w.state, targetId)) {
        const c = combatant(w.state, targetId)!;
        const status = hit.value.lethal
          ? hit.value.lethal.fate === "dying"
            ? "dying"
            : "defeated"
          : hit.value.downed === "unconscious"
            ? "dying"
            : c.status;
        if (status !== c.status)
          w.apply([
            draft(
              "CombatChanged",
              {
                combat: replaceCombatant(combatOf(w.state), {
                  ...c,
                  status,
                  ...(status === "dying"
                    ? { dyingRounds: w.state.actors[targetId]!.sheet.attributes.end }
                    : {}),
                }),
              },
              "engine",
            ),
          ]);
      }
      break;
    }
    case "heal": {
      if (!w.state.actors[target]) break;
      const gained = Math.max(1, Math.round(averageDice(effect.dice)));
      const sheet = w.state.actors[target]!.sheet;
      const hp = Math.min(effectiveHpMax(sheet), sheet.status.hp + gained);
      w.apply([
        draft("HpChanged", { actorId: target, hp, delta: hp - sheet.status.hp, cause: "healing" }, "engine"),
      ]);
      summaries.push(`${name(target)} recovers ${hp - sheet.status.hp} HP`);
      break;
    }
    case "applyCondition": {
      if (!w.state.actors[target]) break;
      const condition = {
        id: effect.condition,
        ...(effect.level ? { level: effect.level } : {}),
        ...(effect.note ? { note: effect.note } : {}),
      };
      const res = applyCondition(w.state, target, condition);
      if (res.ok) {
        w.apply(res.value);
        summaries.push(`${name(target)} is ${effect.condition.split(":")[1]}`);
      }
      break;
    }
    case "removeCondition": {
      if (!w.state.actors[target]) break;
      const res = removeCondition(w.state, target, effect.condition);
      if (res.ok) {
        w.apply(res.value);
        summaries.push(`${name(target)} is no longer ${effect.condition.split(":")[1]}`);
      }
      break;
    }
    case "zoneTag": {
      if (!w.state.scene || !zoneId) break;
      w.apply([
        draft(
          "ZoneTagChanged",
          { sceneId: w.state.scene.id, zoneId, tag: effect.tag, added: true },
          "engine",
        ),
      ]);
      summaries.push(`${name(zoneId)} fills with ${effect.tag}`);
      break;
    }
    case "moveTarget": {
      if (!targetId || !effect.toZoneId) break;
      w.apply([draft("EntityMoved", { entityId: targetId, toZoneId: effect.toZoneId }, "engine")]);
      summaries.push(`${name(targetId)} is moved to ${name(effect.toZoneId)}`);
      break;
    }
    case "ward": {
      if (!w.state.actors[target]) break;
      const res = applyCondition(w.state, target, {
        id: "core:warded",
        level: effect.protection,
        note: effect.damageTypes.join(", "),
      });
      if (res.ok) {
        w.apply(res.value);
        summaries.push(`a ward settles over ${name(target)} (${effect.protection} protection)`);
      }
      break;
    }
    case "detect":
      summaries.push(`the spell reveals what is ${effect.what === "hidden" ? "hidden" : effect.what}`);
      break;
    case "illusion": {
      if (!targetId || targetId === actorId || !w.state.actors[targetId]) {
        summaries.push("an illusion takes shape");
        break;
      }
      const opposed = resolveOpposedCheck(
        w.state,
        {
          actorId,
          skill: spell.check,
          difficulty: effect.difficulty,
          purpose: `deceive ${name(targetId)} with ${spell.name}`,
          opposedBy: { actorId: targetId, skill: "core:insight" },
        },
        ctx,
      );
      if (opposed.ok) {
        w.apply(opposed.value.events);
        lines.push(opposed.value.active.display);
        if (opposed.value.winner === "active") {
          const res = applyCondition(w.state, targetId, { id: "core:dazed", note: spell.name });
          if (res.ok) w.apply(res.value);
          summaries.push(`${name(targetId)} is caught by the illusion`);
        } else summaries.push(`${name(targetId)} sees through the illusion`);
      }
      break;
    }
    case "summon":
      summaries.push(`${spell.name} calls something from beyond`);
      break;
  }
  return { summaries, lines };
}

export type CastOutcome = {
  events: EventDraft[];
  step: CombatStep;
};

/**
 * Resolves a cast (spec 05): strain, the school check, a miscast on a critical failure, then the
 * spell's effects. In combat the caller has already spent the AP.
 */
export function resolveCast(
  w: Working,
  actorId: ActorId,
  a: CastAction,
  ctx: SpellContext,
  combat: boolean,
): Result<CastOutcome> {
  const problem = castProblem(w.state, actorId, a, ctx);
  if (problem) return fail(problem.code, problem.message);
  const spell = spellOf(ctx, a.spellId)!;
  const aimed = aim(w.state, actorId, spell, a, ctx);
  if ("code" in aimed) return fail(aimed.code, aimed.message);
  const name = ctx.nameOf;
  const lines: MechanicsLine[] = [];
  const strain = strainOf(spell, ctx.tuning);

  // 1. Strain: magic costs blood and breath, before the dice.
  const sheet = sheetOf(w.state, actorId);
  const hp = Math.max(0, sheet.status.hp - strain);
  w.apply([draft("HpChanged", { actorId, hp, delta: hp - sheet.status.hp, cause: "strain" }, "engine")]);
  if (hp === 0 && w.state.actors[actorId]) downCheck(w, actorId, ctx);
  if (strain >= ctx.tuning.spellcasting.exhaustAt) {
    const res = applyCondition(w.state, actorId, { id: "core:exhausted", level: 1 });
    if (res.ok) w.apply(res.value);
  }
  lines.push({ text: `Strain ${strain} · HP ${hp}/${effectiveHpMax(sheetOf(w.state, actorId))}` });

  // 2. The school check.
  const check = resolveCheck(
    w.state,
    {
      actorId,
      skill: spell.check,
      difficulty: spell.difficulty,
      purpose: `cast ${spell.name}`,
      tags: ["spell", spell.school],
    },
    ctx,
  );
  if (!check.ok) return check;
  w.apply(check.value.events);
  lines.push(check.value.effective.display);
  const success = isSuccess(check.value.effective.degree);
  // The generator is read only after the check, so a miscast choice can't rewind the check's dice.
  const rng = new Rng(w.state.campaign.rngState);

  // 3. A miscast replaces the spell's effect on a critical failure.
  let miscast: string | undefined;
  if (check.value.effective.degree === "critFailure") {
    const table = config(ctx).miscasts[spell.school] ?? [];
    const result =
      table.length > 0
        ? table[rng.int(0, table.length - 1)]!
        : {
            name: "Backlash",
            description: "The spell turns on its caster.",
            damage: "1d6" as const,
            attention: false,
            loseSpell: false,
          };
    miscast = result.name;
    lines.push({ text: `Miscast: ${result.name}` });
    w.apply([
      draft(
        "SpellCast",
        {
          actorId,
          spellId: spell.id,
          school: spell.school,
          tier: spell.tier,
          ...(aimed.targetId ? { targetId: aimed.targetId } : {}),
          strain,
          success: false,
          miscast,
          rngAfter: [...rng.state] as never,
        },
        "engine",
      ),
    ]);
    if (result.damage && w.state.actors[actorId]) {
      const hit = resolveHit(
        w.state,
        {
          attackerId: null,
          targetId: actorId,
          weaponId: null,
          damage: { dice: result.damage, damageType: "burn" },
          degree: "success",
        },
        ctx,
      );
      if (hit.ok) w.apply(hit.value.events);
    }
    if (result.condition) {
      const res = applyCondition(w.state, actorId, { id: result.condition });
      if (res.ok) w.apply(res.value);
    }
    return ok({
      events: w.events,
      step: {
        actorId,
        action: a,
        outcome: "critFailure",
        summary: `${name(actorId)} cast ${spell.name} and it went wrong: ${result.name}. ${result.description}`,
        lines,
      },
    });
  }

  // 4. Record the cast, then apply its effects (a hit stores its own generator state).
  w.apply([
    draft(
      "SpellCast",
      {
        actorId,
        spellId: spell.id,
        school: spell.school,
        tier: spell.tier,
        ...(aimed.targetId ? { targetId: aimed.targetId } : {}),
        strain,
        success,
      },
      "engine",
    ),
  ]);
  const summaries: string[] = [];
  if (success) {
    for (const effect of spell.effects) {
      const r = applyEffect(w, actorId, spell, effect, aimed.targetId, aimed.zoneId, ctx);
      summaries.push(...r.summaries);
      lines.push(...r.lines);
    }
  }
  const outcome = check.value.effective.degree;
  return ok({
    events: w.events,
    step: {
      actorId,
      action: a,
      outcome,
      summary: success
        ? `${name(actorId)} casts ${spell.name}${summaries.length ? `: ${summaries.join("; ")}` : "."}`
        : `${name(actorId)} casts ${spell.name} but the magic doesn't take.`,
      lines,
    },
  });
}

/** Exploration adapter: one cast is one step and a short pause. */
export function resolveExplorationCast(
  w: Working,
  actorId: ActorId,
  a: CastAction,
  ctx: SpellContext,
): Result<{
  events: EventDraft[];
  outcome: CastOutcome["step"]["outcome"];
  summary: string;
  lines: MechanicsLine[];
}> {
  const r = resolveCast(w, actorId, a, ctx, false);
  if (!r.ok) return r;
  return ok({
    events: r.value.events,
    outcome: r.value.step.outcome,
    summary: r.value.step.summary,
    lines: r.value.step.lines,
  });
}

import { type ActorId, averageDice, type CombatAction } from "@wyrd/core";
import { effectiveHpMax } from "../injury/hp.ts";
import { protectionAt } from "../injury/index.ts";
import { skillValue } from "../skills.ts";
import type { GameState } from "../state.ts";
import { apCost, validateCombatAction } from "./actions.ts";
import { strikeProblem } from "./attack.ts";
import {
  type CombatContext,
  canAct,
  combatant,
  combatOf,
  hasCondition,
  heldWeapon,
  isEngaged,
  isRangedWeapon,
  jitter,
  neighbours,
  propsIn,
  rangeBand,
  sheetOf,
  zoneOf,
  zoneTags,
} from "./common.ts";

/**
 * Deterministic utility AI (spec 03, "Enemy and companion tactics"). It enumerates short legal
 * plans (≤ the actor's AP), scores them on expected damage, focus fire, cover and the profile,
 * and picks the best. Ties break on a stable hash of the situation, so replays choose the same.
 */
export function chooseActions(state: GameState, actorId: ActorId, ctx: CombatContext): CombatAction[] {
  const me = combatant(state, actorId);
  if (!me || !canAct(state, actorId) || me.ap === 0) return [{ type: "endTurn" }];
  const depth = state.campaign.settings.difficulty; // story | standard | hard
  const plans = candidatePlans(state, actorId, ctx);
  let best: { plan: CombatAction[]; score: number } = { plan: [{ type: "endTurn" }], score: 0 };
  for (const plan of plans) {
    if (!fits(state, actorId, plan, ctx)) continue;
    const base = scorePlan(state, actorId, plan, ctx, depth);
    const score =
      base *
      (1 +
        ctx.tuning.fight.aiJitter *
          (jitter(combatOf(state).id, combatOf(state).round, actorId, JSON.stringify(plan)) - 0.5));
    if (score > best.score) best = { plan, score };
  }
  return best.plan;
}

/** The first action must be legal now; the AP of the whole plan must fit. Later steps are re-checked as they run. */
function fits(state: GameState, actorId: ActorId, plan: CombatAction[], ctx: CombatContext) {
  const me = combatant(state, actorId)!;
  if (validateCombatAction(state, actorId, plan[0]!, me.ap, ctx)) return false;
  const total = plan.reduce((s, a) => s + (a.type === "move" ? 1 : apCost(state, actorId, a, ctx)), 0);
  return total <= me.ap;
}

/** Next zone on a walking route from `from` to `to`, if there is one. */
function stepToward(state: GameState, from: string, to: string): string | undefined {
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const z = queue.shift()!;
    if (z === to) break;
    for (const n of neighbours(state, z)) {
      if (!prev.has(n.zoneId)) {
        prev.set(n.zoneId, z);
        queue.push(n.zoneId);
      }
    }
  }
  if (!prev.has(to)) return undefined;
  let z = to;
  while (prev.get(z) !== from && prev.get(z) !== z) z = prev.get(z)!;
  return z === from ? undefined : z;
}

function candidatePlans(state: GameState, actorId: ActorId, ctx: CombatContext): CombatAction[][] {
  const me = combatant(state, actorId)!;
  const plans: CombatAction[][] = [[{ type: "defend" }]];
  const here = zoneOf(state, actorId)!;
  const engagedFoes = combatOf(state).engaged.flatMap(([a, b]) =>
    a === actorId ? [b] : b === actorId ? [a] : [],
  );

  if (me.fleeing) {
    if (zoneTags(state, here).includes("exit")) return [[{ type: "flee" }]];
    const exit = (state.scene?.zones ?? []).find((z) => zoneTags(state, z.id).includes("exit"));
    const next = exit ? stepToward(state, here, exit.id) : undefined;
    const lead: CombatAction[] = engagedFoes.length ? [{ type: "disengage" }] : [];
    return next ? [[...lead, { type: "move", toZoneId: next }]] : [[...lead, { type: "defend" }]];
  }
  if (hasCondition(state, actorId, "core:prone")) plans.push([{ type: "standUp" }]);

  const weapon = heldWeapon(state, actorId, ctx);
  const ranged = isRangedWeapon(weapon);
  if (!me.loaded) plans.push([{ type: "reload" }]);

  const foes = Object.values(combatOf(state).combatants).filter(
    (c) => c.side !== me.side && canAct(state, c.actorId),
  );
  // With nobody left standing, a killer finishes the helpless.
  const targets = foes.length
    ? foes
    : combatOf(state).intent === "kill"
      ? Object.values(combatOf(state).combatants).filter(
          (c) =>
            c.side !== me.side &&
            !state.actors[c.actorId]?.dead &&
            ["active", "dying", "stable"].includes(c.status),
        )
      : [];
  const strikes = (t: ActorId, n: number): CombatAction[] =>
    Array.from({ length: n }, () => ({ type: "strike", targetId: t }));

  for (const t of targets) {
    const id = t.actorId;
    const tz = zoneOf(state, id);
    if (!tz) continue;
    if (ranged) {
      if (!strikeProblem({ state }, actorId, id, ctx)) {
        const reload = weapon!.reloadAp;
        plans.push(reload ? [{ type: "strike", targetId: id }] : strikes(id, 2));
        plans.push([
          { type: "aim", targetId: id },
          { type: "strike", targetId: id },
        ]);
        if (!hasCondition(state, actorId, "core:in-cover") && hasCover(state, actorId))
          plans.push([{ type: "takeCover" }, { type: "strike", targetId: id }]);
        if (engagedFoes.length) plans.push([{ type: "disengage" }, { type: "strike", targetId: id }]);
      } else if (!me.loaded) {
        plans.push([{ type: "reload" }, { type: "strike", targetId: id }]);
      } else {
        const next = stepToward(state, here, tz);
        if (next)
          plans.push([
            { type: "move", toZoneId: next },
            { type: "strike", targetId: id },
          ]);
      }
      continue;
    }
    if (isEngaged(state, actorId, id)) {
      plans.push(strikes(id, 3), strikes(id, 2), [{ type: "defend" }, { type: "strike", targetId: id }]);
    } else if (tz === here) {
      plans.push([{ type: "engage", targetId: id }, ...strikes(id, 2)]);
    } else {
      const next = stepToward(state, here, tz);
      if (next === tz)
        plans.push([
          { type: "move", toZoneId: next },
          { type: "engage", targetId: id },
          { type: "strike", targetId: id },
        ]);
      else if (next) plans.push([{ type: "move", toZoneId: next }]);
    }
  }
  return plans;
}

const hasCover = (state: GameState, id: ActorId) => {
  const z = zoneOf(state, id);
  return (
    !!z &&
    (propsIn(state, z).some((p) => p.affordances.includes("cover")) ||
      zoneTags(state, z).some((t) => t.startsWith("cover")))
  );
};

function hitChance(state: GameState, attackerId: ActorId, targetId: ActorId, ctx: CombatContext): number {
  const weapon = heldWeapon(state, attackerId, ctx);
  const skill = skillValue(
    sheetOf(state, attackerId),
    weapon?.skill ?? "core:unarmed",
    ctx.skills,
    ctx.tuning,
  );
  const band = rangeBand(state, attackerId, targetId);
  const bandMod = band ? ((weapon ? weapon.ranges : { engaged: 0 })[band] ?? -40) : -40;
  const cover = sheetOf(state, targetId).status.conditions.find((c) => c.id === "core:in-cover");
  const coverMod =
    cover && band !== "engaged"
      ? cover.variant === "full"
        ? ctx.tuning.fight.cover.full
        : ctx.tuning.fight.cover.partial
      : 0;
  const p = Math.min(95, Math.max(5, skill + bandMod + coverMod)) / 100;
  const t = combatant(state, targetId);
  const defends = t && canAct(state, targetId) && (t.reaction || t.defendReaction);
  return defends ? p * 0.65 : p;
}

function expectedDamage(
  state: GameState,
  attackerId: ActorId,
  targetId: ActorId,
  ctx: CombatContext,
): number {
  const weapon = heldWeapon(state, attackerId, ctx);
  const dice = weapon?.damage ?? ctx.tuning.combat.unarmed.damage;
  const type = weapon?.damageType ?? ctx.tuning.combat.unarmed.damageType;
  const str = sheetOf(state, attackerId).attributes.str;
  const bonus =
    weapon?.strengthBonus === false
      ? 0
      : Math.floor((str - ctx.tuning.combat.strBonusBase) / ctx.tuning.combat.strBonusDivisor);
  const worn = sheetOf(state, targetId).equipment.worn.flatMap((id) =>
    ctx.items.armor[id] ? [ctx.items.armor[id]!] : [],
  );
  const armour = Math.max(
    0,
    protectionAt(worn, "torso", type, ctx.tuning.combat.maxArmourLayers) - (weapon?.armorPiercing ?? 0),
  );
  return Math.max(0.5, averageDice(dice) + bonus - armour);
}

function scorePlan(
  state: GameState,
  actorId: ActorId,
  plan: CombatAction[],
  ctx: CombatContext,
  depth: "story" | "standard" | "hard",
): number {
  const me = combatant(state, actorId)!;
  const f = ctx.tuning.fight;
  let score = 0.1;
  let attacks = me.attacks;
  let aim = me.aim;
  for (const a of plan) {
    if (a.type === "strike") {
      const t = a.targetId;
      const weapon = heldWeapon(state, actorId, ctx);
      const row = weapon?.tags.includes("agile") ? f.agileMultiAttack : f.multiAttack;
      const multi = (row[Math.min(attacks, row.length - 1)] ?? 0) / 100;
      const p = Math.max(
        0.05,
        hitChance(state, actorId, t, ctx) + multi + (isRangedWeapon(weapon) ? (aim * f.aimBonus) / 100 : 0),
      );
      let value = p * expectedDamage(state, actorId, t, ctx);
      if (depth !== "story") {
        const sheet = sheetOf(state, t);
        const frac = sheet.status.hp / Math.max(1, effectiveHpMax(sheet));
        value *= 1 + (1 - frac) * 0.6; // focus fire on the weakened
        if (combatant(state, t)?.leader) value *= 1.2;
      }
      if (depth === "hard" && sheetOf(state, t).status.hp === 0 && canAct(state, t)) value *= 1.8; // finish the downed-but-dangerous
      if (state.actors[t]?.role === "pc") value *= 1.1;
      score += value;
      attacks++;
      aim = 0;
    } else if (a.type === "aim") {
      aim++;
    } else if (a.type === "takeCover" && depth !== "story") {
      score += threatFromRange(state, actorId, ctx) * 0.6;
    } else if (a.type === "defend") {
      score += me.tactics === "defensive" || me.tactics === "protector" ? 1.2 : 0.3;
      const sheet = sheetOf(state, actorId);
      if (sheet.status.hp / Math.max(1, effectiveHpMax(sheet)) < 0.5)
        score += me.tactics === "cowardly" ? 2 : 0.5;
    } else if (a.type === "move" || a.type === "engage") {
      score += 0.2; // closing in is worth a little on its own
    } else if (a.type === "reload" || a.type === "standUp") {
      score += 1;
    }
  }
  const weights: Record<string, number> = {
    aggressive: 1.2,
    berserk: 1.4,
    defensive: 0.9,
    cowardly: 0.8,
    sniper: 1,
    cunning: 1.1,
    protector: 1,
    caster: 1,
  };
  return score * (weights[me.tactics] ?? 1);
}

/** How much incoming ranged damage the actor faces from opponents who can see them. */
function threatFromRange(state: GameState, actorId: ActorId, ctx: CombatContext): number {
  const me = combatant(state, actorId)!;
  return Object.values(combatOf(state).combatants)
    .filter(
      (c) =>
        c.side !== me.side && canAct(state, c.actorId) && isRangedWeapon(heldWeapon(state, c.actorId, ctx)),
    )
    .filter(
      (c) =>
        !strikeProblem({ state }, c.actorId, actorId, ctx) ||
        strikeProblem({ state }, c.actorId, actorId, ctx)?.code === "NEEDS_RELOAD",
    )
    .reduce(
      (s, c) =>
        s + hitChance(state, c.actorId, actorId, ctx) * expectedDamage(state, c.actorId, actorId, ctx),
      0,
    );
}

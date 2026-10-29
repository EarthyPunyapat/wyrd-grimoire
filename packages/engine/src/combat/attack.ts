import { type ActorId, draft, findBodyPlan, type MechanicsLine, type Modifier } from "@wyrd/core";
import { resolveCheck } from "../checks.ts";
import { resolveHit } from "../injury/index.ts";
import { degradeItem, spendAmmo } from "../inventory.ts";
import { compareResults, isSuccess } from "../resolution/index.ts";
import { fail, ok, type Result } from "../result.ts";
import { skillValue } from "../skills.ts";
import type { Working } from "../working.ts";
import {
  type CombatContext,
  type CombatStep,
  canAct,
  combatant,
  combatOf,
  hasCondition,
  heldWeapon,
  isRangedWeapon,
  lineOfSight,
  rangeBand,
  replaceCombatant,
  sheetOf,
  zoneOf,
  zoneTags,
} from "./common.ts";

export type StrikeOptions = {
  weaponId?: string;
  calledLocation?: string;
  /** An opportunity attack uses the attacker's reaction, not AP, and doesn't count toward multi-attack. */
  opportunity?: boolean;
  /** Extra modifiers (disarm attempts). */
  extra?: Modifier[];
  /** Resolve as a disarm: a win knocks the weapon from the target's hand instead of dealing damage. */
  disarm?: boolean;
};

const unarmed = "unarmed";

/** Why a strike isn't possible right now, or null. Shared by validation and the AI. */
export function strikeProblem(
  w: { state: Working["state"] },
  attackerId: ActorId,
  targetId: ActorId,
  ctx: CombatContext,
  weaponId?: string,
  calledLocation?: string,
): { code: string; message: string } | null {
  const state = w.state;
  const target = combatant(state, targetId);
  if (!target) return { code: "TARGET_NOT_IN_FIGHT", message: `${ctx.nameOf(targetId)} isn't in this fight` };
  if (target.side === combatant(state, attackerId)?.side)
    return { code: "TARGET_FRIENDLY", message: `${ctx.nameOf(targetId)} is on your side` };
  if (state.actors[targetId]?.dead || ["dead", "fled"].includes(target.status))
    return { code: "TARGET_GONE", message: `${ctx.nameOf(targetId)} is out of the fight` };
  const weapon = heldWeapon(state, attackerId, ctx, weaponId);
  if (weaponId && !weapon) {
    const carried = sheetOf(state, attackerId).equipment.carried.some((c) => c.item === weaponId);
    return carried
      ? { code: "WEAPON_NOT_DRAWN", message: `${ctx.nameOf(weaponId)} isn't in hand` }
      : { code: "WEAPON_UNKNOWN", message: `No weapon ${weaponId}` };
  }
  const band = rangeBand(state, attackerId, targetId);
  if (!band)
    return { code: "TARGET_UNREACHABLE", message: `${ctx.nameOf(targetId)} can't be reached from here` };
  const bands = weapon ? weapon.ranges : { engaged: 0 };
  if (bands[band] === undefined) {
    if (band === "close" && bands.engaged !== undefined)
      return { code: "NOT_ENGAGED", message: `You need to close in on ${ctx.nameOf(targetId)} first` };
    return {
      code: "OUT_OF_RANGE",
      message: `${weapon?.name ?? "Bare hands"} can't reach ${ctx.nameOf(targetId)} at ${band} range`,
    };
  }
  if (isRangedWeapon(weapon) && band !== "engaged" && !lineOfSight(state, attackerId, targetId))
    return { code: "NO_LINE_OF_SIGHT", message: `You can't see ${ctx.nameOf(targetId)} from here` };
  if (weapon && weapon.reloadAp > 0 && !combatant(state, attackerId)?.loaded)
    return { code: "NEEDS_RELOAD", message: `${weapon.name} needs reloading (${weapon.reloadAp} AP)` };
  if (calledLocation) {
    const plan = findBodyPlan(ctx.bodyPlans, sheetOf(state, targetId).bodyPlan);
    if (!plan?.locations.some((l) => l.id === calledLocation))
      return {
        code: "LOCATION_UNKNOWN",
        message: `Called shots on ${ctx.nameOf(targetId)} can aim at: ${(plan?.locations ?? []).map((l) => l.id).join(", ")}`,
      };
  }
  return null;
}

/** Defence choice for a target that can react: Parry (melee only, needs a melee weapon) or Dodge. */
function defenceSkill(w: Working, defenderId: ActorId, melee: boolean, ctx: CombatContext) {
  const state = w.state;
  const sheet = sheetOf(state, defenderId);
  const dodge = skillValue(sheet, "core:dodge", ctx.skills, ctx.tuning);
  const weapon = heldWeapon(state, defenderId, ctx);
  if (melee && weapon && !isRangedWeapon(weapon)) {
    const parry = skillValue(sheet, weapon.skill, ctx.skills, ctx.tuning);
    if (parry > dodge) return { skill: weapon.skill, label: "Parry" };
  }
  return { skill: "core:dodge", label: "Dodge" };
}

/**
 * One attack (spec 03, "Attacks"): attack check with modifiers, the target's Dodge/Parry if it
 * can react, then hit location, damage and wounds through `resolveHit`.
 */
export function resolveStrike(
  w: Working,
  attackerId: ActorId,
  targetId: ActorId,
  ctx: CombatContext,
  opts: StrikeOptions = {},
): Result<CombatStep> {
  const problem = strikeProblem(w, attackerId, targetId, ctx, opts.weaponId, opts.calledLocation);
  if (problem) return fail(problem.code, problem.message);
  const f = ctx.tuning.fight;
  const state = w.state;
  const attacker = combatant(state, attackerId)!;
  const target = combatant(state, targetId)!;
  const weapon = heldWeapon(state, attackerId, ctx, opts.weaponId);
  const ranged = isRangedWeapon(weapon);
  const band = rangeBand(state, attackerId, targetId)!;
  const name = ctx.nameOf;
  const lines: MechanicsLine[] = [];

  const modifiers: Modifier[] = [];
  const bandMod = (weapon ? weapon.ranges : { engaged: 0 })[band] ?? 0;
  if (bandMod) modifiers.push({ source: `${band} range`, value: bandMod });
  if (!opts.opportunity) {
    const row = weapon?.tags.includes("agile") ? f.agileMultiAttack : f.multiAttack;
    const multi = row[Math.min(attacker.attacks, row.length - 1)] ?? 0;
    if (multi) modifiers.push({ source: `attack ${attacker.attacks + 1} this turn`, value: multi });
  }
  if (ranged && attacker.aim) modifiers.push({ source: "aimed", value: attacker.aim * f.aimBonus });
  const cover = state.actors[targetId]?.sheet.status.conditions.find((c) => c.id === "core:in-cover");
  if (cover && band !== "engaged") {
    const v = cover.variant === "full" ? f.cover.full : f.cover.partial;
    modifiers.push({ source: `target in ${cover.variant} cover`, value: v });
  }
  const zone = zoneOf(state, targetId);
  const tags = zone ? zoneTags(state, zone) : [];
  const light = tags.includes("dark")
    ? "dark"
    : tags.includes("dim") || state.scene?.light === "dim"
      ? "dim"
      : null;
  if (
    light &&
    state.campaign.settings.subsystems.lightingAndVision &&
    !hasCondition(state, attackerId, "core:blinded")
  )
    modifiers.push({ source: light === "dark" ? "darkness" : "dim light", value: f.light[light] });
  const size = f.size[target.size].toHit;
  if (size) modifiers.push({ source: `${target.size} target`, value: size });
  if (opts.calledLocation) {
    const plan = findBodyPlan(ctx.bodyPlans, sheetOf(state, targetId).bodyPlan);
    const kind = plan?.locations.find((l) => l.id === opts.calledLocation)?.kind;
    if (kind) modifiers.push({ source: `called shot (${opts.calledLocation})`, value: f.calledShot[kind] });
  }
  modifiers.push(...(opts.extra ?? []));

  // Unaware or helpless targets get no defence and the attacker gains a boon.
  const helpless =
    !canAct(state, targetId) ||
    hasCondition(state, targetId, "core:unconscious") ||
    hasCondition(state, targetId, "core:restrained") ||
    target.surprised;
  const hand = sheetOf(state, attackerId).equipment.held.main === weapon?.id ? "right" : "left";
  const attack = resolveCheck(
    state,
    {
      actorId: attackerId,
      skill: weapon?.skill ?? "core:unarmed",
      difficulty: "normal",
      modifiers,
      boons: helpless ? 1 : 0,
      purpose: `${opts.disarm ? "disarm" : "attack"} ${name(targetId)}`,
      tags: ["attack", ranged ? "ranged" : "melee", `hand:${hand}`],
    },
    ctx,
  );
  if (!attack.ok) return attack;
  w.apply(attack.value.events);
  lines.push(attack.value.effective.display);

  // Ammunition leaves the quiver with the shot (spec 11, Ammo).
  if (ranged && weapon) {
    const kind = Object.values(ctx.ammo ?? {}).find((a) => a.weapons.includes(weapon.id));
    if (kind?.items[0]) w.apply(spendAmmo(w.state, attackerId, kind.items[0], 1, `shot ${weapon.name}`));
  }
  // A fumbled attack can damage the weapon (spec 11, Durability).
  if (weapon && attack.value.effective.degree === "critFailure")
    w.apply(degradeItem(w.state, attackerId, weapon.id, "a fumbled attack"));

  // Spend the attack: multi-attack count, aim, ammunition.
  let me = combatant(w.state, attackerId)!;
  me = {
    ...me,
    attacks: opts.opportunity ? me.attacks : me.attacks + 1,
    aim: ranged ? 0 : me.aim,
    loaded: weapon && weapon.reloadAp > 0 ? false : me.loaded,
    reaction: opts.opportunity ? false : me.reaction,
  };
  w.apply([draft("CombatChanged", { combat: replaceCombatant(combatOf(w.state), me) }, "engine")]);

  const weaponName = weapon?.name.toLowerCase() ?? unarmed;
  if (!isSuccess(attack.value.effective.degree)) {
    return ok({
      actorId: attackerId,
      action: { type: "strike", targetId },
      outcome: attack.value.effective.degree,
      summary: `${name(attackerId)} attacked ${name(targetId)} with ${weaponName} and missed.`,
      lines,
    });
  }

  // Defence: an aware target with a reaction (or Defend's extra one) may Dodge or Parry.
  const defender = combatant(w.state, targetId)!;
  const canDefend = !helpless && (defender.reaction || defender.defendReaction);
  if (canDefend) {
    const d = defenceSkill(w, targetId, !ranged, ctx);
    const defence = resolveCheck(
      w.state,
      {
        actorId: targetId,
        skill: d.skill,
        difficulty: "normal",
        modifiers: defender.defending ? [{ source: "defending", value: f.defendBonus }] : [],
        purpose: `${d.label.toLowerCase()} ${name(attackerId)}'s attack`,
        tags: ["defence"],
      },
      ctx,
    );
    if (!defence.ok) return defence;
    w.apply(defence.value.events);
    lines.push({
      ...defence.value.effective.display,
      text: `${d.label}: ${defence.value.effective.display.text}`,
    });
    const spent = defender.defendReaction ? { defendReaction: false } : { reaction: false };
    w.apply([
      draft(
        "CombatChanged",
        { combat: replaceCombatant(combatOf(w.state), { ...combatant(w.state, targetId)!, ...spent }) },
        "engine",
      ),
    ]);
    if (compareResults(attack.value.effective, defence.value.effective) === "defender") {
      return ok({
        actorId: attackerId,
        action: { type: "strike", targetId },
        outcome: "failure",
        summary: `${name(attackerId)} attacked ${name(targetId)}, who ${d.label === "Parry" ? "parried" : "dodged"} it.`,
        lines,
      });
    }
  }

  if (opts.disarm) {
    const held = sheetOf(w.state, targetId).equipment;
    const dropped = held.held.main ?? held.held.off;
    if (dropped) {
      w.apply([
        draft(
          "EquipmentChanged",
          {
            actorId: targetId,
            equipment: {
              ...held,
              held: {
                main: held.held.main === dropped ? null : held.held.main,
                off: held.held.off === dropped ? null : held.held.off,
              },
            },
          },
          "engine",
        ),
      ]);
    }
    return ok({
      actorId: attackerId,
      action: { type: "disarm", targetId },
      outcome: attack.value.effective.degree,
      summary: dropped
        ? `${name(attackerId)} knocked ${name(dropped)} out of ${name(targetId)}'s hand.`
        : `${name(attackerId)} got past ${name(targetId)}'s guard, but they held nothing.`,
      lines,
    });
  }

  const hit = resolveHit(
    w.state,
    {
      attackerId,
      targetId,
      weaponId: weapon?.id ?? null,
      degree: attack.value.effective.degree === "critSuccess" ? "critSuccess" : "success",
      ...(opts.calledLocation ? { calledLocation: opts.calledLocation } : {}),
    },
    ctx,
  );
  if (!hit.ok) return hit;
  w.apply(hit.value.events);
  const h = hit.value;
  const where = h.location.replace(/-/g, " ");
  const woundText = h.wound ? ` · ${h.wound.severity} wound` : "";
  lines.push({ text: `Hit ${where}: ${h.final} damage${woundText}${h.downed ? ` · ${h.downed}` : ""}` });

  const parts = [`${name(attackerId)} hit ${name(targetId)} in the ${where} with ${weaponName}`];
  if (h.final === 0) parts.push("but it didn't get through");
  else if (h.wound) parts.push(`leaving a ${h.wound.severity} wound`);
  else parts.push("a glancing blow");
  let summary = `${parts.join(", ")}.`;
  if (h.downed === "unconscious") summary += ` ${name(targetId)} collapsed, unconscious.`;
  else if (h.downed === "down") summary += ` ${name(targetId)} is down but still fighting.`;
  for (const b of h.beats) summary += ` (${b})`;

  // Wound consequences the fight tracks: drop the item in a wounded hand; lethal fate.
  if (h.wound?.locationKind === "arm" && h.wound.side) {
    const eff =
      ctx.tuning.combat.woundEffects.arm[h.wound.severity === "lethal" ? "critical" : h.wound.severity];
    if ((eff.dropHeld || eff.armUseless) && w.state.campaign.settings.subsystems.injuries === "realistic") {
      const eq = sheetOf(w.state, targetId).equipment;
      const slot = h.wound.side === "right" ? "main" : "off";
      if (eq.held[slot]) {
        summary += ` ${name(targetId)} dropped ${name(eq.held[slot]!)}.`;
        w.apply([
          draft(
            "EquipmentChanged",
            { actorId: targetId, equipment: { ...eq, held: { ...eq.held, [slot]: null } } },
            "engine",
          ),
        ]);
      }
    }
  }
  if (h.lethal) {
    const t = combatant(w.state, targetId)!;
    if (h.lethal.immediate && h.lethal.fate === "dying") {
      if (spendLuckToSurvive(w, targetId, h.lethal.woundId, ctx)) {
        summary += ` By sheer luck, ${name(targetId)} survived a killing blow.`;
      } else {
        w.apply([
          draft("ActorDied", { actorId: targetId, cause: `killed by ${name(attackerId)}` }, "engine"),
        ]);
        w.apply([
          draft(
            "CombatChanged",
            { combat: replaceCombatant(combatOf(w.state), { ...t, status: "dead" }) },
            "engine",
          ),
        ]);
        summary += ` ${name(targetId)} was killed.`;
      }
    } else if (h.lethal.fate === "defeated") {
      w.apply([
        draft(
          "CombatChanged",
          { combat: replaceCombatant(combatOf(w.state), { ...t, status: "defeated" }) },
          "engine",
        ),
      ]);
      summary += ` ${name(targetId)} is mortally hurt and out of the fight.`;
    } else {
      w.apply([
        draft(
          "CombatChanged",
          {
            combat: replaceCombatant(combatOf(w.state), {
              ...t,
              status: "dying",
              // Another mortal wound never buys time: keep the shorter clock.
              dyingRounds: Math.min(t.dyingRounds ?? h.lethal.deathInRounds, h.lethal.deathInRounds),
            }),
          },
          "engine",
        ),
      ]);
      summary += ` ${name(targetId)} is dying.`;
    }
  }
  return ok({
    actorId: attackerId,
    action: { type: "strike", targetId },
    outcome: attack.value.effective.degree,
    summary,
    lines,
  });
}

/** A hardcore PC facing instant death spends 2 Luck to downgrade the wound when they have it (D84). */
function spendLuckToSurvive(w: Working, actorId: ActorId, woundId: string, ctx: CombatContext): boolean {
  const actor = w.state.actors[actorId];
  if (actor?.role !== "pc") return false;
  const cost = ctx.tuning.luckCost.downgradeWound;
  if (actor.sheet.status.luck < cost) return false;
  w.apply([draft("LuckSpent", { actorId, amount: cost, purpose: "downgradeWound", woundId }, "player")]);
  return true;
}

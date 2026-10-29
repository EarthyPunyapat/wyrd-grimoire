import {
  type ActorId,
  type CombatAction,
  type CombatActionInput,
  type CombatState,
  draft,
  type MechanicsLine,
  type StuntEffect,
} from "@wyrd/core";
import { resolveCheck, resolveOpposedCheck } from "../checks.ts";
import { applyCondition, removeCondition } from "../conditions.ts";
import { isSuccess } from "../resolution/index.ts";
import { fail, ok, type Result } from "../result.ts";
import type { GameState } from "../state.ts";
import type { Working } from "../working.ts";
import { resolveStrike, strikeProblem } from "./attack.ts";
import {
  type CombatContext,
  type CombatStep,
  canAct,
  combatant,
  combatOf,
  engagedWith,
  hasCondition,
  isEngaged,
  neighbours,
  propsIn,
  replaceCombatant,
  sheetOf,
  weaponById,
  zoneOf,
  zoneTags,
} from "./common.ts";

export type ActionError = { code: string; message: string; legalAlternatives?: CombatActionInput[] };

/** AP an action costs this actor now (spec 03 AP table; wounds can raise Move to 2). */
export function apCost(state: GameState, actorId: ActorId, a: CombatAction, ctx: CombatContext): number {
  const f = ctx.tuning.fight;
  if (a.type === "reload") {
    const held = sheetOf(state, actorId).equipment.held;
    const w = weaponById(ctx, held.main) ?? weaponById(ctx, held.off);
    return w?.reloadAp ?? 0;
  }
  if (a.type === "move") {
    const here = zoneOf(state, actorId);
    const edge = here ? neighbours(state, here).find((n) => n.zoneId === a.toZoneId) : undefined;
    const woundCost = Math.max(
      0,
      ...sheetOf(state, actorId).status.wounds.map((wd) =>
        state.campaign.settings.subsystems.injuries === "realistic"
          ? (ctx.tuning.combat.woundEffects[wd.locationKind][
              wd.severity === "lethal" ? "critical" : wd.severity
            ].moveCost ?? 0)
          : 0,
      ),
    );
    return Math.max(edge?.cost ?? f.apCost.move ?? 1, woundCost);
  }
  return f.apCost[a.type] ?? 1;
}

const cantStand = (state: GameState, id: ActorId, ctx: CombatContext) =>
  state.campaign.settings.subsystems.injuries === "realistic" &&
  sheetOf(state, id).status.wounds.some(
    (w) =>
      w.locationKind === "leg" &&
      (w.severity === "critical" || w.severity === "lethal") &&
      ctx.tuning.combat.woundEffects.leg.critical.cantStand,
  );

const sameZone = (state: GameState, a: ActorId, b: ActorId) =>
  !!zoneOf(state, a) && zoneOf(state, a) === zoneOf(state, b);

function coverAt(state: GameState, actorId: ActorId, propId?: string): "partial" | "full" | null {
  const zone = zoneOf(state, actorId);
  if (!zone) return null;
  const tags = zoneTags(state, zone);
  if (!propId && tags.includes("coverFull")) return "full";
  const props = propsIn(state, zone).filter((p) => p.affordances.includes("cover"));
  if (propId) return props.some((p) => p.id === propId) ? "partial" : null;
  if (props.length || tags.includes("coverPartial")) return "partial";
  return null;
}

/** Supplies for first aid: bandages or a healer's kit in the pack, else improvised cloth. */
const hasSupplies = (state: GameState, id: ActorId) =>
  sheetOf(state, id).equipment.carried.some((c) => /bandage|healer/.test(c.item));

/** Validates one action against the current state and the AP left. */
export function validateCombatAction(
  state: GameState,
  actorId: ActorId,
  a: CombatAction,
  apLeft: number,
  ctx: CombatContext,
): ActionError | null {
  const err = (code: string, message: string, legalAlternatives?: CombatActionInput[]): ActionError => ({
    code,
    message,
    ...(legalAlternatives?.length ? { legalAlternatives } : {}),
  });
  const me = combatant(state, actorId);
  if (!me) return err("NOT_IN_FIGHT", "You're not in this fight");
  if (!canAct(state, actorId)) return err("CANNOT_ACT", `${ctx.nameOf(actorId)} can't act`);
  const cost = apCost(state, actorId, a, ctx);
  if (cost > apLeft)
    return err(
      "NOT_ENOUGH_AP",
      `${a.type} needs ${cost} AP; ${apLeft} left this turn`,
      apLeft > 0 ? [{ type: "defend" }] : [{ type: "endTurn" }],
    );
  const name = ctx.nameOf;
  const prone = hasCondition(state, actorId, "core:prone");

  switch (a.type) {
    case "strike": {
      const p = strikeProblem({ state }, actorId, a.targetId, ctx, a.weaponId, a.calledLocation);
      if (!p) return null;
      if (p.code === "NOT_ENGAGED") return err(p.code, p.message, [{ type: "engage", targetId: a.targetId }]);
      if (p.code === "NEEDS_RELOAD") return err(p.code, p.message, [{ type: "reload" }]);
      if (p.code === "WEAPON_NOT_DRAWN" && a.weaponId)
        return err(p.code, p.message, [{ type: "draw", weaponId: a.weaponId }]);
      if (p.code === "OUT_OF_RANGE" || p.code === "TARGET_UNREACHABLE") {
        const tz = zoneOf(state, a.targetId);
        const here = zoneOf(state, actorId);
        const step = here && tz ? neighbours(state, here).find((n) => n.zoneId === tz) : undefined;
        return err(p.code, p.message, step ? [{ type: "move", toZoneId: step.zoneId }] : undefined);
      }
      return err(p.code, p.message);
    }
    case "move": {
      const here = zoneOf(state, actorId);
      if (!here) return err("NOT_IN_SCENE", "You're not in the scene");
      if (hasCondition(state, actorId, "core:grappled") || hasCondition(state, actorId, "core:restrained"))
        return err("HELD", "You're held and can't move");
      if (prone) return err("PRONE", "You need to stand up first", [{ type: "standUp" }]);
      if (a.toZoneId === here) return err("ALREADY_THERE", `Already in ${name(here)}`);
      const n = neighbours(state, here);
      if (!n.some((x) => x.zoneId === a.toZoneId))
        return err(
          "ZONE_NOT_ADJACENT",
          `${name(a.toZoneId)} isn't next to ${name(here)}`,
          n.map((x) => ({ type: "move" as const, toZoneId: x.zoneId })),
        );
      return null;
    }
    case "engage":
      if (!combatant(state, a.targetId))
        return err("TARGET_NOT_IN_FIGHT", `${name(a.targetId)} isn't in this fight`);
      if (isEngaged(state, actorId, a.targetId))
        return err("ALREADY_ENGAGED", `Already fighting ${name(a.targetId)}`);
      if (!sameZone(state, actorId, a.targetId)) {
        const tz = zoneOf(state, a.targetId);
        const here = zoneOf(state, actorId);
        const step = here && tz ? neighbours(state, here).find((n) => n.zoneId === tz) : undefined;
        return err(
          "NOT_IN_ZONE",
          `${name(a.targetId)} isn't close enough`,
          step ? [{ type: "move", toZoneId: step.zoneId }] : undefined,
        );
      }
      if (prone) return err("PRONE", "You need to stand up first", [{ type: "standUp" }]);
      return null;
    case "disengage":
      return engagedWith(state, actorId).length ? null : err("NOT_ENGAGED", "You're not engaged with anyone");
    case "aim":
      return me.aim >= ctx.tuning.fight.maxAim ? err("AIM_MAXED", "You can't aim any steadier") : null;
    case "defend":
      return me.defending ? err("ALREADY_DEFENDING", "You're already on the defensive") : null;
    case "takeCover":
      if (hasCondition(state, actorId, "core:in-cover"))
        return err("ALREADY_IN_COVER", "You're already in cover");
      return coverAt(state, actorId, a.propId) ? null : err("NO_COVER", "There's no cover here");
    case "draw": {
      const w = weaponById(ctx, a.weaponId);
      if (!w) return err("WEAPON_UNKNOWN", `${name(a.weaponId)} isn't a weapon`);
      const eq = sheetOf(state, actorId).equipment;
      if (!eq.carried.some((c) => c.item === a.weaponId))
        return err("ITEM_NOT_CARRIED", `You don't have ${w.name}`);
      if (eq.held.main === a.weaponId) return err("ALREADY_HELD", `${w.name} is already in hand`);
      return null;
    }
    case "reload": {
      const held = sheetOf(state, actorId).equipment.held;
      const w = weaponById(ctx, held.main) ?? weaponById(ctx, held.off);
      if (!w || w.reloadAp === 0) return err("NOTHING_TO_RELOAD", "Nothing in hand needs reloading");
      return me.loaded ? err("ALREADY_LOADED", `${w.name} is already loaded`) : null;
    }
    case "firstAid": {
      if (!combatant(state, a.targetId) && a.targetId !== actorId)
        return err("TARGET_NOT_IN_FIGHT", `${name(a.targetId)} isn't here`);
      if (!sameZone(state, actorId, a.targetId) && a.targetId !== actorId)
        return err("NOT_IN_ZONE", `${name(a.targetId)} is too far away`);
      const t = combatant(state, a.targetId);
      const bleeding = hasCondition(state, a.targetId, "core:bleeding");
      if (!bleeding && t?.status !== "dying")
        return err("NOTHING_TO_TREAT", `${name(a.targetId)} isn't bleeding or dying`);
      return null;
    }
    case "standUp":
      if (!prone) return err("NOT_PRONE", "You're already on your feet");
      return cantStand(state, actorId, ctx) ? err("CANNOT_STAND", "Your leg won't hold you") : null;
    case "shove":
    case "trip":
    case "grapple":
    case "disarm":
    case "intimidate": {
      const t = combatant(state, a.targetId);
      if (!t || (!canAct(state, a.targetId) && a.type !== "disarm"))
        return err("TARGET_NOT_IN_FIGHT", `${name(a.targetId)} isn't fighting`);
      if (t?.side === me.side) return err("TARGET_FRIENDLY", `${name(a.targetId)} is on your side`);
      if (a.type === "intimidate")
        return sameZone(state, actorId, a.targetId) || isEngaged(state, actorId, a.targetId)
          ? null
          : err("NOT_IN_ZONE", `${name(a.targetId)} can't hear you`);
      if (!isEngaged(state, actorId, a.targetId))
        return err(
          "NOT_ENGAGED",
          `You need to close in on ${name(a.targetId)} first`,
          sameZone(state, actorId, a.targetId) ? [{ type: "engage", targetId: a.targetId }] : undefined,
        );
      if (
        a.type === "shove" &&
        a.toZoneId &&
        !neighbours(state, zoneOf(state, a.targetId)!).some((n) => n.zoneId === a.toZoneId)
      )
        return err("ZONE_NOT_ADJACENT", `${name(a.toZoneId)} isn't next to ${name(a.targetId)}`);
      return null;
    }
    case "rally":
      if (combatant(state, a.targetId)?.side !== me.side)
        return err("TARGET_NOT_ALLY", `${name(a.targetId)} isn't on your side`);
      return hasCondition(state, a.targetId, "core:frightened")
        ? null
        : err("NOT_FRIGHTENED", `${name(a.targetId)} isn't frightened`);
    case "stunt":
      return validateStunt(state, actorId, a, ctx, err);
    case "speak":
    case "endTurn":
      return null;
    case "surrender":
      return me.side === "party" ? null : err("NOT_AVAILABLE", "Only the party can surrender here");
    case "flee": {
      const here = zoneOf(state, actorId);
      if (!here || !zoneTags(state, here).includes("exit")) {
        const exits = (state.scene?.zones ?? []).filter((z) => zoneTags(state, z.id).includes("exit"));
        const step = here
          ? neighbours(state, here).find((n) => exits.some((e) => e.id === n.zoneId))
          : undefined;
        return err(
          "NO_EXIT_HERE",
          exits.length ? "There's no way out from here" : "There's no way out of this fight",
          step ? [{ type: "move", toZoneId: step.zoneId }] : undefined,
        );
      }
      return null;
    }
  }
  return null;
}

type Err = (code: string, message: string, alt?: CombatActionInput[]) => ActionError;

/** Each stunt effect: the prop affordance it needs (any of), the skill, and whether it needs a target. */
const STUNTS: Record<StuntEffect, { needs: string[]; skill: string; target: boolean; mechanical: boolean }> =
  {
    createCover: { needs: ["topple", "cover"], skill: "core:athletics", target: false, mechanical: true },
    removeCover: { needs: [], skill: "core:athletics", target: true, mechanical: true },
    knockProne: { needs: [], skill: "core:athletics", target: true, mechanical: true },
    blind: { needs: [], skill: "core:throwing", target: true, mechanical: true },
    push: { needs: [], skill: "core:athletics", target: true, mechanical: true },
    disarm: { needs: [], skill: "core:melee", target: true, mechanical: true },
    extinguishLight: { needs: ["light"], skill: "core:athletics", target: false, mechanical: true },
    distract: { needs: [], skill: "core:deception", target: true, mechanical: true },
    createHazard: { needs: ["flammable"], skill: "core:athletics", target: false, mechanical: false },
    climb: { needs: ["climb"], skill: "core:athletics", target: false, mechanical: false },
    swing: { needs: ["climb", "swing"], skill: "core:acrobatics", target: false, mechanical: false },
    barricade: { needs: ["topple", "breakable"], skill: "core:athletics", target: false, mechanical: false },
    bindTarget: { needs: [], skill: "core:athletics", target: true, mechanical: false },
  };

function validateStunt(
  state: GameState,
  actorId: ActorId,
  a: Extract<CombatAction, { type: "stunt" }>,
  ctx: CombatContext,
  err: Err,
): ActionError | null {
  const spec = STUNTS[a.effect];
  const zone = zoneOf(state, actorId)!;
  if (spec.needs.length) {
    const props = propsIn(state, zone);
    const prop = a.propId
      ? props.find((p) => p.id === a.propId)
      : props.find((p) => spec.needs.some((n) => p.affordances.includes(n)));
    if (!prop)
      return err(
        "PROP_MISSING",
        `There's nothing here to ${a.effect.replace(/([A-Z])/g, " $1").toLowerCase()} with`,
      );
    if (!spec.needs.some((n) => prop.affordances.includes(n)))
      return err("PROP_CANT", `${ctx.nameOf(prop.id)} can't be used that way`);
  }
  if (spec.target) {
    if (!a.targetId) return err("TARGET_REQUIRED", "That needs a target");
    if (!combatant(state, a.targetId))
      return err("TARGET_NOT_IN_FIGHT", `${ctx.nameOf(a.targetId)} isn't in this fight`);
    if (!sameZone(state, actorId, a.targetId))
      return err("NOT_IN_ZONE", `${ctx.nameOf(a.targetId)} is too far away`);
  }
  return null;
}

const step = (
  actorId: ActorId,
  action: CombatAction,
  outcome: CombatStep["outcome"],
  summary: string,
  lines: MechanicsLine[] = [],
): CombatStep => ({
  actorId,
  action,
  outcome,
  summary,
  lines,
});

const setCombat = (w: Working, combat: CombatState) =>
  w.apply([draft("CombatChanged", { combat }, "engine")]);
const patch = (w: Working, id: ActorId, p: Partial<CombatState["combatants"][string]>) =>
  setCombat(w, replaceCombatant(combatOf(w.state), { ...combatant(w.state, id)!, ...p }));

/** Removes every engagement an actor is in. */
function breakEngagements(w: Working, id: ActorId) {
  const c = combatOf(w.state);
  setCombat(w, { ...c, engaged: c.engaged.filter(([x, y]) => x !== id && y !== id) });
}

/** Leaving melee without Disengage: each engaged enemy with a reaction gets an opportunity attack. */
function opportunityAttacks(w: Working, moverId: ActorId, ctx: CombatContext): CombatStep[] {
  const steps: CombatStep[] = [];
  for (const enemy of engagedWith(w.state, moverId)) {
    const e = combatant(w.state, enemy);
    if (!e || e.side === combatant(w.state, moverId)?.side || !e.reaction || !canAct(w.state, enemy))
      continue;
    const r = resolveStrike(w, enemy, moverId, ctx, { opportunity: true });
    if (r.ok) steps.push({ ...r.value, summary: `Opportunity attack: ${r.value.summary}` });
  }
  return steps;
}

function apply(w: Working, drafts: Result<ReturnType<typeof draft>[]>) {
  if (drafts.ok) w.apply(drafts.value);
}

function check(
  w: Working,
  actorId: ActorId,
  skill: string | { attribute: "wil" | "end" | "agi" },
  purpose: string,
  ctx: CombatContext,
  opts: { difficulty?: "easy" | "normal" | "hard"; modifiers?: { source: string; value: number }[] } = {},
) {
  const r = resolveCheck(
    w.state,
    {
      actorId,
      skill,
      difficulty: opts.difficulty ?? "normal",
      modifiers: opts.modifiers ?? [],
      purpose,
      tags: ["resist"],
    },
    ctx,
  );
  if (!r.ok) return null;
  w.apply(r.value.events);
  return r.value.effective;
}

function opposed(
  w: Working,
  actorId: ActorId,
  skill: string,
  targetId: ActorId,
  against: string,
  purpose: string,
  ctx: CombatContext,
) {
  const r = resolveOpposedCheck(
    w.state,
    { actorId, skill, difficulty: "normal", purpose, opposedBy: { actorId: targetId, skill: against } },
    ctx,
  );
  if (!r.ok) return null;
  w.apply(r.value.events);
  return r.value;
}

/** Spends the AP and resolves one validated action. Returns the steps it produced (opportunity attacks included). */
export function resolveCombatAction(
  w: Working,
  actorId: ActorId,
  a: CombatAction,
  ctx: CombatContext,
): Result<CombatStep[]> {
  const name = ctx.nameOf;
  const cost = apCost(w.state, actorId, a, ctx);
  const me = combatant(w.state, actorId)!;
  patch(w, actorId, { ap: Math.max(0, me.ap - cost) });

  switch (a.type) {
    case "strike": {
      const r = resolveStrike(w, actorId, a.targetId, ctx, {
        ...(a.weaponId ? { weaponId: a.weaponId } : {}),
        ...(a.calledLocation ? { calledLocation: a.calledLocation } : {}),
      });
      return r.ok ? ok([r.value]) : r;
    }
    case "disarm": {
      const r = resolveStrike(w, actorId, a.targetId, ctx, {
        disarm: true,
        extra: [{ source: "disarm attempt", value: ctx.tuning.fight.disarmPenalty }],
      });
      return r.ok ? ok([r.value]) : r;
    }
    case "move": {
      const from = zoneOf(w.state, actorId)!;
      const steps = opportunityAttacks(w, actorId, ctx);
      if (!canAct(w.state, actorId))
        return ok([...steps, step(actorId, a, "failure", `${name(actorId)} was cut down trying to leave.`)]);
      breakEngagements(w, actorId);
      if (hasCondition(w.state, actorId, "core:in-cover"))
        apply(w, removeCondition(w.state, actorId, "core:in-cover", "moved"));
      w.apply([draft("EntityMoved", { entityId: actorId, toZoneId: a.toZoneId }, "engine")]);
      return ok([
        ...steps,
        step(actorId, a, "done", `${name(actorId)} moved from ${name(from)} to ${name(a.toZoneId)}.`),
      ]);
    }
    case "engage": {
      const c = combatOf(w.state);
      setCombat(w, { ...c, engaged: [...c.engaged, [actorId, a.targetId]] });
      return ok([step(actorId, a, "done", `${name(actorId)} closed in on ${name(a.targetId)}.`)]);
    }
    case "disengage":
      breakEngagements(w, actorId);
      return ok([step(actorId, a, "done", `${name(actorId)} backed carefully out of the melee.`)]);
    case "aim":
      patch(w, actorId, { aim: Math.min(ctx.tuning.fight.maxAim, me.aim + 1) });
      return ok([
        step(
          actorId,
          a,
          "done",
          `${name(actorId)} took careful aim${a.targetId ? ` at ${name(a.targetId)}` : ""}.`,
        ),
      ]);
    case "defend":
      patch(w, actorId, { defending: true, defendReaction: true });
      return ok([step(actorId, a, "done", `${name(actorId)} went on the defensive.`)]);
    case "takeCover": {
      const variant = coverAt(w.state, actorId, a.propId)!;
      apply(w, applyCondition(w.state, actorId, { id: "core:in-cover", variant }));
      const prop = a.propId ? ` behind ${name(a.propId)}` : "";
      return ok([step(actorId, a, "done", `${name(actorId)} took ${variant} cover${prop}.`)]);
    }
    case "draw": {
      const eq = sheetOf(w.state, actorId).equipment;
      const weapon = weaponById(ctx, a.weaponId)!;
      const held = weapon.hands === 2 ? { main: a.weaponId, off: null } : { ...eq.held, main: a.weaponId };
      w.apply([draft("EquipmentChanged", { actorId, equipment: { ...eq, held } }, "engine")]);
      return ok([step(actorId, a, "done", `${name(actorId)} drew ${weapon.name.toLowerCase()}.`)]);
    }
    case "reload":
      patch(w, actorId, { loaded: true });
      return ok([step(actorId, a, "done", `${name(actorId)} reloaded.`)]);
    case "firstAid": {
      const supplies = hasSupplies(w.state, actorId);
      const dying = combatant(w.state, a.targetId)?.status === "dying";
      const f = ctx.tuning.fight;
      const res = check(
        w,
        actorId,
        "core:medicine",
        dying ? `stabilise ${name(a.targetId)}` : `bandage ${name(a.targetId)}`,
        ctx,
        {
          difficulty: dying ? (f.stabiliseDifficulty as "hard") : (f.firstAidDifficulty as "normal"),
          modifiers: supplies ? [] : [{ source: "improvised dressing", value: f.improvisedFirstAid }],
        },
      );
      if (!res) return fail("CHECK_FAILED", "First aid couldn't be attempted");
      if (!isSuccess(res.degree))
        return ok([
          step(
            actorId,
            a,
            res.degree,
            `${name(actorId)} tried to treat ${name(a.targetId)} but couldn't stop the bleeding.`,
            [res.display],
          ),
        ]);
      if (dying) {
        patch(w, a.targetId, { status: "stable" });
        return ok([
          step(actorId, a, res.degree, `${name(actorId)} stabilised ${name(a.targetId)}.`, [res.display]),
        ]);
      }
      const level = Math.max(
        0,
        (sheetOf(w.state, a.targetId).status.conditions.find((c) => c.id === "core:bleeding")?.level ?? 0) -
          (res.degree === "critSuccess" ? 2 : 1),
      );
      apply(
        w,
        level
          ? applyCondition(w.state, a.targetId, { id: "core:bleeding", level })
          : removeCondition(w.state, a.targetId, "core:bleeding", "first aid"),
      );
      return ok([
        step(
          actorId,
          a,
          res.degree,
          `${name(actorId)} bound ${name(a.targetId)}'s wounds${level ? " and slowed the bleeding" : " and stopped the bleeding"}.`,
          [res.display],
        ),
      ]);
    }
    case "standUp":
      apply(w, removeCondition(w.state, actorId, "core:prone", "stood up"));
      return ok([step(actorId, a, "done", `${name(actorId)} got back on their feet.`)]);
    case "shove":
    case "trip":
    case "grapple":
      return contest(w, actorId, a.type, a.targetId, ctx, a.type === "shove" ? a.toZoneId : undefined);
    case "intimidate": {
      const r = opposed(
        w,
        actorId,
        "core:intimidation",
        a.targetId,
        "core:intimidation",
        `intimidate ${name(a.targetId)}`,
        ctx,
      );
      if (!r) return fail("CHECK_FAILED", "Intimidation couldn't be attempted");
      const lines = [r.active.display];
      if (r.winner === "defender")
        return ok([
          step(
            actorId,
            a,
            "failure",
            `${name(actorId)} tried to cow ${name(a.targetId)}, who wasn't impressed.`,
            lines,
          ),
        ]);
      // A successful threat forces a morale check for the target's group at the end of the action.
      const c = combatOf(w.state);
      const group = combatant(w.state, a.targetId)!.group;
      setCombat(w, {
        ...c,
        morale: c.morale.filter((m) => m !== `${group}:forced`).concat(`${group}:force`),
      });
      return ok([
        step(
          actorId,
          a,
          r.active.degree,
          `${name(actorId)} rattled ${name(a.targetId)} with a threat.`,
          lines,
        ),
      ]);
    }
    case "rally":
      apply(w, removeCondition(w.state, a.targetId, "core:frightened", "rallied"));
      return ok([step(actorId, a, "done", `${name(actorId)} steadied ${name(a.targetId)}'s nerve.`)]);
    case "stunt":
      return resolveStunt(w, actorId, a, ctx);
    case "speak":
      return ok([step(actorId, a, "done", `${name(actorId)} said: "${a.utterance}"`)]);
    case "endTurn":
      patch(w, actorId, { ap: 0 });
      return ok([step(actorId, a, "done", `${name(actorId)} held position.`)]);
    case "surrender":
      return ok([step(actorId, a, "done", `${name(actorId)} threw down their weapon and surrendered.`)]);
    case "flee": {
      // Flee is Disengage then Move out (spec 03), so it doesn't provoke.
      breakEngagements(w, actorId);
      patch(w, actorId, { status: "fled", ap: 0 });
      w.apply([draft("EntityLeftScene", { entityId: actorId, reason: "fled the fight" }, "engine")]);
      return ok([step(actorId, a, "done", `${name(actorId)} fled the fight.`)]);
    }
  }
}

/** Shove, trip and grapple: opposed checks with a physical result (spec 03 AP table). */
function contest(
  w: Working,
  actorId: ActorId,
  kind: "shove" | "trip" | "grapple",
  targetId: ActorId,
  ctx: CombatContext,
  toZoneId?: string,
): Result<CombatStep[]> {
  const name = ctx.nameOf;
  const a = { type: kind, targetId } as CombatAction;
  const against = kind === "shove" ? "core:athletics" : "core:acrobatics";
  const skill = kind === "grapple" ? "core:unarmed" : "core:athletics";
  const r = opposed(w, actorId, skill, targetId, against, `${kind} ${name(targetId)}`, ctx);
  if (!r) return fail("CHECK_FAILED", `${kind} couldn't be attempted`);
  const lines = [r.active.display, { ...r.defender.display, text: `Resist: ${r.defender.display.text}` }];
  const won = r.winner !== "defender";
  const outcome = won ? (isSuccess(r.active.degree) ? r.active.degree : "success") : "failure";
  lines.push({ text: `${name(won ? actorId : targetId)} wins the ${kind} contest.`, degree: outcome });
  if (!won)
    return ok([
      step(
        actorId,
        a,
        "failure",
        `${name(actorId)} tried to ${kind} ${name(targetId)}, who held firm.`,
        lines,
      ),
    ]);
  if (kind === "trip") {
    apply(w, applyCondition(w.state, targetId, { id: "core:prone" }));
    return ok([
      step(actorId, a, outcome, `${name(actorId)} tripped ${name(targetId)}, who went sprawling.`, lines),
    ]);
  }
  if (kind === "grapple") {
    apply(w, applyCondition(w.state, targetId, { id: "core:grappled" }));
    return ok([step(actorId, a, outcome, `${name(actorId)} seized ${name(targetId)} in a grapple.`, lines)]);
  }
  const tz = zoneOf(w.state, targetId)!;
  const to = toZoneId ?? neighbours(w.state, tz)[0]?.zoneId;
  breakEngagements(w, targetId);
  if (to) w.apply([draft("EntityMoved", { entityId: targetId, toZoneId: to }, "engine")]);
  return ok([
    step(
      actorId,
      a,
      outcome,
      `${name(actorId)} shoved ${name(targetId)}${to ? ` back into ${name(to)}` : ""}.`,
      lines,
    ),
  ]);
}

function resolveStunt(
  w: Working,
  actorId: ActorId,
  a: Extract<CombatAction, { type: "stunt" }>,
  ctx: CombatContext,
): Result<CombatStep[]> {
  const spec = STUNTS[a.effect];
  const name = ctx.nameOf;
  const zone = zoneOf(w.state, actorId)!;
  const prop = spec.needs.length
    ? a.propId
      ? propsIn(w.state, zone).find((p) => p.id === a.propId)
      : propsIn(w.state, zone).find((p) => spec.needs.some((n) => p.affordances.includes(n)))
    : undefined;
  const what =
    a.description ||
    `${a.effect.replace(/([A-Z])/g, " $1").toLowerCase()}${prop ? ` with ${prop.name}` : ""}`;
  if (!spec.mechanical)
    return ok([
      step(
        actorId,
        a,
        "done",
        `${name(actorId)} tried to ${what}. (This stunt has no mechanical effect; it's colour.)`,
      ),
    ]);
  if (a.effect === "push") return contest(w, actorId, "shove", a.targetId!, ctx);

  let res = null as null | {
    degree: "critSuccess" | "success" | "failure" | "critFailure";
    display: MechanicsLine;
  };
  if (spec.target && a.effect !== "disarm") {
    const r = opposed(
      w,
      actorId,
      spec.skill,
      a.targetId!,
      a.effect === "distract" ? "core:insight" : "core:acrobatics",
      what,
      ctx,
    );
    if (!r) return fail("CHECK_FAILED", "The stunt couldn't be attempted");
    res = { degree: r.winner === "active" ? r.active.degree : "failure", display: r.active.display };
  } else if (a.effect !== "disarm") {
    res = check(w, actorId, spec.skill, what, ctx, {
      difficulty: ctx.tuning.fight.stuntDifficulty as "normal",
    });
  }
  if (a.effect === "disarm") {
    const r = resolveStrike(w, actorId, a.targetId!, ctx, {
      disarm: true,
      extra: [{ source: "disarm attempt", value: ctx.tuning.fight.disarmPenalty }],
    });
    return r.ok ? ok([r.value]) : r;
  }
  if (!res || !isSuccess(res.degree))
    return ok([
      step(
        actorId,
        a,
        res?.degree ?? "failure",
        `${name(actorId)} tried to ${what} and failed.`,
        res ? [res.display] : [],
      ),
    ]);
  const c = combatOf(w.state);
  const change = (id: string, add: string[], remove: string[]) => {
    const prev = c.props[id] ?? { add: [], remove: [] };
    setCombat(w, {
      ...c,
      props: { ...c.props, [id]: { add: [...prev.add, ...add], remove: [...prev.remove, ...remove] } },
    });
  };
  switch (a.effect) {
    case "createCover":
      change(prop!.id, ["cover"], ["topple"]);
      return ok([
        step(actorId, a, res.degree, `${name(actorId)} turned ${prop!.name} into cover.`, [res.display]),
      ]);
    case "removeCover":
      apply(w, removeCondition(w.state, a.targetId!, "core:in-cover", "cover removed"));
      return ok([
        step(actorId, a, res.degree, `${name(actorId)} drove ${name(a.targetId!)} out of cover.`, [
          res.display,
        ]),
      ]);
    case "knockProne":
      apply(w, applyCondition(w.state, a.targetId!, { id: "core:prone" }));
      return ok([
        step(actorId, a, res.degree, `${name(actorId)} knocked ${name(a.targetId!)} off their feet.`, [
          res.display,
        ]),
      ]);
    case "blind":
      apply(w, applyCondition(w.state, a.targetId!, { id: "core:blinded" }));
      return ok([
        step(actorId, a, res.degree, `${name(actorId)} blinded ${name(a.targetId!)}.`, [res.display]),
      ]);
    case "extinguishLight":
      change(`zone:${zone}`, ["dark"], ["dim"]);
      return ok([
        step(actorId, a, res.degree, `${name(actorId)} put out ${prop!.name}; ${name(zone)} went dark.`, [
          res.display,
        ]),
      ]);
    case "distract":
      patch(w, a.targetId!, { reaction: false, defendReaction: false });
      return ok([
        step(actorId, a, res.degree, `${name(actorId)} distracted ${name(a.targetId!)}, leaving them open.`, [
          res.display,
        ]),
      ]);
    default:
      return ok([step(actorId, a, res.degree, `${name(actorId)} managed to ${what}.`, [res.display])]);
  }
}

/** Every legal action for the actor right now, for hint chips and clarification (spec 08 step 4). */
export function legalActions(
  state: GameState,
  actorId: ActorId,
  ctx: CombatContext,
): Array<{ action: CombatActionInput; label: string; ap: number; legal: boolean; reason?: string }> {
  const me = combatant(state, actorId);
  if (!me) return [];
  const out: Array<{
    action: CombatActionInput;
    label: string;
    ap: number;
    legal: boolean;
    reason?: string;
  }> = [];
  const add = (action: CombatAction, label: string) => {
    const e = validateCombatAction(state, actorId, action, me.ap, ctx);
    out.push({
      action,
      label,
      ap: apCost(state, actorId, action, ctx),
      legal: !e,
      ...(e ? { reason: e.message } : {}),
    });
  };
  const foes = Object.values(combatOf(state).combatants).filter(
    (c) => c.side !== me.side && canAct(state, c.actorId),
  );
  for (const f of foes) {
    if (isEngaged(state, actorId, f.actorId) || rangeOk(state, actorId, f.actorId, ctx))
      add({ type: "strike", targetId: f.actorId }, `Strike ${ctx.nameOf(f.actorId)}`);
    else if (sameZone(state, actorId, f.actorId))
      add({ type: "engage", targetId: f.actorId }, `Engage ${ctx.nameOf(f.actorId)}`);
  }
  if (!foes.some((f) => sameZone(state, actorId, f.actorId) || isEngaged(state, actorId, f.actorId))) {
    const here = zoneOf(state, actorId);
    for (const n of here ? neighbours(state, here) : [])
      add({ type: "move", toZoneId: n.zoneId }, `Move to ${ctx.nameOf(n.zoneId)}`);
  }
  add({ type: "aim" }, "Aim");
  add({ type: "takeCover" }, "Take cover");
  add({ type: "defend" }, "Defend");
  if (engagedWith(state, actorId).length) add({ type: "disengage" }, "Disengage");
  if (hasCondition(state, actorId, "core:prone")) add({ type: "standUp" }, "Stand up");
  if (!me.loaded) add({ type: "reload" }, "Reload");
  for (const ally of Object.values(combatOf(state).combatants).filter((c) => c.side === me.side)) {
    if (hasCondition(state, ally.actorId, "core:bleeding") || ally.status === "dying")
      add(
        { type: "firstAid", targetId: ally.actorId },
        `First aid on ${ally.actorId === actorId ? "yourself" : ctx.nameOf(ally.actorId)}`,
      );
  }
  return out.filter(
    (o) => o.legal || o.action.type === "strike" || o.action.type === "takeCover" || o.action.type === "aim",
  );
}

function rangeOk(state: GameState, actorId: ActorId, targetId: ActorId, ctx: CombatContext) {
  const p = strikeProblem({ state }, actorId, targetId, ctx);
  return !p || p.code === "NEEDS_RELOAD" || p.code === "NO_LINE_OF_SIGHT";
}

export { STUNTS };

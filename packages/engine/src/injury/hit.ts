import {
  type ActorId,
  type ArmorDef,
  type BodyPlanDef,
  type ConditionInstance,
  type ContentId,
  draft,
  type EventDraft,
  findBodyPlan,
  type ItemCatalog,
  Rng,
  rollDice,
  type Wound,
} from "@wyrd/core";
import { resolveCheck } from "../checks.ts";
import { applyCondition } from "../conditions.ts";
import { isSuccess } from "../resolution/index.ts";
import { fail, ok, type Result, unwrap } from "../result.ts";
import type { GameState, RulesContext } from "../state.ts";
import { Working } from "../working.ts";
import { computeDamage, locationFor, protectionAt, woundSeverity } from "./damage.ts";

/** What hit resolution needs beyond state and tuning: the item catalog and the packs' body plans. */
export type InjuryContext = RulesContext & { items: ItemCatalog; bodyPlans: Record<string, BodyPlanDef> };

export type HitInput = {
  attackerId: ActorId | null;
  targetId: ActorId;
  /** null = unarmed */
  weaponId: ContentId | null;
  degree: "success" | "critSuccess";
  calledLocation?: string;
};

export type HitOutcome = {
  events: EventDraft[];
  location: string;
  final: number;
  /** The wound this hit caused, as it stands after any lethal worsening. */
  wound: Wound | null;
  downed: "down" | "unconscious" | null;
  lethal: {
    woundId: string;
    fate: "defeated" | "dying";
    /** Dies at once unless saved by Luck (a critical failure on the lethal check). */
    immediate: boolean;
    deathInRounds: number;
  } | null;
  /** Narration beats the wound effects require. */
  beats: string[];
};

/** What a lethal wound means for this actor (spec 03, "Lethal wounds"). */
export function lethalFate(state: GameState, actorId: ActorId): "defeated" | "dying" {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`No actor ${actorId}`);
  const hardcore = state.campaign.settings.structural.hardcore;
  if (actor.role === "npc") return "dying";
  if (actor.role === "companion") {
    return hardcore || state.campaign.settings.companionDeath ? "dying" : "defeated";
  }
  return hardcore ? "dying" : "defeated";
}

/** Applies a condition to the working state, unless the actor already has it. */
function addCondition(w: Working, actorId: ActorId, condition: ConditionInstance, replace = false): void {
  const has = w.state.actors[actorId]?.sheet.status.conditions.some((c) => c.id === condition.id);
  if (has && !replace) return;
  w.apply(unwrap(applyCondition(w.state, actorId, condition)));
}

/**
 * The END check at 0 HP (spec 03, Hit points): success leaves the actor Down, failure Unconscious.
 * The condition is applied on `w`. Bleeding at 0 HP reuses this.
 */
export function downCheck(w: Working, actorId: ActorId, ctx: InjuryContext): "down" | "unconscious" {
  const out = unwrap(
    resolveCheck(
      w.state,
      {
        actorId,
        skill: { attribute: "end" },
        difficulty: ctx.tuning.combat.downCheck,
        purpose: "stay conscious at 0 HP",
        // Resisting is allowed while Unconscious (a bleeding actor is already out).
        tags: ["resist"],
      },
      ctx,
    ),
  );
  w.apply(out.events);
  const result = isSuccess(out.effective.degree) ? "down" : "unconscious";
  addCondition(w, actorId, { id: `core:${result}` });
  return result;
}

/**
 * Resolves a landed attack (spec 03, Attacks 3–7 and Wounds): location, damage, armour, HP, the
 * Down check, the wound and its effects, and the lethal check. Everything is emitted as events.
 */
export function resolveHit(state: GameState, hit: HitInput, ctx: InjuryContext): Result<HitOutcome> {
  const target = state.actors[hit.targetId];
  if (!target) return fail("ACTOR_UNKNOWN", `No actor ${hit.targetId}`);
  const attacker = hit.attackerId === null ? null : state.actors[hit.attackerId];
  if (attacker === undefined) return fail("ACTOR_UNKNOWN", `No actor ${hit.attackerId}`);

  const t = ctx.tuning.combat;
  let weapon: { damage: string; damageType: string; armorPiercing: number; strengthBonus: boolean };
  if (hit.weaponId === null) {
    weapon = { ...t.unarmed, armorPiercing: 0, strengthBonus: true };
  } else {
    const def = Object.hasOwn(ctx.items.weapons, hit.weaponId) ? ctx.items.weapons[hit.weaponId] : undefined;
    if (!def) return fail("ITEM_UNKNOWN", `Unknown weapon ${hit.weaponId}`);
    weapon = { ...def, strengthBonus: def.strengthBonus !== false };
  }

  const worn: ArmorDef[] = [];
  for (const id of target.sheet.equipment.worn) {
    const def = Object.hasOwn(ctx.items.armor, id) ? ctx.items.armor[id] : undefined;
    if (!def) return fail("ITEM_UNKNOWN", `Unknown armour ${id}`);
    worn.push(def);
  }

  const plan = findBodyPlan(ctx.bodyPlans, target.sheet.bodyPlan);
  if (!plan) return fail("BODYPLAN_UNKNOWN", `Unknown body plan ${target.sheet.bodyPlan}`);
  let called: BodyPlanDef["locations"][number] | undefined;
  if (hit.calledLocation !== undefined) {
    called = plan.locations.find((l) => l.id === hit.calledLocation);
    if (!called) return fail("LOCATION_UNKNOWN", `${plan.name} has no location ${hit.calledLocation}`);
  }

  const w = new Working(state);
  const rng = new Rng(state.campaign.rngState);

  // 1. Location.
  const locationRoll = called ? null : rng.die(100);
  const location = called ?? locationFor(plan, locationRoll as number);

  // 2. Damage: weapon dice (maximised on a critical) plus the STR bonus.
  const crit = hit.degree === "critSuccess";
  const dice = rollDice(weapon.damage, rng, { maximise: crit });
  const strBonus =
    weapon.strengthBonus && attacker
      ? Math.floor((attacker.sheet.attributes.str - t.strBonusBase) / t.strBonusDivisor)
      : 0;
  const raw = Math.max(0, dice.total + strBonus);

  // 3. Armour and the location multiplier.
  const { protection, final } = computeDamage(
    {
      raw,
      protection: protectionAt(worn, location.id, weapon.damageType, t.maxArmourLayers),
      armorPiercing: weapon.armorPiercing,
      crit,
      multiplier: location.multiplier,
    },
    t,
  );

  // 4. HitResolved carries the generator state, so the checks below roll on from here.
  w.apply([
    draft(
      "HitResolved",
      {
        attackerId: hit.attackerId,
        targetId: hit.targetId,
        weaponId: hit.weaponId,
        location: location.id,
        locationRoll,
        damageRolls: dice.rolls,
        raw,
        protection,
        final,
        crit,
        rngAfter: [...rng.state],
      },
      "engine",
    ),
  ]);

  // 5. HP. An actor already at 0 HP has nothing left to lose.
  const hpBefore = target.sheet.status.hp;
  if (final > 0 && hpBefore > 0) {
    const hp = Math.max(0, hpBefore - final);
    w.apply([
      draft("HpChanged", { actorId: hit.targetId, hp, delta: hp - hpBefore, cause: "damage" }, "engine"),
    ]);
  }

  // 6. Reaching 0 HP forces the Down check.
  const downed =
    hpBefore > 0 && final > 0 && w.state.actors[hit.targetId]!.sheet.status.hp === 0
      ? downCheck(w, hit.targetId, ctx)
      : null;

  const outcome = (wound: Wound | null, lethal: HitOutcome["lethal"], beats: string[]): Result<HitOutcome> =>
    ok({ events: w.events, location: location.id, final, wound, downed, lethal, beats });

  // 7. The wound.
  const wt = target.sheet.derived.wt;
  const severity = woundSeverity(final, wt, hpBefore === 0, t);
  if (!severity) return outcome(null, null, []);

  const settings = w.state.campaign.settings;
  const simple = settings.subsystems.injuries === "simple";
  const bleedingOn = settings.subsystems.bleeding && !simple;
  const fracturesOn = settings.subsystems.fractures && !simple;
  const damageType = weapon.damageType;
  const effect = t.woundEffects[location.kind][severity];

  const existing = w.state.actors[hit.targetId]!.sheet.status.wounds;
  let n = existing.length + 1;
  while (existing.some((x) => x.id === `${hit.targetId}-w${n}`)) n++;
  const woundId = `${hit.targetId}-w${n}`;
  const penalty = simple ? { scope: "all" as const, value: t.simpleWoundPenalty[severity] } : effect.penalty;
  const wound: Wound = {
    id: woundId,
    location: location.id,
    locationKind: location.kind,
    severity,
    damageType,
    hpMaxReduction: t.hpMaxReduction[severity],
    fracture: fracturesOn && (effect.fractureIf?.includes(damageType) ?? false),
    severed:
      !simple &&
      damageType === "cut" &&
      effect.severAtWtMultiple !== undefined &&
      final >= effect.severAtWtMultiple * wt,
    ...(penalty ? { penalty: { ...penalty } } : {}),
  };
  // A second critical at one location is lethal outright (checked before this wound exists).
  const repeatCritical =
    severity === "critical" &&
    existing.some(
      (x) => x.location === location.id && (x.severity === "critical" || x.severity === "lethal"),
    );

  // 8. Wound and effects. Simple injuries keep only the flat penalty, plus Down on a critical.
  w.apply([draft("WoundInflicted", { actorId: hit.targetId, wound }, "engine")]);
  const conditions = simple
    ? severity === "critical"
      ? [{ id: "core:down" }]
      : []
    : (effect.conditions ?? []);
  for (const c of conditions) addCondition(w, hit.targetId, c);

  if (bleedingOn && damageType !== "burn") {
    const added = Math.min(
      t.maxBleeding,
      effect.bleedingIf?.[damageType] ??
        (effect.bleeding ?? 0) + (damageType === "cut" ? t.cutBleedingBonus : 0),
    );
    if (added > 0) {
      const current = w.state.actors[hit.targetId]!.sheet.status.conditions.find(
        (c) => c.id === "core:bleeding",
      );
      const level = Math.min(t.maxBleeding, (current?.level ?? 0) + added);
      addCondition(w, hit.targetId, { id: "core:bleeding", level }, true);
    }
  }

  // 9. Lethal: a repeat critical, or a failed lethal check where the effect calls for one.
  let lethal: HitOutcome["lethal"] = null;
  if (severity === "critical") {
    let isLethal = repeatCritical;
    let immediate = false;
    if (!isLethal && effect.lethalCheck) {
      const check = unwrap(
        resolveCheck(
          w.state,
          {
            actorId: hit.targetId,
            skill: { attribute: "end" },
            difficulty: t.lethalCheck,
            purpose: "survive a critical wound",
            tags: ["resist"],
          },
          ctx,
        ),
      );
      w.apply(check.events);
      isLethal = !isSuccess(check.effective.degree);
      immediate = check.effective.degree === "critFailure";
    }
    if (isLethal) {
      // Lethal counts as critical for the max-HP reduction.
      w.apply([
        draft(
          "WoundWorsened",
          { actorId: hit.targetId, woundId, severity: "lethal", hpMaxReduction: t.hpMaxReduction.critical },
          "engine",
        ),
      ]);
      addCondition(w, hit.targetId, { id: "core:unconscious" });
      if (bleedingOn) addCondition(w, hit.targetId, { id: "core:bleeding", level: t.maxBleeding }, true);
      lethal = {
        woundId,
        fate: lethalFate(w.state, hit.targetId),
        immediate,
        deathInRounds: target.sheet.attributes.end,
      };
    }
  }

  // 10. Beats.
  const beats = !simple && effect.beat ? [effect.beat] : [];
  const current = w.state.actors[hit.targetId]!.sheet.status.wounds.find((x) => x.id === woundId) ?? wound;
  return outcome(current, lethal, beats);
}

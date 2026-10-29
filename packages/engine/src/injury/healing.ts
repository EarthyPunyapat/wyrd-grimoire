import { type ActorId, ConditionInstance, draft, type EventDraft, type Rng } from "@wyrd/core";
import { fail, ok, type Result } from "../result.ts";
import type { GameState, RulesContext } from "../state.ts";
import type { Working } from "../working.ts";

/**
 * Healing over game time (spec 03, Healing; spec 11, Injuries). The daily tick heals wounds,
 * rolls infection on untreated serious+ wounds and leaves permanent injuries when a critical
 * wound heals without care. All choices come from the seeded RNG the day's tick already carries.
 */

export type HealingContext = RulesContext & { nameOf: (id: string) => string };

const partyOf = (state: GameState): ActorId[] =>
  [state.party.pcId, ...state.party.companionIds].filter((id): id is ActorId => !!id);

export function healingDaily(w: Working, ctx: HealingContext, rng: Rng, _dayNumber: number): EventDraft[] {
  const settings = w.state.campaign.settings;
  const t = ctx.tuning.injury;
  const simple = settings.subsystems.injuries === "simple";
  const start = w.events.length;
  for (const actorId of partyOf(w.state)) {
    const actor = w.state.actors[actorId];
    if (!actor || actor.dead) continue;
    for (const wound of [...actor.sheet.status.wounds]) {
      const days =
        wound.healingDays ??
        Math.max(1, Math.round(t.healingDays[wound.severity] * (simple ? t.simpleScale : 1)));
      const treated = wound.treated === true;

      // A fracture that hasn't been set cannot knit.
      if (wound.fracture && !treated) {
        w.apply([draft("WoundProgressed", { actorId, woundId: wound.id, healingDays: days }, "engine")]);
        continue;
      }

      const step = 1 + (treated ? t.treatedExtraDays : 0);
      const left = Math.max(0, days - step);
      if (left > 0) {
        w.apply([draft("WoundProgressed", { actorId, woundId: wound.id, healingDays: left }, "engine")]);
      } else {
        if (
          !simple &&
          settings.subsystems.permanentInjuries &&
          wound.severity === "critical" &&
          !treated &&
          rng.int(1, 100) <= t.permanentChance
        ) {
          w.apply([
            draft(
              "PermanentInjuryGained",
              {
                actorId,
                injury: {
                  id: `injury:${actorId}:${wound.id}`,
                  location: wound.location,
                  description: `A ${wound.location} that never quite healed right.`,
                },
                summary: `${ctx.nameOf(actorId)}'s ${wound.location} heals badly and will never be the same.`,
              },
              "engine",
            ),
          ]);
        }
        w.apply([
          draft(
            "WoundHealed",
            {
              actorId,
              woundId: wound.id,
              summary: `${ctx.nameOf(actorId)}'s ${wound.location} wound closes.`,
            },
            "engine",
          ),
        ]);
        continue;
      }

      if (
        settings.subsystems.infection &&
        !simple &&
        wound.severity !== "minor" &&
        !wound.infected &&
        !treated &&
        rng.int(1, 100) <= t.infectionChance
      ) {
        w.apply([
          draft(
            "WoundInfected",
            {
              actorId,
              woundId: wound.id,
              summary: `${ctx.nameOf(actorId)}'s ${wound.location} wound turns angry and hot.`,
            },
            "engine",
          ),
          draft(
            "ConditionApplied",
            { actorId, condition: ConditionInstance.parse({ id: "core:infected", note: wound.location }) },
            "engine",
          ),
        ]);
      }

      if (wound.infected) {
        const hp = w.state.actors[actorId]!.sheet.status.hp;
        const damage = Math.min(t.infectedDamagePerDay, hp);
        if (damage > 0)
          w.apply([
            draft("HpChanged", { actorId, hp: hp - damage, delta: -damage, cause: "survival" }, "engine"),
          ]);
      }
    }
  }
  return w.events.slice(start);
}

/** Short or long rest: time passes, wounds get care, and a long rest restores a little HP. */
export function rest(
  state: GameState,
  actorId: ActorId,
  kind: "short" | "long",
  ctx: HealingContext,
): Result<EventDraft[]> {
  const actor = state.actors[actorId];
  if (!actor) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  if (actor.dead) return fail("ACTOR_DEAD", `${ctx.nameOf(actorId)} is dead`);
  if (state.combat) return fail("IN_COMBAT", "You can't rest in the middle of a fight");
  const t = ctx.tuning.injury;
  const events: EventDraft[] = [
    draft(
      "TimeAdvanced",
      { minutes: kind === "long" ? t.longRestMinutes : t.shortRestMinutes, reason: `${kind} rest` },
      "engine",
    ),
  ];
  // Care marks the wounds as treated, so the daily tick speeds up.
  for (const wound of actor.sheet.status.wounds) {
    if (!wound.treated)
      events.push(
        draft(
          "WoundTreated",
          { actorId, woundId: wound.id, kind: "rest", summary: `${ctx.nameOf(actorId)} tends the wound.` },
          "engine",
        ),
      );
  }
  if (kind === "long") {
    const hp = actor.sheet.status.hp;
    const max = actor.sheet.derived.hpMax;
    const healed = Math.min(max, hp + t.longRestHeal) - hp;
    if (healed > 0)
      events.push(
        draft("HpChanged", { actorId, hp: hp + healed, delta: healed, cause: "healing" }, "engine"),
      );
    const exhausted = actor.sheet.status.conditions.find((c) => c.id === "core:exhausted");
    if (exhausted)
      events.push(
        draft("ConditionRemoved", { actorId, conditionId: "core:exhausted", reason: "long rest" }, "engine"),
      );
  }
  return ok(events);
}

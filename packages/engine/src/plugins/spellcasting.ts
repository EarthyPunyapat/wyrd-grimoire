import {
  type ActorId,
  type CharacterSheet,
  ConditionInstance,
  type Degree,
  defaultTuning,
  draft,
  type EventDraft,
  localIdOf,
  type SpellDef,
  type SpellEffect,
  type Tuning,
} from "@wyrd/core";
import { resolveCheck } from "../checks.ts";
import { isSuccess } from "../resolution/index.ts";
import { fail, ok, type Result } from "../result.ts";
import type { GameState, RulesContext } from "../state.ts";

/**
 * The spellcasting plugin (spec 05): cast a pack spell. The engine validates AP, range and target,
 * rolls the spell's school check, pays strain, and applies each effect as an event. Miscasts on a
 * critical failure. Pure: the RNG comes from state, content from `ctx`.
 */

export type SpellContext = RulesContext & {
  /** Every spell in the frozen pack, by namespaced id. */
  spells: Record<string, SpellDef>;
  nameOf: (id: string) => string;
  /** Creature names for `summon`, by namespaced id. */
  creatureName?: (id: string) => string | undefined;
};

export type CastInput = { spellId: string; targetIds?: readonly string[] };

const tuningOf = (ctx: RulesContext): Tuning["spellcasting"] =>
  ctx.tuning.spellcasting ?? defaultTuning.spellcasting;

const localName = (id: string) => localIdOf(id).replaceAll("-", " ");

function sheetOf(state: GameState, actorId: ActorId): CharacterSheet | undefined {
  return state.actors[actorId]?.sheet;
}

/** The spells an actor may cast: their known list when set, otherwise every pack spell. */
export function knownSpells(state: GameState, actorId: ActorId, ctx: SpellContext): SpellDef[] {
  const known = (state.flags.spellcasting as { known?: Record<string, string[]> } | undefined)?.known?.[
    actorId
  ];
  const all = Object.values(ctx.spells);
  if (!known) return all;
  return all.filter((s) => known.includes(s.id));
}

function present(state: GameState, actorId: string): boolean {
  return state.scene?.positions[actorId] !== undefined;
}

function inRange(state: GameState, caster: ActorId, target: string, range: SpellDef["range"]): boolean {
  const scene = state.scene;
  if (!scene) return range === "self" || range === "touch";
  if (range === "self") return target === caster;
  if (range === "far") return scene.positions[target] !== undefined;
  return scene.positions[target] === scene.positions[caster];
}

export function castSpell(
  state: GameState,
  actorId: ActorId,
  input: CastInput,
  ctx: SpellContext,
): Result<EventDraft[]> {
  const def = ctx.spells[input.spellId];
  if (!def) return fail("SPELL_UNKNOWN", `No spell called ${input.spellId}`);
  const actor = state.actors[actorId];
  if (!actor) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  if (actor.dead) return fail("ACTOR_DEAD", `${ctx.nameOf(actorId)} is dead`);
  const known = knownSpells(state, actorId, ctx);
  if (!known.some((s) => s.id === def.id))
    return fail("SPELL_UNKNOWN", `${ctx.nameOf(actorId)} doesn't know ${def.name}`);

  const targets = [...(input.targetIds ?? [])];
  if (def.target === "self") {
    if (targets.length && targets[0] !== actorId)
      return fail("TARGET_INVALID", `${def.name} targets the caster`);
    targets.splice(0, targets.length, actorId);
  }
  if (def.target === "actor") {
    if (targets.length !== 1) return fail("TARGET_REQUIRED", `${def.name} needs one target`);
    const target = targets[0]!;
    if (!state.actors[target] && !present(state, target))
      return fail("TARGET_UNKNOWN", `There is no ${target} here`);
    if (!state.scene || !inRange(state, actorId, target, def.range))
      return fail("TARGET_OUT_OF_RANGE", `${ctx.nameOf(target)} is out of range`);
  }

  // AP in combat: the caster must be the active combatant and have the points.
  const combat = state.combat;
  let apAfter: number | undefined;
  if (combat) {
    const active = combat.order[combat.turn];
    if (active !== actorId) return fail("NOT_YOUR_TURN", `It isn't ${ctx.nameOf(actorId)}'s turn`);
    const current = combat.combatants[actorId]?.ap ?? 0;
    if (current < def.apCost) return fail("AP_SHORT", `${def.name} costs ${def.apCost} AP; ${current} left`);
    apAfter = current - def.apCost;
  }

  const t = tuningOf(ctx);
  const strain = def.strain ?? t.strainByTier[def.tier];
  const events: EventDraft[] = [];

  const payStrain = () => {
    const sheet = sheetOf(state, actorId);
    if (!sheet || strain <= 0) return;
    const hp = Math.max(0, sheet.status.hp - strain);
    events.push(draft("HpChanged", { actorId, hp, delta: hp - sheet.status.hp, cause: "strain" }, "engine"));
  };
  const payAp = () => {
    if (!combat || apAfter === undefined) return;
    events.push(
      draft(
        "CombatChanged",
        {
          combat: {
            ...combat,
            combatants: {
              ...combat.combatants,
              [actorId]: { ...combat.combatants[actorId]!, ap: apAfter },
            },
          },
        },
        "engine",
      ),
    );
  };

  let degree: Degree = "success";
  if (def.check) {
    const check = resolveCheck(
      state,
      {
        actorId,
        skill: def.check.skill,
        difficulty: def.check.difficulty,
        purpose: `cast ${def.name}`,
        tags: ["spell", def.school],
      },
      ctx,
    );
    if (!check.ok) return check;
    events.push(...check.value.events);
    degree = check.value.effective.degree;
  }

  payStrain();
  payAp();

  if (degree === "critFailure") {
    const damage = t.miscastDamage;
    const sheet = sheetOf(state, actorId);
    const hp = Math.max(0, (sheet?.status.hp ?? 0) - damage);
    events.push(
      draft("HpChanged", { actorId, hp, delta: hp - (sheet?.status.hp ?? 0), cause: "damage" }, "engine"),
    );
    events.push(
      draft(
        "ConditionApplied",
        {
          actorId,
          condition: ConditionInstance.parse({
            id: t.miscastCondition,
            level: 1,
            sourceActorId: actorId,
            note: "miscast",
          }),
        },
        "engine",
      ),
    );
    events.push(
      draft(
        "SpellMiscast",
        {
          actorId,
          spellId: def.id,
          result: "backlash",
          damage,
          summary: `${ctx.nameOf(actorId)}'s ${def.name} tears loose: ${damage} damage and a wave of exhaustion.`,
        },
        "engine",
      ),
    );
    return ok(events);
  }

  if (!isSuccess(degree)) {
    events.push(
      draft(
        "SpellCast",
        {
          actorId,
          spellId: def.id,
          targetIds: targets,
          degree,
          apCost: def.apCost,
          strain,
          effects: [],
          summary: `${def.name} fizzles; the effort still costs ${strain} strain.`,
        },
        "engine",
      ),
    );
    return ok(events);
  }

  const power = degree === "critSuccess" ? 1.5 : 1;
  const now = state.campaign.gameTime;
  const summaries: Array<{
    kind: string;
    targetId?: string;
    amount?: number;
    conditionId?: string;
    text?: string;
  }> = [];
  let scene = state.scene;
  const sceneChanged = () => {
    if (scene && scene !== state.scene)
      events.push(draft("SceneOpened", { scene: { ...scene, openedAt: state.scene!.openedAt } }, "engine"));
  };

  for (const effect of def.effects as SpellEffect[]) {
    const target = targets[0] ?? actorId;
    switch (effect.kind) {
      case "damage": {
        const sheet = sheetOf(state, target);
        if (!sheet) break;
        const amount = Math.ceil(effect.amount * power);
        const hp = Math.max(0, sheet.status.hp - amount);
        events.push(
          draft("HpChanged", { actorId: target, hp, delta: hp - sheet.status.hp, cause: "damage" }, "engine"),
        );
        summaries.push({ kind: "damage", targetId: target, amount });
        break;
      }
      case "heal": {
        const sheet = sheetOf(state, target);
        if (!sheet) break;
        const amount = Math.ceil(effect.amount * power);
        const hp = Math.min(sheet.derived.hpMax, sheet.status.hp + amount);
        events.push(
          draft(
            "HpChanged",
            { actorId: target, hp, delta: hp - sheet.status.hp, cause: "healing" },
            "engine",
          ),
        );
        summaries.push({ kind: "heal", targetId: target, amount: hp - sheet.status.hp });
        break;
      }
      case "applyCondition":
        events.push(
          draft(
            "ConditionApplied",
            {
              actorId: target,
              condition: ConditionInstance.parse({
                id: effect.conditionId,
                ...(effect.level ? { level: effect.level } : {}),
                sourceActorId: actorId,
                ...(effect.note ? { note: effect.note } : {}),
              }),
            },
            "engine",
          ),
        );
        summaries.push({ kind: "applyCondition", targetId: target, conditionId: effect.conditionId });
        break;
      case "removeCondition":
        events.push(
          draft(
            "ConditionRemoved",
            { actorId: target, conditionId: effect.conditionId, reason: "spell" },
            "engine",
          ),
        );
        summaries.push({ kind: "removeCondition", targetId: target, conditionId: effect.conditionId });
        break;
      case "createZoneTag": {
        const zoneId = effect.zoneId ?? (scene ? scene.positions[target] : undefined);
        if (!scene || !zoneId) break;
        scene = {
          ...scene,
          zones: scene.zones.map((z) =>
            z.id === zoneId && !z.tags.includes(effect.tag) ? { ...z, tags: [...z.tags, effect.tag] } : z,
          ),
        };
        summaries.push({ kind: "createZoneTag", targetId: zoneId, text: effect.tag });
        break;
      }
      case "moveTarget": {
        if (!effect.toZoneId || !scene?.zones.some((z) => z.id === effect.toZoneId)) break;
        events.push(draft("EntityMoved", { entityId: target, toZoneId: effect.toZoneId }, "engine"));
        scene = { ...scene, positions: { ...scene.positions, [target]: effect.toZoneId } };
        summaries.push({ kind: "moveTarget", targetId: target, text: effect.toZoneId });
        break;
      }
      case "ward":
        events.push(
          draft(
            "ConditionApplied",
            {
              actorId: target,
              condition: ConditionInstance.parse({
                id: "core:warded",
                sourceActorId: actorId,
                note: `+${effect.amount} protection`,
              }),
            },
            "engine",
          ),
        );
        summaries.push({ kind: "ward", targetId: target, amount: effect.amount });
        break;
      case "summon": {
        if (!scene) break;
        const id = `npc:summon-${now}-${summaries.length + 1}`;
        const name = ctx.creatureName?.(effect.creatureId) ?? localName(effect.creatureId);
        events.push(
          draft(
            "EntityCreated",
            {
              entity: {
                id,
                kind: "npc",
                name,
                aliases: [],
                detail: "stub",
                summary: `Summoned by ${def.name}.`,
                data: { statBlock: effect.creatureId, summoned: true },
                status: "active",
                importance: 1,
              },
            },
            "engine",
          ),
        );
        scene = {
          ...scene,
          positions: { ...scene.positions, [id]: scene.positions[actorId] ?? scene.zones[0]!.id },
        };
        summaries.push({ kind: "summon", targetId: id, text: name });
        break;
      }
      case "detect":
        summaries.push({ kind: "detect", text: effect.what });
        break;
      case "illusion":
        summaries.push({ kind: "illusion", text: effect.text });
        break;
    }
  }
  sceneChanged();

  events.push(
    draft(
      "SpellCast",
      {
        actorId,
        spellId: def.id,
        targetIds: targets,
        degree,
        apCost: def.apCost,
        strain,
        effects: summaries,
        ...(def.concentration && def.durationMinutes
          ? { concentrationUntil: now + def.durationMinutes }
          : {}),
        summary: `${ctx.nameOf(actorId)} casts ${def.name}.`,
      },
      "engine",
    ),
  );
  return ok(events);
}

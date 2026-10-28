import {
  type ActorId,
  type CharacterSheet,
  type Combatant,
  type CombatOutcome,
  type CombatState,
  draft,
  type EventDraft,
  Rng,
} from "@wyrd/core";
import { createActor } from "../campaign.ts";
import { resolveCheck, resolveOpposedCheck } from "../checks.ts";
import { removeCondition } from "../conditions.ts";
import { buildSheet } from "../creation.ts";
import { startingEquipment } from "../equipment.ts";
import { bleedTick } from "../injury/index.ts";
import { compareDegreeMargin, isSuccess } from "../resolution/index.ts";
import { fail, ok, type Result } from "../result.ts";
import type { GameState } from "../state.ts";
import { Working } from "../working.ts";
import {
  type CombatContext,
  type CombatStep,
  canAct,
  combatant,
  combatOf,
  currentActor,
  hasCondition,
  replaceCombatant,
  sheetOf,
  stillFighting,
} from "./common.ts";

const setCombat = (w: Working, combat: CombatState) =>
  w.apply([draft("CombatChanged", { combat }, "engine")]);
const patch = (w: Working, id: ActorId, p: Partial<Combatant>) =>
  setCombat(w, replaceCombatant(combatOf(w.state), { ...combatant(w.state, id)!, ...p }));

/** A plain stat block for people the world gave no statistics: ordinary folk, roughly. */
const COMMONER = {
  attributes: { str: 5, agi: 5, end: 5, int: 5, awa: 5, wil: 5, pre: 5 },
  skills: { "core:melee": 15, "core:unarmed": 15, "core:dodge": 10, "core:athletics": 10 },
  kit: [],
  size: "medium" as const,
  bodyPlan: "core:humanoid",
  tactics: "cowardly" as const,
  intent: "driveOff" as const,
};

function findCreature(ctx: CombatContext, id: string | undefined) {
  if (!id) return undefined;
  if (Object.hasOwn(ctx.creatures, id)) return ctx.creatures[id];
  const local = id.split(":").pop();
  return Object.values(ctx.creatures).find((c) => c.id.split(":").pop() === local);
}

/** Builds a sheet for a scene entity from its stat block (spec 05 creatures), sized per spec 03. */
export function spawnSheet(state: GameState, entityId: string, ctx: CombatContext): CharacterSheet {
  const info = ctx.combatInfo(entityId);
  const c = findCreature(ctx, info.statBlock) ?? COMMONER;
  const sheet = buildSheet(
    {
      id: entityId,
      identity: { name: ctx.nameOf(entityId), ancestry: "core:creature" },
      attributes: c.attributes as CharacterSheet["attributes"],
      skills: Object.fromEntries(Object.entries(c.skills).map(([k, v]) => [k, { trained: v }])),
      bodyPlan: c.bodyPlan,
      equipment: startingEquipment(c.kit, ctx.items),
    },
    state.campaign.settings,
    ctx.tuning,
  );
  const size = ctx.tuning.fight.size[c.size];
  const hpMax = Math.max(1, Math.floor(sheet.derived.hpMax * size.hpMultiplier));
  return {
    ...sheet,
    derived: { ...sheet.derived, hpMax, wt: Math.max(1, sheet.derived.wt + size.wtBonus) },
    status: { ...sheet.status, hp: hpMax, luck: 0 },
  };
}

/** AP for a turn: 3, less Stunned/Dazed and first-round surprise (spec 03). */
export function apFor(state: GameState, id: ActorId, ctx: CombatContext): number {
  const f = ctx.tuning.fight;
  let ap = f.apPerTurn;
  if (hasCondition(state, id, "core:stunned")) ap -= f.apLoss.stunned;
  if (hasCondition(state, id, "core:dazed")) ap -= f.apLoss.dazed;
  if (combatant(state, id)?.surprised) ap -= f.apLoss.surprised;
  return Math.max(0, ap);
}

export type StartInput = {
  initiatorId: ActorId;
  targetIds: ActorId[];
  combatId: string;
};

/**
 * Starts a fight in the open scene (spec 03): picks sides, gives stat-blocked sheets to scene
 * entities that don't have one, rolls surprise (if the initiator is hidden) and initiative.
 */
export function startCombat(state: GameState, input: StartInput, ctx: CombatContext): Result<Working> {
  if (!state.scene) return fail("NO_SCENE", "There's no scene to fight in");
  if (state.combat) return fail("ALREADY_IN_COMBAT", "A fight is already under way");
  const w = new Working(state);
  const scene = state.scene;
  const present = Object.keys(scene.positions);
  const pcId = state.party.pcId;
  const partyIds = new Set<ActorId>([
    ...(pcId && present.includes(pcId) ? [pcId] : []),
    ...state.party.companionIds.filter((c) => present.includes(c)),
    ...present.filter((id) => !state.actors[id]?.dead && ctx.combatInfo(id).ally),
  ]);
  const initiatorSide = partyIds.has(input.initiatorId) ? "party" : "enemy";
  const groupOf = (id: ActorId) => ctx.combatInfo(id).group ?? id;
  const targetGroups = new Set(input.targetIds.map(groupOf));
  const enemyIds = present.filter(
    (id) =>
      !partyIds.has(id) &&
      !state.actors[id]?.dead &&
      (input.targetIds.includes(id) || targetGroups.has(groupOf(id))) &&
      (state.actors[id] || entityCanFight(id, ctx)),
  );
  if (initiatorSide === "enemy") enemyIds.push(input.initiatorId);
  const sides: Record<ActorId, "party" | "enemy"> = {};
  for (const id of partyIds) sides[id] = initiatorSide === "party" ? "party" : "enemy";
  for (const id of new Set(enemyIds)) sides[id] = initiatorSide === "party" ? "enemy" : "party";
  // An NPC who starts a fight is the enemy; normalise so the PC's side is always "party".
  if (initiatorSide === "enemy")
    for (const id of Object.keys(sides)) sides[id] = partyIds.has(id) ? "party" : "enemy";
  if (!Object.values(sides).includes("enemy")) return fail("NO_ENEMIES", "There's nobody here to fight");

  for (const id of Object.keys(sides)) {
    if (!w.state.actors[id]) {
      const r = createActor(w.state, spawnSheet(w.state, id, ctx), "npc");
      if (!r.ok) return r;
      w.apply(r.value);
    }
  }

  // Surprise: a hidden initiator rolls Stealth against each opponent's Perception.
  const surprised = new Set<ActorId>();
  if (hasCondition(w.state, input.initiatorId, "core:hidden")) {
    for (const id of Object.keys(sides).filter((x) => sides[x] !== sides[input.initiatorId])) {
      const r = resolveOpposedCheck(
        w.state,
        {
          actorId: input.initiatorId,
          skill: "core:stealth",
          difficulty: "normal",
          purpose: `ambush ${ctx.nameOf(id)}`,
          opposedBy: { actorId: id, skill: "core:perception" },
        },
        ctx,
      );
      if (!r.ok) return r;
      w.apply(r.value.events);
      if (r.value.winner === "active") surprised.add(id);
    }
  }

  // Initiative: AGI × 5 + AWA × 5, as an AGI check adjusted by the AWA difference. Order by degree,
  // then margin; ties to higher AGI, then to the PC.
  const rolls: Array<{ id: ActorId; result: Parameters<typeof compareDegreeMargin>[0] }> = [];
  for (const id of Object.keys(sides)) {
    const a = sheetOf(w.state, id).attributes;
    const r = resolveCheck(
      w.state,
      {
        actorId: id,
        skill: { attribute: "agi" },
        difficulty: "normal",
        modifiers: a.awa !== a.agi ? [{ source: "awareness", value: (a.awa - a.agi) * 5 }] : [],
        purpose: "initiative",
        tags: ["initiative", "resist"],
      },
      ctx,
    );
    if (!r.ok) return r;
    w.apply(r.value.events);
    rolls.push({ id, result: r.value.effective });
  }
  rolls.sort((x, y) => {
    const c = compareDegreeMargin(y.result, x.result);
    if (c) return c;
    const agi = sheetOf(w.state, y.id).attributes.agi - sheetOf(w.state, x.id).attributes.agi;
    if (agi) return agi;
    return (y.id === pcId ? 1 : 0) - (x.id === pcId ? 1 : 0);
  });

  const rank = { critFailure: 0, failure: 1, success: 2, critSuccess: 3 } as const;
  const leaders = new Set(Object.keys(sides).filter((id) => ctx.combatInfo(id).leader));
  const enemyIntent = Object.keys(sides)
    .filter((id) => sides[id] === "enemy")
    .map((id) => ctx.combatInfo(id).intent ?? findCreature(ctx, ctx.combatInfo(id).statBlock)?.intent)
    .find(Boolean);
  const combat: CombatState = {
    id: input.combatId,
    round: 1,
    turn: 0,
    order: rolls.map((r) => r.id),
    combatants: Object.fromEntries(
      rolls.map((r) => {
        const info = ctx.combatInfo(r.id);
        const creature = findCreature(ctx, info.statBlock);
        const c: Combatant = {
          actorId: r.id,
          side: sides[r.id]!,
          group: sides[r.id] === "party" ? "party" : (info.group ?? creature?.id ?? r.id),
          leader: leaders.has(r.id),
          tactics:
            info.tactics ?? creature?.tactics ?? (sides[r.id] === "party" ? "aggressive" : COMMONER.tactics),
          status: "active",
          ap: 0,
          reaction: !surprised.has(r.id),
          defendReaction: false,
          defending: false,
          aim: 0,
          attacks: 0,
          surprised: surprised.has(r.id),
          fleeing: false,
          initiative: rank[r.result.degree] * 1000 + r.result.margin,
          controlled: r.id === pcId,
          loaded: true,
          size: creature?.size ?? "medium",
        };
        return [r.id, c];
      }),
    ),
    engaged: [],
    intent: enemyIntent ?? "kill",
    props: {},
    morale: [],
  };
  w.apply([draft("CombatStarted", { combat }, "engine")]);
  beginTurn(w, ctx);
  return ok(w);
}

/** A scene entity can fight if canon says it's a person or creature (not an item or a place). */
const entityCanFight = (id: string, ctx: CombatContext) => ctx.combatInfo(id).canFight !== false;

/** Start of a combatant's turn: death clock, fresh AP and reaction, Defend wears off. */
export function beginTurn(w: Working, ctx: CombatContext): CombatStep[] {
  const id = currentActor(w.state)!;
  const c = combatant(w.state, id)!;
  const steps: CombatStep[] = [];
  if (c.status === "dying") {
    const left = (c.dyingRounds ?? 1) - 1;
    if (left <= 0) {
      w.apply([draft("ActorDied", { actorId: id, cause: "died of their wounds" }, "engine")]);
      patch(w, id, { status: "dead", dyingRounds: 0 });
      steps.push({
        actorId: id,
        action: { type: "death" },
        outcome: "done",
        summary: `${ctx.nameOf(id)} died of their wounds.`,
        lines: [],
      });
    } else patch(w, id, { dyingRounds: left });
    return steps;
  }
  patch(w, id, {
    ap: canAct(w.state, id) ? apFor(w.state, id, ctx) : 0,
    attacks: 0,
    reaction: true,
    defending: false,
    defendReaction: false,
  });
  return steps;
}

/** End of a combatant's turn: bleeding ticks, then the next combatant in the fixed order (new round on wrap). */
export function endTurn(w: Working, ctx: CombatContext): CombatStep[] {
  const steps: CombatStep[] = [];
  const id = currentActor(w.state)!;
  const c = combatant(w.state, id)!;
  if (!w.state.actors[id]?.dead && c.status !== "fled") {
    const before = sheetOf(w.state, id).status.hp;
    const bleed = bleedTick(w.state, id, ctx);
    if (bleed.ok && bleed.value.events.length) {
      w.apply(bleed.value.events);
      const after = sheetOf(w.state, id).status.hp;
      const worse = bleed.value.worsened
        ? `; ${bleed.value.worsened === "lethal" ? "the wound turned mortal" : "they passed out"}`
        : "";
      steps.push({
        actorId: id,
        action: { type: "bleed" },
        outcome: "done",
        summary: `${ctx.nameOf(id)} bled${after < before ? ` (${before - after} HP)` : ""}${worse}.`,
        lines: [
          {
            text:
              c.side === "party"
                ? `${ctx.nameOf(id)} bleeds: HP ${before} → ${after}`
                : `${ctx.nameOf(id)} bleeds${bleed.value.worsened ? ` (${bleed.value.worsened})` : ""}`,
          },
        ],
      });
      if (bleed.value.worsened === "lethal") {
        const fate = lethalFateFor(w.state, id);
        patch(
          w,
          id,
          fate === "defeated"
            ? { status: "defeated" }
            : { status: "dying", dyingRounds: sheetOf(w.state, id).attributes.end },
        );
      }
    }
  }
  if (combatant(w.state, id)!.surprised) patch(w, id, { surprised: false });

  const combat = combatOf(w.state);
  const out = new Set(["dead", "fled", "surrendered", "defeated"]);
  let next = combat.turn;
  let round = combat.round;
  for (let i = 0; i < combat.order.length; i++) {
    next = (next + 1) % combat.order.length;
    if (next === 0) round++;
    if (!out.has(combat.combatants[combat.order[next]!]!.status)) break;
  }
  setCombat(w, { ...combatOf(w.state), turn: next, round });
  steps.push(...beginTurn(w, ctx));
  return steps;
}

function lethalFateFor(state: GameState, id: ActorId): "defeated" | "dying" {
  const role = state.actors[id]?.role;
  const s = state.campaign.settings;
  if (role === "pc") return s.structural.hardcore ? "dying" : "defeated";
  if (role === "companion") return s.structural.hardcore || s.companionDeath ? "dying" : "defeated";
  return "dying";
}

/** Group morale (spec 03): leader down, half the group down, or a successful Intimidate. */
export function checkMorale(w: Working, ctx: CombatContext): CombatStep[] {
  const steps: CombatStep[] = [];
  const combat = combatOf(w.state);
  const groups = new Map<string, Combatant[]>();
  for (const c of Object.values(combat.combatants)) {
    if (c.side !== "enemy") continue;
    groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  }
  // Groups that fight together share morale: treat the whole enemy side as one band for "half down".
  for (const [group, members] of groups) {
    const done = combatOf(w.state).morale;
    const out = members.filter((m) => !stillFighting(w.state, m.actorId)).length;
    const leaderOut = members.some((m) => m.leader && !canAct(w.state, m.actorId));
    const triggers: string[] = [];
    if (leaderOut && !done.includes(`${group}:leader`)) triggers.push("leader");
    if (out * 2 >= members.length && members.length > 1 && !done.includes(`${group}:half`))
      triggers.push("half");
    if (done.includes(`${group}:force`)) triggers.push("forced");
    if (!triggers.length) continue;
    setCombat(w, {
      ...combatOf(w.state),
      morale: [
        ...done.filter((m) => m !== `${group}:force`),
        ...triggers.map((t) => `${group}:${t === "forced" ? "forced" : t}`),
      ],
    });
    for (const m of members) {
      if (!stillFighting(w.state, m.actorId)) continue;
      if (m.tactics === "berserk") continue;
      const r = resolveCheck(
        w.state,
        {
          actorId: m.actorId,
          skill: { attribute: "wil" },
          difficulty: ctx.tuning.fight.moraleDifficulty,
          purpose: "hold their nerve",
          modifiers:
            m.tactics === "cowardly" ? [{ source: "cowardly", value: ctx.tuning.fight.cowardlyMorale }] : [],
          tags: ["morale", "resist"],
        },
        ctx,
      );
      if (!r.ok) continue;
      w.apply(r.value.events);
      const d = r.value.effective.degree;
      if (isSuccess(d)) continue;
      if (d === "critFailure") {
        patch(w, m.actorId, { status: "surrendered" });
        steps.push({
          actorId: m.actorId,
          action: { type: "morale" },
          outcome: d,
          summary: `${ctx.nameOf(m.actorId)} broke and threw down their weapon.`,
          lines: [r.value.effective.display],
        });
      } else {
        patch(w, m.actorId, { fleeing: true });
        steps.push({
          actorId: m.actorId,
          action: { type: "morale" },
          outcome: d,
          summary: `${ctx.nameOf(m.actorId)}'s nerve broke; they're looking for a way out.`,
          lines: [r.value.effective.display],
        });
      }
    }
  }
  return steps;
}

/** Whether the fight is over, and how (spec 03). */
export function combatOutcome(state: GameState, ctx: CombatContext): CombatOutcome | null {
  const combat = state.combat;
  if (!combat) return null;
  const pcId = state.party.pcId;
  const pc = pcId ? combat.combatants[pcId] : undefined;
  if (pcId && state.actors[pcId]?.dead) return "death";
  if (pc?.status === "fled") return "fled";
  if (pc?.status === "defeated") return "defeat";
  if (pc?.status === "surrendered") return "surrender";
  const all = Object.values(combat.combatants);
  const enemiesFighting = all.some((c) => c.side === "enemy" && stillFighting(state, c.actorId));
  // A dying party member's clock keeps running after the last enemy falls: allies get the chance to
  // stabilise them, and otherwise they die (spec 03, Lethal).
  if (!enemiesFighting) {
    const dying = all.some(
      (c) => c.side === "party" && c.status === "dying" && !state.actors[c.actorId]?.dead,
    );
    return dying && combat.round <= ctx.tuning.fight.maxRounds ? null : "victory";
  }
  const partyFighting = all.some((c) => c.side === "party" && canAct(state, c.actorId));
  if (!partyFighting) {
    const dying = all.some((c) => c.side === "party" && c.status === "dying");
    // In hardcore a dying, unattended PC's clock keeps running until death or rescue.
    if (state.campaign.settings.structural.hardcore && dying)
      return combat.round > ctx.tuning.fight.maxRounds ? "defeat" : null;
    return "defeat";
  }
  if (combat.round > ctx.tuning.fight.maxRounds) return "truce";
  return null;
}

const DEFEAT_HOOKS = {
  robbed: "Track down the people who robbed you and take back what's yours",
  leftForDead: "Find out who left you for dead, and settle the score",
  captured: "Escape your captors",
  rescued: "Repay the stranger who dragged you to safety",
} as const;
type DefeatKind = keyof typeof DEFEAT_HOOKS;

export type EndResult = { steps: CombatStep[]; summary: string; hook?: string };

/** Ends the fight and applies its aftermath: loot, defeat outcomes, bleeding checks (spec 03, "After combat"). */
export function endCombat(w: Working, outcome: CombatOutcome, ctx: CombatContext): EndResult {
  const combat = combatOf(w.state);
  const pcId = w.state.party.pcId!;
  const steps: CombatStep[] = [];
  const name = ctx.nameOf;
  let summary = "";
  let hook: string | undefined;
  let rngAfter: [number, number, number, number] | undefined;

  if (outcome === "victory") {
    const fallen = Object.values(combat.combatants).filter((c) => c.side === "enemy" && c.status !== "fled");
    const pcEq = sheetOf(w.state, pcId).equipment;
    const carried = pcEq.carried.map((c) => ({ ...c }));
    const loot: string[] = [];
    for (const f of fallen) {
      if (canAct(w.state, f.actorId) && f.status === "active") continue; // still standing (surrendered handled below)
      const eq = sheetOf(w.state, f.actorId).equipment;
      const take = eq.carried.filter(
        (c) =>
          !ctx.items.weapons[c.item]?.tags.includes("natural") &&
          !ctx.items.armor[c.item]?.tags.includes("natural"),
      );
      for (const t of take) {
        const existing = carried.find((c) => c.item === t.item);
        if (existing) existing.qty += t.qty;
        else carried.push({ ...t });
        loot.push(name(t.item));
      }
      if (take.length)
        w.apply([
          draft(
            "EquipmentChanged",
            {
              actorId: f.actorId,
              equipment: {
                held: { main: null, off: null },
                worn: eq.worn.filter((x) => !take.some((t) => t.item === x)),
                carried: eq.carried.filter((c) => !take.includes(c)),
              },
            },
            "engine",
          ),
        ]);
    }
    if (loot.length)
      w.apply([
        draft(
          "EquipmentChanged",
          { actorId: pcId, equipment: { ...pcEq, carried: carried.map((c) => ({ ...c })) } },
          "engine",
        ),
      ]);
    summary = loot.length
      ? `The fight is won. Taken from the fallen: ${[...new Set(loot)].join(", ")}.`
      : "The fight is won.";
    // Bleeding 1 stops by itself after a fight on a successful END check.
    for (const c of Object.values(combat.combatants).filter((x) => x.side === "party")) {
      const lvl = sheetOf(w.state, c.actorId).status.conditions.find((x) => x.id === "core:bleeding")?.level;
      if (lvl !== 1 || w.state.actors[c.actorId]?.dead) continue;
      const r = resolveCheck(
        w.state,
        {
          actorId: c.actorId,
          skill: { attribute: "end" },
          difficulty: "normal",
          purpose: "the bleeding stops",
          tags: ["resist"],
        },
        ctx,
      );
      if (!r.ok) continue;
      w.apply(r.value.events);
      if (isSuccess(r.value.effective.degree)) {
        const rm = removeCondition(w.state, c.actorId, "core:bleeding", "stopped after the fight");
        if (rm.ok) w.apply(rm.value);
      }
      steps.push({
        actorId: c.actorId,
        action: { type: "aftermath" },
        outcome: r.value.effective.degree,
        summary: isSuccess(r.value.effective.degree)
          ? `${name(c.actorId)}'s bleeding stopped.`
          : `${name(c.actorId)} is still bleeding.`,
        lines: [r.value.effective.display],
      });
    }
  } else if (outcome === "defeat" || outcome === "surrender") {
    const rng = new Rng(w.state.campaign.rngState);
    const weights = Object.entries(
      ctx.tuning.fight.defeatWeights[combat.intent] ?? { leftForDead: 1 },
    ) as Array<[DefeatKind, number]>;
    const total = weights.reduce((s, [, n]) => s + n, 0);
    let roll = rng.int(1, total);
    let kind: DefeatKind = weights[0]![0];
    for (const [k, n] of weights) {
      roll -= n;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    rngAfter = [...rng.state] as [number, number, number, number];
    const o = { minutes: ctx.tuning.fight.defeatMinutes[kind], hook: DEFEAT_HOOKS[kind] };
    hook = o.hook;
    w.apply(restorePc(w.state, pcId, ctx));
    const eq = sheetOf(w.state, pcId).equipment;
    if (kind === "robbed") {
      w.apply([
        draft(
          "EquipmentChanged",
          {
            actorId: pcId,
            equipment: {
              held: { main: null, off: null },
              worn: eq.worn,
              carried: eq.carried.filter((c) => eq.worn.includes(c.item)),
            },
          },
          "engine",
        ),
      ]);
    } else if (kind === "captured") {
      const keep = eq.carried.filter((c) => !ctx.items.weapons[c.item]);
      w.apply([
        draft(
          "EquipmentChanged",
          { actorId: pcId, equipment: { held: { main: null, off: null }, worn: eq.worn, carried: keep } },
          "engine",
        ),
      ]);
    }
    w.apply([draft("TimeAdvanced", { minutes: o.minutes, reason: `defeat: ${kind}` }, "engine")]);
    const text: Record<DefeatKind, string> = {
      robbed: "You were beaten and robbed; you came to with empty hands and a mouth full of blood.",
      leftForDead: "You were beaten senseless and left for dead. Hours later, you came to.",
      captured: "You were overpowered and taken. You woke bound and stripped of your weapons.",
      rescued: "You went down. Someone dragged you clear; you woke, hurting, in their debt.",
    };
    summary = `${outcome === "surrender" ? "You surrendered. " : ""}${text[kind]}`;
    w.apply([
      draft(
        "EntityCreated",
        {
          entity: {
            id: `quest:${combat.id}`,
            kind: "quest",
            name: o.hook,
            aliases: [],
            detail: "stub",
            summary: `Opened by a defeat: ${text[kind]}`,
            data: { from: combat.id, kind },
            status: "active",
            importance: 3,
          },
        },
        "engine",
      ),
    ]);
  } else if (outcome === "death") {
    summary = `${name(pcId)} is dead.`;
  } else if (outcome === "fled") {
    summary = "You got away.";
  } else {
    summary = "Both sides break off, too spent to go on.";
  }
  // After a fight the party survived, the unconscious come round (D91): conditions cleared, at least 1 HP.
  if (outcome === "victory" || outcome === "truce" || outcome === "fled") {
    for (const c of Object.values(combatOf(w.state).combatants)) {
      if (c.side !== "party" || w.state.actors[c.actorId]?.dead || c.status === "dying") continue;
      if (!hasCondition(w.state, c.actorId, "core:unconscious")) continue;
      const r = removeCondition(w.state, c.actorId, "core:unconscious", "came round after the fight");
      if (r.ok) w.apply(r.value);
      const hp = sheetOf(w.state, c.actorId).status.hp;
      if (hp < 1)
        w.apply([
          draft("HpChanged", { actorId: c.actorId, hp: 1, delta: 1 - hp, cause: "healing" }, "engine"),
        ]);
      steps.push({
        actorId: c.actorId,
        action: { type: "aftermath" },
        outcome: "done",
        summary: `${name(c.actorId)} came round, battered.`,
        lines: [],
      });
    }
  }
  // Surrendered enemies stay behind, disarmed.
  for (const c of Object.values(combatOf(w.state).combatants)) {
    if (c.side === "enemy" && c.status === "surrendered" && outcome === "victory") {
      const eq = sheetOf(w.state, c.actorId).equipment;
      if (eq.held.main || eq.held.off)
        w.apply([
          draft(
            "EquipmentChanged",
            { actorId: c.actorId, equipment: { ...eq, held: { main: null, off: null } } },
            "engine",
          ),
        ]);
    }
  }
  w.apply([
    draft(
      "CombatEnded",
      { combatId: combat.id, outcome, ...(rngAfter ? { rngAfter } : {}), summary },
      "engine",
    ),
  ]);
  return { steps, summary, ...(hook ? { hook } : {}) };
}

/** After a normal-campaign defeat the PC lives on: lethal wounds become persistent criticals, 1 HP, awake. */
function restorePc(state: GameState, pcId: ActorId, ctx: CombatContext): EventDraft[] {
  const w = new Working(state);
  for (const wound of sheetOf(w.state, pcId).status.wounds) {
    if (wound.severity === "lethal")
      w.apply([
        draft(
          "WoundWorsened",
          {
            actorId: pcId,
            woundId: wound.id,
            severity: "critical",
            hpMaxReduction: ctx.tuning.combat.hpMaxReduction.critical,
          },
          "engine",
        ),
      ]);
  }
  for (const id of ["core:unconscious", "core:down", "core:bleeding", "core:prone", "core:grappled"]) {
    if (hasCondition(w.state, pcId, id)) {
      const r = removeCondition(w.state, pcId, id, "aftermath of defeat");
      if (r.ok) w.apply(r.value);
    }
  }
  const hp = sheetOf(w.state, pcId).status.hp;
  if (hp < 1)
    w.apply([draft("HpChanged", { actorId: pcId, hp: 1, delta: 1 - hp, cause: "healing" }, "engine")]);
  return w.events;
}

import { Combatant, draft } from "@wyrd/core";
import { createActor } from "./campaign.ts";
import { resolveCheck } from "./checks.ts";
import type { CombatContext } from "./combat/common.ts";
import { spawnSheet } from "./combat/flow.ts";
import type { Working } from "./working.ts";

/** A present protector joins the victim's side at rolled initiative, with no free attack. */
export function joinDefender(w: Working, id: string, victimId: string, ctx: CombatContext): boolean {
  const c = w.state.combat;
  const victim = c?.combatants[victimId];
  if (!c || !victim || c.combatants[id] || ctx.combatInfo(id).canFight === false) return false;
  if (w.state.scene?.positions[id] !== w.state.scene?.positions[victimId]) return false;
  if (!w.state.actors[id]) {
    const created = createActor(w.state, spawnSheet(w.state, id, ctx), "npc");
    if (!created.ok) return false;
    w.apply(created.value);
  }
  const actor = w.state.actors[id]!;
  if (actor.role !== "npc") return false;
  const a = actor.sheet.attributes;
  const roll = resolveCheck(
    w.state,
    {
      actorId: id,
      skill: { attribute: "agi" },
      difficulty: "normal",
      modifiers:
        a.awa !== a.agi
          ? [{ source: "awareness", value: (a.awa - a.agi) * ctx.tuning.derived.initiativePerAwa }]
          : [],
      purpose: "initiative",
      tags: ["initiative", "resist"],
    },
    ctx,
  );
  if (!roll.ok) return false;
  w.apply(roll.value.events);
  const rank = { critFailure: 0, failure: 1, success: 2, critSuccess: 3 } as const;
  const initiative = rank[roll.value.effective.degree] * 1000 + roll.value.effective.margin;
  const current = c.order[c.turn]!;
  const combatants = {
    ...c.combatants,
    [id]: Combatant.parse({
      actorId: id,
      side: victim.side,
      group: victim.group,
      tactics: ctx.combatInfo(id).tactics ?? "protector",
      initiative,
      controlled: false,
    }),
  };
  // Stable insertion; existing ties keep their established order. The current actor stays current.
  const before = c.order.findIndex((other) => combatants[other]!.initiative < initiative);
  const order = [...c.order];
  order.splice(before < 0 ? order.length : before, 0, id);
  w.apply([
    draft(
      "CombatChanged",
      { combat: { ...w.state.combat!, combatants, order, turn: order.indexOf(current) } },
      "engine",
    ),
  ]);
  return true;
}

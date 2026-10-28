import { type ActorId, draft, type EventDraft, type Wound } from "@wyrd/core";
import { fail, ok, type Result } from "../result.ts";
import type { GameState } from "../state.ts";
import { Working } from "../working.ts";
import { bleedingEnabled, downCheck, endDownRoll, type InjuryContext, worsenToLethal } from "./hit.ts";

export type BleedResult = { events: EventDraft[]; worsened: "unconscious" | "lethal" | null };

const SEVERITY_RANK: Record<Wound["severity"], number> = { minor: 0, serious: 1, critical: 2, lethal: 3 };

/** The most severe wound. On a tie, the most recently inflicted one (last in the array). */
function mostSevere(wounds: readonly Wound[]): Wound | undefined {
  let worst: Wound | undefined;
  for (const w of wounds) {
    if (!worst || SEVERITY_RANK[w.severity] >= SEVERITY_RANK[worst.severity]) worst = w;
  }
  return worst;
}

/**
 * The 0 HP check for a bleed tick (spec 03, Bleeding). A Down actor who fails END becomes
 * Unconscious; an Unconscious actor who fails END has their most severe wound worsened to lethal.
 */
function zeroHpCheck(w: Working, actorId: ActorId, ctx: InjuryContext): BleedResult["worsened"] {
  const unconscious = w.state.actors[actorId]!.sheet.status.conditions.some(
    (c) => c.id === "core:unconscious",
  );
  if (!unconscious) {
    return downCheck(w, actorId, ctx) === "unconscious" ? "unconscious" : null;
  }
  if (endDownRoll(w, actorId, ctx)) return null;
  const worst = mostSevere(w.state.actors[actorId]!.sheet.status.wounds);
  if (!worst || worst.severity === "lethal") return null;
  worsenToLethal(w, actorId, worst.id, ctx);
  return "lethal";
}

/**
 * One bleed tick, at the end of the bleeder's turn (spec 03, Bleeding "In combat"). Above 0 HP,
 * bleeding N loses N HP, floored at 0. Reaching 0 HP, or bleeding at 0 HP, runs the 0 HP check.
 * With no bleeding, or the bleeding subsystem off, there are no events.
 */
export function bleedTick(state: GameState, actorId: ActorId, ctx: InjuryContext): Result<BleedResult> {
  const actor = state.actors[actorId];
  if (!actor) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  const level = actor.sheet.status.conditions.find((c) => c.id === "core:bleeding")?.level ?? 0;
  if (level <= 0 || !bleedingEnabled(state.campaign.settings)) return ok({ events: [], worsened: null });

  const w = new Working(state);
  const hpBefore = actor.sheet.status.hp;
  if (hpBefore > 0) {
    const hp = Math.max(0, hpBefore - level);
    w.apply([draft("HpChanged", { actorId, hp, delta: hp - hpBefore, cause: "bleeding" }, "engine")]);
    if (hp > 0) return ok({ events: w.events, worsened: null });
  }
  return ok({ events: w.events, worsened: zeroHpCheck(w, actorId, ctx) });
}

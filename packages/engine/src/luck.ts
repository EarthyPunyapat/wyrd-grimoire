import { type CampaignSettings, draft, type EventDraft, type Tuning } from "@wyrd/core";
import { type CheckOutcome, rerollAs } from "./checks.ts";
import { compareDegreeMargin } from "./resolution/index.ts";
import { fail, ok, type Result } from "./result.ts";
import type { GameState, RulesContext } from "./state.ts";

/** Luck max from the lethality dial; hardcore takes one off, never below 1. */
export function luckMax(settings: CampaignSettings, tuning: Tuning): number {
  const base = tuning.luckMax[settings.lethality];
  return settings.structural.hardcore ? Math.max(1, base - 1) : base;
}

function pcWithLuck(state: GameState, actorId: string, cost: number): Result<true> {
  const actor = state.actors[actorId];
  if (!actor) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  if (actor.role !== "pc") return fail("LUCK_PC_ONLY", "Only the player character has Luck");
  if (actor.sheet.status.luck < cost) {
    return fail("LUCK_INSUFFICIENT", `Needs ${cost} Luck, has ${actor.sheet.status.luck}`);
  }
  return ok(true);
}

/** Spend 1 Luck: reroll the PC's last check and keep the better result. Not on a pushed roll. */
export function spendLuckReroll(state: GameState, actorId: string, ctx: RulesContext): Result<CheckOutcome> {
  const cost = ctx.tuning.luckCost.reroll;
  const can = pcWithLuck(state, actorId, cost);
  if (!can.ok) return can;
  const last = state.lastChecks[actorId];
  if (!last) return fail("NO_CHECK_TO_REROLL", "There is no check to reroll");
  if (last.pushed) return fail("LUCK_ON_PUSHED", "Luck can't reroll a pushed roll");
  if (last.luckUsed) return fail("LUCK_ALREADY_USED", "This check was already rerolled with Luck");
  if (last.opposed)
    return fail("LUCK_OPPOSED_UNSUPPORTED", "Luck on opposed checks arrives with combat (M4)");
  if (last.autoFailed) return fail("LUCK_IMPOSSIBLE", "An automatic failure can't be rerolled");

  const previous = last.effective;
  const reroll = rerollAs(state, last.request, ctx, "luck", (result) =>
    compareDegreeMargin(result, previous) > 0 ? result : previous,
  );
  if (!reroll.ok) return reroll;
  const spent = draft("LuckSpent", { actorId, amount: cost, purpose: "reroll" }, "player");
  return ok({ events: [spent, ...reroll.value.events], effective: reroll.value.effective });
}

/** Spend 2 Luck: downgrade a lethal wound to critical. */
export function spendLuckDowngrade(
  state: GameState,
  actorId: string,
  woundId: string,
  ctx: RulesContext,
): Result<EventDraft[]> {
  const cost = ctx.tuning.luckCost.downgradeWound;
  const can = pcWithLuck(state, actorId, cost);
  if (!can.ok) return can;
  const wound = state.actors[actorId]!.sheet.status.wounds.find((w) => w.id === woundId);
  if (!wound) return fail("WOUND_UNKNOWN", `No wound ${woundId}`);
  if (wound.severity !== "lethal") return fail("WOUND_NOT_LETHAL", "Only a lethal wound can be downgraded");
  return ok([draft("LuckSpent", { actorId, amount: cost, purpose: "downgradeWound", woundId }, "player")]);
}

/** Regain Luck: 1 when a chapter closes, refill when an arc closes. Nothing to emit when already full. */
export function regainLuck(
  state: GameState,
  actorId: string,
  reason: "chapterClosed" | "arcClosed",
  ctx: RulesContext,
): Result<EventDraft[]> {
  const actor = state.actors[actorId];
  if (!actor) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  if (actor.role !== "pc") return ok([]);
  const max = luckMax(state.campaign.settings, ctx.tuning);
  const missing = Math.max(0, max - actor.sheet.status.luck);
  const amount = reason === "chapterClosed" ? Math.min(1, missing) : missing;
  return ok(amount > 0 ? [draft("LuckRegained", { actorId, amount, reason }, "engine")] : []);
}

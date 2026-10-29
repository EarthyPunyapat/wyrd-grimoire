import {
  ActArgs,
  type Card,
  ChangeStateArgs,
  type Choice,
  draft,
  ObserveArgs,
  OfferChoicesArgs,
  RetconArgs,
  RollArgs,
  ShowCardArgs,
  TimeSkipArgs,
} from "@wyrd/core";
import { applyChanges, knownEntities, resolveTurn, validateTurn } from "@wyrd/engine";
import { registerGmTool } from "../registry.ts";
import type { ToolContext, ToolProgress, ToolRun } from "../tool-types.ts";

/** Runs engine actions for one actor; plan errors go back to the model, never thrown. */
function act(actorId: string, actions: unknown[], x: ToolContext, progress?: ToolProgress): ToolRun {
  const plan = validateTurn(x.state, actorId, actions, x.ctx);
  if (!plan.ok)
    return { ok: false, body: { errors: plan.planErrors?.length ? plan.planErrors : plan.errors } };
  const resolved = resolveTurn(x.state, plan.value, x.ctx, x.newId());
  if (!resolved.ok) return { ok: false, body: { errors: resolved.errors } };
  const { events, resolution } = resolved.value;
  return {
    ok: true,
    body: {
      steps: resolution.steps.map((s) => ({
        summary: s.summary,
        outcome: s.outcome,
        mechanics: s.mechanics?.text,
      })),
      minutes: resolution.minutes,
    },
    effects: {
      drafts: events,
      mechanics: resolution.steps.flatMap((s) => (s.mechanics ? [s.mechanics] : [])),
      ...(progress ? { progress } : {}),
    },
  };
}

function publicFacts(x: ToolContext, entityId: string) {
  return x.canon
    .factsAbout(entityId)
    .filter((f) => f.visibility !== "secret")
    .map((f) => ({ predicate: f.predicate, value: f.value }));
}

function changes(name: "change_state" | "retcon", a: ChangeStateArgs | RetconArgs, x: ToolContext): ToolRun {
  const applied = applyChanges(x.state, a.changes, { items: x.items, newId: x.newId });
  const ok = applied.outcomes.some((o) => o.ok);
  const run: ToolRun = { ok, body: { outcomes: applied.outcomes }, effects: { drafts: applied.drafts } };
  if (name === "retcon" && ok) {
    const retconId = x.newId();
    const summary = (a as RetconArgs).summary;
    run.effects = {
      drafts: [
        ...applied.drafts,
        draft("RetconApplied", { retconId, turnId: x.turnId, summary, inverse: applied.inverse }),
      ],
      cards: [{ type: "retcon", retconId }],
      retcon: { retconId, summary, inverse: applied.inverse },
    };
  }
  return run;
}

registerGmTool({
  name: "roll",
  description: "Roll a check for an uncertain outcome; returns the dice and the degree to narrate.",
  schema: RollArgs,
  run: (a, x) => {
    const check = {
      type: "check",
      skill: a.skill,
      goal: a.goal,
      proposedDifficulty: a.difficulty,
      reason: a.goal,
      ...(a.targetId ? { targetId: a.targetId } : {}),
    };
    const rolled = act(a.actorId ?? x.pcId, [check], x, { phase: "rolling", detail: a.goal });
    if (rolled.effects?.mechanics)
      rolled.effects.mechanics = rolled.effects.mechanics.map((m) => ({
        ...m,
        purpose: a.goal.slice(0, 200),
      }));
    return rolled;
  },
});

registerGmTool({
  name: "act",
  description:
    "Resolve engine actions (move, talk, travel, search, rest, cast, strike and combat actions) for an actor.",
  schema: ActArgs,
  run: (a, x) => act(a.actorId ?? x.pcId, a.actions, x),
});

registerGmTool({
  name: "change_state",
  description: "Change items, coins, HP, entities, facts, quests, clocks or XP; each change is validated.",
  schema: ChangeStateArgs,
  run: (a, x) => changes("change_state", a, x),
});

registerGmTool({
  name: "retcon",
  description: "GM mode: rewrite the world as the player asked; the player sees a Retcon card with Undo.",
  schema: RetconArgs,
  run: (a, x) => changes("retcon", a, x),
});

registerGmTool({
  name: "observe",
  description: "Look at a known entity now: its public facts and where it is.",
  schema: ObserveArgs,
  run: ({ targetId }, x) => {
    const entity = knownEntities(x.state).has(targetId) ? x.canon.entity(targetId) : null;
    const actor = x.state.actors[targetId];
    if (!entity && !actor) return { ok: false, body: { errors: `${targetId} is not known` } };
    return {
      ok: true,
      body: {
        id: targetId,
        name: entity?.name ?? actor?.sheet.identity.name,
        summary: entity?.summary,
        facts: publicFacts(x, targetId),
        zone: x.state.scene?.positions[targetId] ?? null,
      },
    };
  },
});

registerGmTool({
  name: "time_skip",
  description: "Let time pass; the world moves on.",
  schema: TimeSkipArgs,
  run: (a, x) =>
    act(x.pcId, [{ type: "wait", minutes: a.minutes }], x, { phase: "simulating", detail: a.reason }),
});

registerGmTool({
  name: "show_card",
  description: "Show cards (item, character, status, chapter, roll, report).",
  schema: ShowCardArgs,
  run: (a) => ({ ok: true, body: {}, effects: { cards: a.cards as Card[] } }),
});

registerGmTool({
  name: "offer_choices",
  description: "Offer 2-5 choices, following the choice policy.",
  schema: OfferChoicesArgs,
  run: (a) => ({ ok: true, body: {}, effects: { choices: a.choices as Choice[] } }),
});

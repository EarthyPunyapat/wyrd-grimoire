import {
  ActArgs,
  type Card,
  ChangeStateArgs,
  type Choice,
  draft,
  type EventDraft,
  type ItemCatalog,
  LookupArgs,
  type MechanicsLine,
  ObserveArgs,
  OfferChoicesArgs,
  RetconArgs,
  RollArgs,
  ShowCardArgs,
  TimeSkipArgs,
} from "@wyrd/core";
import {
  applyChanges,
  type GameState,
  knownEntities,
  resolveTurn,
  type TurnContext,
  validateTurn,
} from "@wyrd/engine";
import type { CanonSource } from "@wyrd/memory";
import { z } from "zod";
import type { ToolCall, ToolDef } from "../types.ts";

export type ToolProgress = { phase: "rolling" | "researching" | "simulating"; detail?: string };

export type ToolEffects = {
  drafts: EventDraft[];
  mechanics: MechanicsLine[];
  cards: Card[];
  choices: Choice[];
  retcon?: { retconId: string; summary: string; inverse: EventDraft[] };
  progress?: ToolProgress;
};

export type ToolContext = {
  state: GameState;
  pcId: string;
  turnId: string;
  ctx: TurnContext;
  canon: CanonSource;
  items: ItemCatalog;
  newId: () => string;
};

export type ToolOutcome = { result: string; effects: ToolEffects; ok: boolean };

const TOOLS = {
  roll: {
    schema: RollArgs,
    description: "Roll a check for an uncertain outcome; returns the dice and the degree to narrate.",
  },
  act: {
    schema: ActArgs,
    description:
      "Resolve engine actions (move, talk, travel, search, rest, cast, strike and combat actions) for an actor.",
  },
  change_state: {
    schema: ChangeStateArgs,
    description: "Change items, coins, HP, entities, facts, quests, clocks or XP; each change is validated.",
  },
  retcon: {
    schema: RetconArgs,
    description: "GM mode: rewrite the world as the player asked; the player sees a Retcon card with Undo.",
  },
  lookup_lore: { schema: LookupArgs, description: "Look up what the player knows about a name or topic." },
  observe: {
    schema: ObserveArgs,
    description: "Look at a known entity now: its public facts and where it is.",
  },
  time_skip: { schema: TimeSkipArgs, description: "Let time pass; the world moves on." },
  show_card: {
    schema: ShowCardArgs,
    description: "Show cards (item, character, status, chapter, roll, report).",
  },
  offer_choices: { schema: OfferChoicesArgs, description: "Offer 2-5 choices, following the choice policy." },
} as const;
type ToolName = keyof typeof TOOLS;

export function gmToolDefs(_o: { inCombat: boolean }): ToolDef[] {
  return (Object.keys(TOOLS) as ToolName[]).map((name) => ({
    name,
    description: TOOLS[name].description,
    parameters: z.toJSONSchema(TOOLS[name].schema) as ToolDef["parameters"],
  }));
}

const none = (): ToolEffects => ({ drafts: [], mechanics: [], cards: [], choices: [] });
const reply = (ok: boolean, body: Record<string, unknown>, effects = none()): ToolOutcome => ({
  ok,
  result: JSON.stringify({ ok, ...body }),
  effects,
});

/** Runs engine actions for one actor; plan errors go back to the model, never thrown. */
function act(actorId: string, actions: unknown[], x: ToolContext, progress?: ToolProgress): ToolOutcome {
  const plan = validateTurn(x.state, actorId, actions, x.ctx);
  if (!plan.ok) return reply(false, { errors: plan.planErrors?.length ? plan.planErrors : plan.errors });
  const resolved = resolveTurn(x.state, plan.value, x.ctx, x.newId());
  if (!resolved.ok) return reply(false, { errors: resolved.errors });
  const { events, resolution } = resolved.value;
  const mechanics = resolution.steps.flatMap((s) => (s.mechanics ? [s.mechanics] : []));
  return reply(
    true,
    {
      steps: resolution.steps.map((s) => ({
        summary: s.summary,
        outcome: s.outcome,
        mechanics: s.mechanics?.text,
      })),
      minutes: resolution.minutes,
    },
    { ...none(), drafts: events, mechanics, ...(progress ? { progress } : {}) },
  );
}

function publicFacts(x: ToolContext, entityId: string) {
  return x.canon
    .factsAbout(entityId)
    .filter((f) => f.visibility !== "secret")
    .map((f) => ({ predicate: f.predicate, value: f.value }));
}

/** Executes one GM tool call against the working state. Never throws: failures are results. */
export function executeTool(call: ToolCall, x: ToolContext): ToolOutcome {
  const tool = TOOLS[call.name as ToolName];
  if (!tool) return reply(false, { errors: `Unknown tool ${call.name}` });
  const parsed = tool.schema.safeParse(call.args);
  if (!parsed.success) return reply(false, { errors: z.prettifyError(parsed.error) });
  try {
    return run(call.name as ToolName, parsed.data, x);
  } catch (e) {
    return reply(false, { errors: e instanceof Error ? e.message : String(e) });
  }
}

function run(name: ToolName, args: unknown, x: ToolContext): ToolOutcome {
  switch (name) {
    case "roll": {
      const a = args as RollArgs;
      const check = {
        type: "check",
        skill: a.skill,
        goal: a.goal,
        proposedDifficulty: a.difficulty,
        reason: a.goal,
        ...(a.targetId ? { targetId: a.targetId } : {}),
      };
      return act(a.actorId ?? x.pcId, [check], x, { phase: "rolling", detail: a.goal });
    }
    case "act": {
      const a = args as ActArgs;
      return act(a.actorId ?? x.pcId, a.actions, x);
    }
    case "time_skip": {
      const a = args as TimeSkipArgs;
      return act(x.pcId, [{ type: "wait", minutes: a.minutes }], x, {
        phase: "simulating",
        detail: a.reason,
      });
    }
    case "change_state":
    case "retcon": {
      const a = args as ChangeStateArgs | RetconArgs;
      const applied = applyChanges(x.state, a.changes, { items: x.items, newId: x.newId });
      const ok = applied.outcomes.some((o) => o.ok);
      const effects = { ...none(), drafts: applied.drafts };
      if (name === "retcon" && ok) {
        const retconId = x.newId();
        const summary = (a as RetconArgs).summary;
        effects.drafts = [
          ...applied.drafts,
          draft("RetconApplied", { retconId, turnId: x.turnId, summary, inverse: applied.inverse }),
        ];
        effects.cards = [{ type: "retcon", retconId }];
        effects.retcon = { retconId, summary, inverse: applied.inverse };
      }
      return reply(ok, { outcomes: applied.outcomes }, effects);
    }
    case "lookup_lore": {
      const known = knownEntities(x.state);
      const found = x.canon
        .findByName((args as { query: string }).query)
        .filter((e) => known.has(e.id))
        .slice(0, 5)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          name: e.name,
          summary: e.summary,
          facts: publicFacts(x, e.id),
        }));
      return reply(
        true,
        { found },
        { ...none(), progress: { phase: "researching", detail: (args as { query: string }).query } },
      );
    }
    case "observe": {
      const { targetId } = args as { targetId: string };
      const entity = knownEntities(x.state).has(targetId) ? x.canon.entity(targetId) : null;
      const actor = x.state.actors[targetId];
      if (!entity && !actor) return reply(false, { errors: `${targetId} is not known` });
      return reply(true, {
        id: targetId,
        name: entity?.name ?? actor?.sheet.identity.name,
        summary: entity?.summary,
        facts: publicFacts(x, targetId),
        zone: x.state.scene?.positions[targetId] ?? null,
      });
    }
    case "show_card":
      return reply(true, {}, { ...none(), cards: (args as { cards: Card[] }).cards });
    case "offer_choices":
      return reply(true, {}, { ...none(), choices: (args as { choices: Choice[] }).choices });
  }
}

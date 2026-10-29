import {
  type Card,
  type Choice,
  defaultTuning,
  draft,
  type EventDraft,
  type MechanicsLine,
} from "@wyrd/core";
import { catalogWith, type GameState, type TurnContext, Working } from "@wyrd/engine";
import type { AssembledPrompt } from "@wyrd/memory";
import type { PipelineDeps, TurnInput, TurnResult } from "../pipeline.ts";
import { GM_VERSION } from "../prompts/gm.ts";
import { ROLE_TIMEOUTS_MS } from "../router.ts";
import type { Message } from "../types.ts";
import { executeTool, gmToolDefs } from "./tools.ts";

const GM_PREFIX = /^\/gm\b\s*/i;
const GM_MODE_LINE = "GM MODE: carry this out with the retcon tool.";
const CLASSIC_FALLBACK = "The game master is unavailable; using the classic pipeline for this turn.";

export type GmHooks = {
  /** The pipeline's assembled GM prompt for this state and input. */
  prompt: (state: GameState, input: string) => AssembledPrompt;
  ctx: (state: GameState) => TurnContext;
  /** Runs the classic parser → narrator → guard pipeline under an already-announced turn id. */
  classic: (turnId: string) => Promise<TurnResult>;
};

/**
 * One GM-with-tools turn (D144): the GM streams prose and calls engine tools; each call runs against
 * a working state so later calls see earlier changes, and the whole turn is appended once at the end.
 */
export async function runGmTurn(d: PipelineDeps, t: TurnInput, hooks: GmHooks): Promise<TurnResult> {
  const emit = t.onEvent ?? (() => {});
  const turnId = d.newId();
  emit({ type: "turn.accepted", turnId });
  if (t.actions) return hooks.classic(turnId);

  const start = d.store.state();
  const pcId = start.party.pcId;
  if (!pcId) throw new Error("The campaign has no player character");
  const gmMode = GM_PREFIX.test(t.input);
  const input = gmMode ? t.input.replace(GM_PREFIX, "") : t.input;
  const prompt = hooks.prompt(start, input);
  const messages: Message[] = [
    { role: "user", content: gmMode ? `${prompt.context}\n\n${GM_MODE_LINE}\n${input}` : prompt.context },
  ];
  const primary = d.router.route("gm");
  const maxRounds = defaultTuning.gm.maxToolRounds;
  const working = new Working(start);
  const mechanics: MechanicsLine[] = [];
  const cards: Card[] = [];
  const choices: Choice[] = [];
  const tools: { name: string; ok: boolean; note: string }[] = [];
  let text = "";
  let provider = primary.provider;
  let model = primary.model;
  let backup = false;
  let rounds = 0;

  for (let round = 0; round <= maxRounds; round++) {
    const finishing = round === maxRounds;
    let c: Awaited<ReturnType<typeof d.router.complete>>;
    try {
      c = await d.router.complete(
        "gm",
        {
          instructions: prompt.instructions,
          messages,
          ...(finishing
            ? {}
            : {
                tools: gmToolDefs({ inCombat: Boolean(working.state.combat) }),
                toolChoice: "auto" as const,
              }),
        },
        {
          promptVersion: GM_VERSION,
          turnId,
          timeoutMs: ROLE_TIMEOUTS_MS.gm,
          onText: (delta) => emit({ type: "narration.delta", delta }),
          ...(d.campaignId ? { campaignId: d.campaignId } : {}),
        },
      );
    } catch (e) {
      if (round === 0) {
        emit({ type: "fallback", message: CLASSIC_FALLBACK });
        return hooks.classic(turnId);
      }
      // A later round failed: keep what the earlier rounds committed and finish with the prose so far.
      backup = true;
      break;
    }
    rounds = round + 1;
    text += c.text;
    if (c.provider !== primary.provider || c.model !== primary.model) {
      if (!backup) emit({ type: "model.backup", provider: c.provider });
      backup = true;
    }
    provider = c.provider;
    model = c.model;
    if (finishing || !c.toolCalls.length) break;

    messages.push({
      role: "assistant",
      content: c.text,
      toolCalls: c.toolCalls,
      ...(c.raw ? { raw: c.raw } : {}),
    });
    for (const call of c.toolCalls) {
      const r = executeTool(call, {
        state: working.state,
        pcId,
        turnId,
        ctx: hooks.ctx(working.state),
        canon: d.canon,
        items: catalogWith(working.state, d.content?.items ?? { weapons: {}, armor: {}, gear: {} }),
        newId: d.newId,
      });
      working.apply(r.effects.drafts);
      tools.push({ name: call.name, ok: r.ok, note: r.ok ? "" : r.result.slice(0, 200) });
      if (r.effects.progress) emit({ type: "progress", ...r.effects.progress });
      for (const line of r.effects.mechanics) {
        mechanics.push(line);
        emit({ type: "mechanics.line", line });
      }
      for (const card of r.effects.cards) {
        cards.push(card);
        emit({ type: "card", card });
      }
      if (r.effects.choices.length) {
        choices.splice(0, choices.length, ...r.effects.choices);
        emit({ type: "choices", choices: r.effects.choices });
      }
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: r.result });
    }
  }

  const drafts: EventDraft[] = [
    draft("TurnStarted", { input: t.input }, "player"),
    ...working.events,
    draft("TurnCompleted", {
      status: "resolved",
      intent: input,
      plan: [],
      mechanics,
      gm: { cards, choices, tools, provider, model, backup, rounds },
    }),
    draft("NarrationCommitted", {
      text,
      provider,
      model,
      promptVersion: GM_VERSION,
      fallback: false,
      guard: { checked: false, regenerated: false, flagged: [] },
    }),
  ];
  d.store.append(drafts, { turnId });
  emit({ type: "narration.final", text, turnId });
  emit({ type: "turn.completed", turnId });
  return { turnId, status: "resolved", narration: text, mechanics, repairs: 0 };
}

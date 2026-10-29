import type { BodyPlanDef, CompiledPack, CreatureDef, ItemCatalog, SceneInput } from "@wyrd/core";
import {
  type CharacterSheet,
  type Clarification,
  draft,
  Entity,
  type EventDraft,
  type EventEnvelope,
  type ExplorationActionInput,
  Fact,
  type GuardSummary,
  type MechanicsLine,
  type Resolution,
} from "@wyrd/core";
import {
  actingActor,
  approvalEvents,
  type CombatInfo,
  combatView,
  type GameState,
  mechanicalSummary,
  type RulesContext,
  resolveTurn,
  type TurnContext,
  type TurnPlanError,
  turnAwards,
  validateTurn,
  Working,
} from "@wyrd/engine";
import { type AssembledPrompt, type AssemblerRole, assemble, type CanonSource } from "@wyrd/memory";
import {
  COMBAT_RULES_DIGEST,
  EXPLORATION_RULES_DIGEST,
  GUARD_INSTRUCTIONS,
  GUARD_VERSION,
  NARRATOR_INSTRUCTIONS,
  NARRATOR_VERSION,
  OOC_INSTRUCTIONS,
  OOC_VERSION,
  PARSER_INSTRUCTIONS,
  PARSER_VERSION,
} from "./prompts/index.ts";
import type { RoleRouter } from "./router.ts";
import {
  AnswerOoc,
  AskClarification,
  AskCombatClarification,
  blockingIssues,
  GUARD_TOOL,
  GuardReportV1,
  ProposeActions,
  ProposeCombatActions,
  parserTools,
} from "./tools.ts";
import { type Message, ProviderError } from "./types.ts";

/** What the pipeline needs from a campaign file. `CampaignStore<GameState>` satisfies it. */
export interface TurnStore {
  readonly activeBranchId: string;
  state(branchId?: string, atSeq?: number): GameState;
  append(drafts: EventDraft[], opts?: { turnId?: string }): EventEnvelope[];
}

/** What the pipeline reads from canon. `CanonQueries` satisfies it. */
export interface TurnCanon extends CanonSource {
  turn(
    id: string,
  ): { id: string; startedSeq: number; input: string; record: Record<string, unknown> | null } | null;
}

/** Events streamed to the client while a turn runs (spec 08, "Streaming to the client"). */
export type TurnStreamEvent =
  | { type: "turn.accepted"; turnId: string }
  | { type: "clarify"; clarification: Clarification }
  | { type: "mechanics.line"; line: MechanicsLine }
  | { type: "narration.delta"; delta: string }
  | { type: "narration.final"; text: string; turnId: string }
  | { type: "guard.flag"; flags: GuardSummary["flagged"] }
  | { type: "fallback"; message: string }
  | { type: "turn.completed"; turnId: string }
  | { type: "error"; message: string; retryable: boolean };

export type TurnResult = {
  turnId: string;
  status: "resolved" | "clarify" | "ooc" | "failed";
  narration?: string;
  mechanics: MechanicsLine[];
  clarification?: Clarification;
  answer?: string;
  guard?: GuardSummary;
  /** How many repair attempts the parser needed (0–2). */
  repairs: number;
  error?: string;
};

export type PipelineDeps = {
  store: TurnStore;
  canon: TurnCanon;
  router: RoleRouter;
  rules: RulesContext;
  /** Section 3 and 4 inputs: the pack's tone guide and the world bible. */
  tone: string;
  worldBible: string;
  /** Fresh unique IDs (ULIDs in production). */
  newId: () => string;
  campaignId?: string;
  /** Combat content from the campaign's frozen pack: items, body plans and stat blocks. */
  content?: CombatContent;
  /** A full sheet for an NPC who joins the party (spec 04 recruiting); missing = nobody can join. */
  recruitSheet?: (npcId: string, state: GameState) => CharacterSheet | null;
  /** Lazy generation (spec 06): canon events for a site's arrival place, or a stub's details. */
  lazy?: {
    location(siteId: string): Promise<EventDraft[]>;
    elaborate(entityId: string): Promise<EventDraft[]>;
  };
};

export type CombatContent = {
  items: ItemCatalog;
  bodyPlans: Record<string, BodyPlanDef>;
  creatures: Record<string, CreatureDef & { id: string }>;
};

/** The combat content of a compiled pack (older frozen packs may lack creatures). */
export function combatContent(pack: CompiledPack): CombatContent {
  return { items: pack.items, bodyPlans: pack.bodyPlans ?? {}, creatures: pack.creatures ?? {} };
}

/** Rules plus combat content plus canon lookups: what the engine needs for a turn in either mode. */
export function makeTurnContext(
  state: GameState,
  canon: Pick<CanonSource, "entity" | "factsAbout">,
  rules: RulesContext,
  content?: CombatContent,
  opts: { canGenerate?: boolean; recruitSheet?: (npcId: string) => CharacterSheet | null } = {},
): TurnContext {
  const c = content ?? { items: { weapons: {}, armor: {}, gear: {} }, bodyPlans: {}, creatures: {} };
  const itemName = (id: string) =>
    c.items.weapons[id]?.name ?? c.items.armor[id]?.name ?? c.items.gear[id]?.name;
  return {
    ...rules,
    ...c,
    ...(opts.recruitSheet ? { recruitSheet: opts.recruitSheet } : {}),
    nameOf: (id) =>
      state.actors[id]?.sheet.identity.name ??
      canon.entity(id)?.name ??
      state.scene?.zones.find((z) => z.id === id)?.name ??
      state.scene?.zones.flatMap((z) => z.props).find((p) => p.id === id)?.name ??
      itemName(id) ??
      id,
    combatInfo: (id): CombatInfo => {
      const e = canon.entity(id);
      const d = (e?.data ?? {}) as Record<string, unknown>;
      return {
        ...(typeof d.statBlock === "string" ? { statBlock: d.statBlock } : {}),
        ...(typeof d.group === "string" ? { group: d.group } : {}),
        ...(d.leader === true ? { leader: true } : {}),
        ...(typeof d.tactics === "string" ? { tactics: d.tactics as never } : {}),
        ...(typeof d.intent === "string" ? { intent: d.intent as never } : {}),
        ...(d.ally === true ? { ally: true } : {}),
        canFight: !e || e.kind === "npc" || e.kind === "creature",
      };
    },
    travel: {
      canGenerate: !!opts.canGenerate,
      siteOf: (locationId) => (canon.entity(locationId)?.data as { siteId?: string } | undefined)?.siteId,
      arrival: (siteId) => {
        const loc = (canon.entity(siteId)?.data as { arrivalLocationId?: string } | undefined)
          ?.arrivalLocationId;
        const scene = loc
          ? (canon.entity(loc)?.data as { scene?: SceneInput } | undefined)?.scene
          : undefined;
        return loc && scene ? { locationId: loc, scene } : null;
      },
      encounter: (terrain, danger) => roadEncounter(c.creatures, terrain, danger),
    },
    regions: () => {
      const here = state.scene
        ? (canon.entity(state.scene.locationId)?.data as { siteId?: string } | undefined)?.siteId
        : undefined;
      const hereRegion = here
        ? (canon.entity(here)?.data as { regionId?: string } | undefined)?.regionId
        : undefined;
      const ids = new Set(
        state.edges.filter((e) => e.type === "locatedIn" && e.from.startsWith("site:")).map((e) => e.to),
      );
      return [...ids].map((id) => ({
        id,
        climate: String((canon.entity(id)?.data as { climate?: string } | undefined)?.climate ?? "temperate"),
        ...(id === hereRegion ? { current: true } : {}),
      }));
    },
    publicFactIds: (entityId) => canon.factsAbout(entityId).map((f) => f.id),
    kindOf: (id) => canon.entity(id)?.kind,
  };
}

/** A road encounter (spec 06): the pack's robbers if it has any, otherwise ordinary road thieves. */
function roadEncounter(
  creatures: CombatContent["creatures"],
  terrain: string,
  danger: number,
): { name: string; foes: Array<{ name: string; statBlock?: string }> } | null {
  if (danger < 2) return null;
  const robbers = Object.values(creatures).filter((c) => c.intent === "rob" || c.intent === "prey");
  const count = Math.min(4, danger);
  if (robbers.length)
    return {
      name: `${robbers[0]!.name.toLowerCase()}s on the ${terrain}`,
      foes: Array.from({ length: count }, (_, i) => {
        const c = robbers[i % robbers.length]!;
        return { name: `${c.name} ${i + 1}`, statBlock: c.id };
      }),
    };
  return {
    name: `road thieves on the ${terrain}`,
    foes: Array.from({ length: count - 1 }, (_, i) => ({ name: `Road thief ${i + 1}` })),
  };
}

/** The state after applying drafts (for prompts only; storage assigns the real envelopes). */
function afterEvents(state: GameState, drafts: EventDraft[]): GameState {
  const w = new Working(state);
  w.apply(drafts);
  return w.state;
}

/** Any action the parser may propose: exploration or combat. */
type ActionInput = ExplorationActionInput | { type: string; [k: string]: unknown };

export type TurnInput = {
  input: string;
  /** Set when the player clicked a clarification option: its actions skip the parser. */
  actions?: ActionInput[];
  onEvent?: (e: TurnStreamEvent) => void;
};

const MAX_REPAIRS = 2;
const MAX_CHARS = { short: 900, normal: 1600, long: 2600 } as const;
const ROLE_INSTRUCTIONS: Record<AssemblerRole, string> = {
  parser: PARSER_INSTRUCTIONS,
  narrator: NARRATOR_INSTRUCTIONS,
  guard: GUARD_INSTRUCTIONS,
};

/** Short label for an action, for clarification options built from the engine's alternatives. */
export function describeAction(raw: ActionInput, nameOf: (id: string) => string): string {
  const c = raw as {
    type: string;
    targetId?: string;
    toZoneId?: string;
    weaponId?: string;
    spellId?: string;
    effect?: string;
    propId?: string;
    description?: string;
  };
  const combat: Record<string, () => string> = {
    engage: () => `Close in on ${nameOf(c.targetId!)}`,
    disengage: () => "Back out of the melee",
    aim: () => "Take aim",
    defend: () => "Defend",
    takeCover: () => (c.propId ? `Take cover behind ${nameOf(c.propId)}` : "Take cover"),
    draw: () => `Draw ${nameOf(c.weaponId!)}`,
    reload: () => "Reload",
    firstAid: () => `First aid on ${nameOf(c.targetId!)}`,
    standUp: () => "Get up",
    shove: () => `Shove ${nameOf(c.targetId!)}`,
    trip: () => `Trip ${nameOf(c.targetId!)}`,
    grapple: () => `Grapple ${nameOf(c.targetId!)}`,
    disarm: () => `Disarm ${nameOf(c.targetId!)}`,
    cast: () => `Cast ${(c.spellId ?? "a spell").split(":").pop()}`,
    stunt: () => c.description || `Stunt: ${c.effect}`,
    intimidate: () => `Intimidate ${nameOf(c.targetId!)}`,
    rally: () => `Rally ${nameOf(c.targetId!)}`,
    speak: () => "Say something",
    surrender: () => "Surrender",
    flee: () => "Flee",
    endTurn: () => "Hold position",
  };
  if (combat[c.type]) return combat[c.type]!();
  const a = raw as ExplorationActionInput;
  switch (a.type) {
    case "check":
      return `Try to ${a.goal} (${a.skill.replace(/^core:/, "")}, ${a.proposedDifficulty})`;
    case "examine":
      return `Look at ${a.targetId ? nameOf(a.targetId) : (a.area ?? "the surroundings")}`;
    case "search":
      return `Search ${a.targetId ? nameOf(a.targetId) : (a.area ?? "the area")}`;
    case "interact":
      return `${a.verb.charAt(0).toUpperCase()}${a.verb.slice(1)} ${nameOf(a.targetId)}`;
    case "move":
      return `Go to ${nameOf(a.toZoneId)}`;
    case "wait":
      return `Wait ${a.minutes} minutes`;
    case "talk":
      return `Say to ${nameOf(a.targetId)}: "${a.utterance}"`;
    case "strike":
      return `Attack ${nameOf(a.targetId)}`;
    case "recruit":
      return `Ask ${nameOf(a.targetId)} to join you`;
    case "travel":
      return `Travel to ${nameOf(a.toSiteId)}${a.pace && a.pace !== "normal" ? ` (${a.pace})` : ""}`;
    case "cast":
      return `Cast ${(a.spellId ?? "a spell").split(":").pop()}`;
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "thing";

/**
 * Runs one exploration turn end to end (spec 08): parse → validate → repair (max 2) → clarify →
 * resolve → narrate → guard (regenerate once, then flag) → commit, all events in one append.
 * One turn at a time per campaign.
 */
export class TurnPipeline {
  private busy = false;

  constructor(private readonly d: PipelineDeps) {}

  private nameOf = (state: GameState) => (id: string) =>
    state.actors[id]?.sheet.identity.name ??
    this.d.canon.entity(id)?.name ??
    state.scene?.zones.find((z) => z.id === id)?.name ??
    state.scene?.zones.flatMap((z) => z.props).find((p) => p.id === id)?.name ??
    id;

  private turnCtx(state: GameState): TurnContext {
    const recruit = this.d.recruitSheet;
    return makeTurnContext(state, this.d.canon, this.d.rules, this.d.content, {
      canGenerate: !!this.d.lazy,
      ...(recruit ? { recruitSheet: (npcId: string) => recruit(npcId, state) } : {}),
    });
  }

  /**
   * Lazy generation before resolution (spec 06): an unexplored travel destination gets its arrival
   * place, and stubs the player is about to meet get elaborated. Committed as canon at once.
   */
  private async prepareWorld(actions: unknown[], turnId: string): Promise<boolean> {
    if (!this.d.lazy) return false;
    const drafts: EventDraft[] = [];
    const done = new Set<string>();
    for (const raw of actions) {
      const a = raw as { type?: string; toSiteId?: string; targetId?: string };
      const key = a.toSiteId ?? a.targetId;
      if (!key || done.has(key)) continue;
      done.add(key);
      if (a.type === "travel" && a.toSiteId) {
        const site = this.d.canon.entity(a.toSiteId);
        if (site && !(site.data as { arrivalLocationId?: string }).arrivalLocationId)
          drafts.push(...(await this.d.lazy.location(a.toSiteId)));
      }
      if ((a.type === "talk" || a.type === "examine") && a.targetId) {
        const e = this.d.canon.entity(a.targetId);
        if (e?.detail === "stub" && ["npc", "location", "site", "faction"].includes(e.kind))
          drafts.push(...(await this.d.lazy.elaborate(a.targetId)));
      }
    }
    if (drafts.length) this.d.store.append(drafts, { turnId });
    return drafts.length > 0;
  }

  /** Roads from the current site, for the parser's travel action (spec 06). */
  private travelText(state: GameState): string | undefined {
    const journey = state.flags.journey as { fromSiteId: string; toSiteId: string } | null | undefined;
    const here =
      journey?.fromSiteId ??
      (state.scene
        ? (this.d.canon.entity(state.scene.locationId)?.data as { siteId?: string } | undefined)?.siteId
        : undefined);
    if (!here) return undefined;
    const name = (id: string) => this.d.canon.entity(id)?.name ?? id;
    const roads = state.edges
      .filter((e) => e.type === "routeTo" && (e.from === here || e.to === here))
      .map((e) => {
        const to = e.from === here ? e.to : e.from;
        const d = (e.data ?? {}) as { days?: number; terrain?: string; danger?: number };
        return `${name(to)} [${to}] (${d.days ?? 1} days by ${d.terrain ?? "road"}, danger ${d.danger ?? 1}/5)`;
      });
    const lines = [`You are at ${name(here)} [${here}].`];
    if (journey)
      lines.push(
        `On the road to ${name(journey.toSiteId)} [${journey.toSiteId}]; travelling again continues the journey.`,
      );
    if (roads.length) lines.push(`Roads (travel { toSiteId, pace }): ${roads.join("; ")}.`);
    return lines.join("\n");
  }

  /** The fight as text for the parser and narrator: order, AP, who's where and engaged, legal actions. */
  private combatText(state: GameState): string | undefined {
    const pcId = state.party.pcId;
    if (!state.combat || !pcId) return undefined;
    const v = combatView(state, actingActor(state) ?? pcId, this.turnCtx(state));
    if (!v) return undefined;
    const lines = [
      `Round ${v.round}. ${v.yourTurn ? `It's the player's turn: ${v.ap.current} AP left.` : "Not the player's turn yet."}`,
    ];
    for (const c of v.combatants) {
      const engaged = c.engagedWith.length
        ? `, engaged with ${c.engagedWith.map((id) => `[${id}]`).join(", ")}`
        : "";
      lines.push(`- [${c.id}] ${c.name} (${c.side}) in [${c.zoneId}]: ${c.condition}${engaged}`);
    }
    lines.push(
      "Called shots (calledLocation) on humanoids: head, torso, right-arm, left-arm, right-leg, left-leg.",
    );
    const legal = v.actions.filter((a) => a.legal);
    if (legal.length) lines.push(`Legal now: ${legal.map((a) => `${a.label} (${a.ap} AP)`).join("; ")}.`);
    return lines.join("\n");
  }

  private prompt(
    role: AssemblerRole,
    state: GameState,
    turn: Parameters<typeof assemble>[0]["turn"],
  ): AssembledPrompt {
    const combat = this.combatText(state);
    const travel = role === "parser" && !state.combat ? this.travelText(state) : undefined;
    return assemble({
      role,
      state,
      canon: this.d.canon,
      rules: this.d.rules,
      stable: {
        roleInstructions: ROLE_INSTRUCTIONS[role],
        rulesDigest: state.combat ? COMBAT_RULES_DIGEST : EXPLORATION_RULES_DIGEST,
        tone: this.d.tone,
        worldBible: this.d.worldBible,
      },
      turn: { ...turn, ...(combat ? { combat } : {}), ...(travel ? { travel } : {}) },
    });
  }

  async run(t: TurnInput): Promise<TurnResult> {
    if (this.busy) throw new Error("A turn is already running for this campaign");
    this.busy = true;
    try {
      return await this.runInner(t);
    } finally {
      this.busy = false;
    }
  }

  private async runInner(t: TurnInput): Promise<TurnResult> {
    const emit = t.onEvent ?? (() => {});
    const turnId = this.d.newId();
    emit({ type: "turn.accepted", turnId });
    let state = this.d.store.state();
    const pcId = state.party.pcId;
    if (!pcId) throw new Error("The campaign has no player character");
    let ctx = this.turnCtx(state);
    const mode = state.combat ? "combat" : "exploration";
    const call = { campaignId: this.d.campaignId, turnId };
    const started = draft("TurnStarted", { input: t.input }, "player");

    // ── Parse, validate, repair ────────────────────────────────────────────
    let plan: { actorId: string; actions: ActionInput[]; intent: string } | null = null;
    let repairs = 0;
    let lastErrors: TurnPlanError[] = [];

    // In a fight, a manually controlled companion's turn takes the player's input (spec 04).
    const acting = actingActor(state) ?? pcId;
    if (t.actions) {
      plan = { actorId: acting, actions: t.actions, intent: t.input };
    } else {
      const parserPrompt = this.prompt("parser", state, { input: t.input });
      const messages: Message[] = [{ role: "user", content: parserPrompt.context }];
      for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
        let completion: Awaited<ReturnType<RoleRouter["complete"]>>;
        try {
          completion = await this.d.router.complete(
            "parser",
            {
              instructions: parserPrompt.instructions,
              messages,
              tools: parserTools(mode),
              toolChoice: "required",
            },
            { promptVersion: PARSER_VERSION, ...call },
          );
        } catch (e) {
          return this.failed(turnId, started, e, emit, repairs);
        }
        const tc = completion.toolCalls[0];
        const reply = (content: string) => {
          messages.push({
            role: "assistant",
            content: completion.text,
            ...(tc ? { toolCalls: [tc] } : {}),
            ...(completion.raw ? { raw: completion.raw } : {}),
          });
          messages.push(
            tc ? { role: "tool", toolCallId: tc.id, name: tc.name, content } : { role: "user", content },
          );
        };

        if (!tc) {
          if (attempt < MAX_REPAIRS) {
            repairs++;
            reply("Reply with exactly one tool call: propose_actions, ask_clarification or answer_ooc.");
            continue;
          }
          break;
        }
        if (tc.name === "ask_clarification") {
          const parsed = (mode === "combat" ? AskCombatClarification : AskClarification).safeParse(tc.args);
          if (parsed.success) return this.clarify(turnId, started, parsed.data, ctx, state, emit, repairs);
        } else if (tc.name === "answer_ooc") {
          const parsed = AnswerOoc.safeParse(tc.args);
          if (parsed.success) return this.ooc(turnId, started, parsed.data.question, state, emit, repairs);
        } else if (tc.name === "propose_actions") {
          const parsed = (mode === "combat" ? ProposeCombatActions : ProposeActions).safeParse(tc.args);
          if (parsed.success) {
            const actorId = parsed.data.actorId ?? acting;
            const v = validateTurn(state, actorId, parsed.data.actions, ctx);
            if (v.ok) {
              plan = { actorId, actions: parsed.data.actions, intent: parsed.data.intent };
              break;
            }
            lastErrors = v.planErrors ?? [];
            if (attempt < MAX_REPAIRS) {
              repairs++;
              reply(
                JSON.stringify({
                  rejected: true,
                  errors: (v.planErrors ?? v.errors).map((e) => ({ ...e })),
                  instruction:
                    "Fix the plan using the errors and legal alternatives, then call a tool again.",
                }),
              );
              continue;
            }
            break;
          }
          if (attempt < MAX_REPAIRS) {
            repairs++;
            reply(
              JSON.stringify({
                rejected: true,
                errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
              }),
            );
            continue;
          }
          break;
        }
        if (attempt < MAX_REPAIRS) {
          repairs++;
          reply(
            `Unknown or malformed tool call "${tc.name}". Use propose_actions, ask_clarification or answer_ooc.`,
          );
        }
      }
      if (!plan) return this.clarifyFromErrors(turnId, started, lastErrors, ctx, state, emit, repairs);
    }

    // Lazy generation commits new canon first; the turn then resolves against it.
    try {
      if (await this.prepareWorld(plan.actions, turnId)) {
        state = this.d.store.state();
        ctx = this.turnCtx(state);
      }
    } catch (e) {
      return this.failed(turnId, started, e, emit, repairs);
    }

    // A clicked option's actions still go through validation.
    const validated = validateTurn(state, plan.actorId, plan.actions, ctx);
    if (!validated.ok)
      return this.clarifyFromErrors(turnId, started, validated.planErrors ?? [], ctx, state, emit, repairs);

    // ── Resolve ────────────────────────────────────────────────────────────
    const resolved = resolveTurn(state, validated.value, ctx, this.d.newId());
    if (!resolved.ok)
      return this.failed(
        turnId,
        started,
        new Error(resolved.errors[0]?.message ?? "resolve failed"),
        emit,
        repairs,
      );
    const { events: ruleEvents, resolution } = resolved.value;
    const mechanics = resolution.steps.flatMap((s) => (s.mechanics ? [s.mechanics] : []));
    for (const line of mechanics) emit({ type: "mechanics.line", line });

    // ── Narrate and guard ──────────────────────────────────────────────────
    // In a fight the narrator and guard see the state after it (who's down, who's new to the scene).
    const narrState = resolution.combat ? afterEvents(state, ruleEvents) : state;
    const voiced = await this.voice(narrState, t.input, resolution, call, emit);
    const canonDrafts = this.canonFromGuard(narrState, voiced.report);
    canonDrafts.push(...this.afterGuard(state, ruleEvents, canonDrafts, voiced.report, ctx));

    const completed = draft("TurnCompleted", {
      status: "resolved",
      intent: plan.intent,
      plan: validated.value.actions,
      mechanics,
      resolution,
    });
    this.d.store.append(
      [started, ...ruleEvents, ...canonDrafts, completed, draft("NarrationCommitted", voiced.narration)],
      { turnId },
    );
    emit({ type: "narration.final", text: voiced.narration.text, turnId });
    if (voiced.narration.guard.flagged.length)
      emit({ type: "guard.flag", flags: voiced.narration.guard.flagged });
    emit({ type: "turn.completed", turnId });
    return {
      turnId,
      status: "resolved",
      narration: voiced.narration.text,
      mechanics,
      guard: voiced.narration.guard,
      repairs,
    };
  }

  /**
   * Narrator then guard. A blocking report regenerates once with corrective notes; if the second
   * draft still blocks, it's kept and flagged for the player. Narration failure falls back to the
   * mechanical summary; guard failure shows the passage unchecked.
   */
  private async voice(
    state: GameState,
    input: string,
    resolution: Resolution,
    call: { campaignId?: string | undefined; turnId: string },
    emit: (e: TurnStreamEvent) => void,
    excludeTurnId?: string,
  ) {
    const maxChars = MAX_CHARS[state.campaign.settings.narration.length];
    const showFirst = state.campaign.settings.narration.canonCheck === "afterShowing";
    const narrate = async (corrections?: string[]) => {
      const p = this.prompt("narrator", state, {
        input,
        resolution,
        ...(corrections ? { corrections } : {}),
        ...(excludeTurnId ? { excludeTurnId } : {}),
      });
      return this.d.router.complete(
        "narrator",
        { instructions: p.instructions, messages: [{ role: "user", content: p.context }] },
        {
          promptVersion: NARRATOR_VERSION,
          maxChars,
          ...call,
          ...(showFirst ? { onText: (delta: string) => emit({ type: "narration.delta", delta }) } : {}),
        },
      );
    };
    const check = async (text: string): Promise<GuardReportV1 | null> => {
      const p = this.prompt("guard", state, { input, resolution, draft: text });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const c = await this.d.router.complete(
            "guard",
            {
              instructions: p.instructions,
              messages: [{ role: "user", content: p.context }],
              tools: [GUARD_TOOL],
              toolChoice: { name: GUARD_TOOL.name },
            },
            { promptVersion: GUARD_VERSION, ...call },
          );
          const parsed = GuardReportV1.safeParse(c.toolCalls[0]?.args);
          if (parsed.success) return parsed.data;
        } catch {
          return null;
        }
      }
      return null;
    };

    let first: Awaited<ReturnType<typeof narrate>>;
    try {
      first = await narrate();
    } catch (e) {
      emit({ type: "error", message: `Narration failed: ${(e as Error).message}`, retryable: true });
      return {
        report: null,
        narration: {
          text: mechanicalSummary(resolution),
          provider: "engine",
          model: "mechanical",
          promptVersion: NARRATOR_VERSION,
          fallback: true,
          guard: { checked: false, regenerated: false, flagged: [] },
        },
      };
    }

    let final = first;
    let report = await check(first.text);
    let regenerated = false;
    let flagged: GuardSummary["flagged"] = [];
    if (report && blockingIssues(report).length) {
      const issues = blockingIssues(report);
      regenerated = true;
      try {
        final = await narrate(
          issues.map((i) => `"${i.quote}" is wrong: ${i.detail}. Narrate only what the engine resolved.`),
        );
        report = await check(final.text);
        flagged = report ? blockingIssues(report) : [];
      } catch {
        // Keep the first draft, flagged.
        flagged = issues;
      }
    }
    return {
      report,
      narration: {
        text: final.text.trim(),
        provider: final.provider,
        model: final.model,
        promptVersion: NARRATOR_VERSION,
        fallback: false,
        guard: { checked: report !== null, regenerated, flagged },
      },
    };
  }

  /**
   * What the guard's report changes after the rules (spec 04): XP for quest stages it confirmed, and
   * companions' approval for what they witnessed, with any threshold that crosses.
   */
  private afterGuard(
    state: GameState,
    ruleEvents: EventDraft[],
    canonDrafts: EventDraft[],
    report: GuardReportV1 | null,
    ctx: TurnContext,
  ): EventDraft[] {
    const ruled = afterEvents(state, ruleEvents);
    const guarded = afterEvents(ruled, canonDrafts);
    const xp = turnAwards(ruled, guarded, canonDrafts, ctx.kindOf ?? (() => undefined), ctx.tuning);
    const approvals = report?.approvalDeltas.length
      ? approvalEvents(afterEvents(guarded, xp), report.approvalDeltas, ctx.nameOf, ctx.tuning)
      : [];
    return [...xp, ...approvals];
  }

  /** New named entities become canon stubs at the current location; new facts attach to known entities. */
  private canonFromGuard(state: GameState, report: GuardReportV1 | null): EventDraft[] {
    if (!report) return [];
    const drafts: EventDraft[] = [];
    // Witnesses (spec 07): only people actually present get the memory.
    const present = new Set(Object.keys(state.scene?.positions ?? {}));
    report.witnessObservations.forEach((w, i) => {
      for (const id of w.witnessIds) {
        if (!present.has(id) || id === state.party.pcId || state.actors[id]?.dead) continue;
        drafts.push(
          draft(
            "MemoryRecorded",
            {
              memory: {
                id: `mem:${id}:${state.campaign.gameTime}:g${i}`,
                npcId: id,
                gameTime: state.campaign.gameTime,
                kind: "witnessed",
                content: w.content,
                about: state.party.pcId ? [state.party.pcId] : [],
                importance: w.importance,
                feeling: w.feeling,
                belief: 1,
              },
            },
            "model",
          ),
        );
      }
    });
    // Narrative objectives (spec 06): accepted only for an active quest's current narrative objective.
    for (const m of report.objectiveMet) {
      const q = state.quests?.[m.questId];
      const objective = q?.stages[q.stage]?.objectives[m.objectiveIndex];
      if (
        q?.status === "active" &&
        objective?.kind === "narrative" &&
        !q.stages[q.stage]!.met[m.objectiveIndex]
      )
        drafts.push(
          draft(
            "QuestObjectiveMet",
            { questId: q.id, stage: q.stage, objective: m.objectiveIndex, evidence: m.evidence },
            "model",
          ),
        );
    }
    const scene = state.scene;
    const actorNames = new Set(Object.values(state.actors).map((a) => a.sheet.identity.name.toLowerCase()));
    const seen = new Set<string>();
    for (const e of report.newEntities) {
      const key = e.name.trim().toLowerCase();
      if (seen.has(key) || actorNames.has(key) || this.d.canon.findByName(e.name).length) continue;
      seen.add(key);
      const entity = Entity.parse({
        id: `${e.kind}:${slug(e.name)}-${this.d.newId().slice(-6).toLowerCase()}`,
        kind: e.kind,
        name: e.name.trim(),
        detail: "stub",
        summary: e.description,
        importance: 1,
      });
      drafts.push(
        draft(
          "EntityCreated",
          {
            entity,
            ...(scene && e.kind !== "location" && e.kind !== "region"
              ? { at: { locationId: scene.locationId } }
              : {}),
          },
          "model",
        ),
      );
    }
    for (const f of report.newFacts) {
      if (!this.d.canon.entity(f.entityId) && !state.actors[f.entityId]) continue;
      drafts.push(
        draft(
          "FactAsserted",
          {
            fact: Fact.parse({
              id: `fact:${this.d.newId().toLowerCase()}`,
              entityId: f.entityId,
              predicate: f.predicate,
              value: f.value,
              source: "model",
              evidence: { eventIds: [], quote: f.quote },
            }),
          },
          "model",
        ),
      );
    }
    return drafts;
  }

  private clarify(
    turnId: string,
    started: EventDraft,
    c: {
      question: string;
      options: Array<{ label: string; actions?: ActionInput[] | undefined }>;
    },
    ctx: TurnContext,
    state: GameState,
    emit: (e: TurnStreamEvent) => void,
    repairs: number,
  ): TurnResult {
    // Options whose actions the engine rejects keep their label but lose the actions (they become free text).
    const pcId = state.party.pcId!;
    const clarification: Clarification = {
      question: c.question,
      options: c.options.map((o) =>
        o.actions && validateTurn(state, pcId, o.actions, ctx).ok
          ? { label: o.label, actions: o.actions }
          : { label: o.label },
      ),
    };
    this.d.store.append(
      [started, draft("TurnCompleted", { status: "clarify", clarification, plan: [], mechanics: [] })],
      { turnId },
    );
    emit({ type: "clarify", clarification });
    emit({ type: "turn.completed", turnId });
    return { turnId, status: "clarify", clarification, mechanics: [], repairs };
  }

  /** After failed repairs: a clarification card built from the engine's legal alternatives. */
  private clarifyFromErrors(
    turnId: string,
    started: EventDraft,
    errors: TurnPlanError[],
    ctx: TurnContext,
    state: GameState,
    emit: (e: TurnStreamEvent) => void,
    repairs: number,
  ): TurnResult {
    const alternatives = errors.flatMap((e) => (e.legalAlternatives ?? []) as ActionInput[]);
    const fallback: ActionInput[] = state.combat
      ? [{ type: "defend" }, { type: "endTurn" }]
      : [
          { type: "examine", area: "the surroundings" },
          { type: "wait", minutes: 10 },
        ];
    const options = [...alternatives, ...fallback]
      .filter((a, i, all) => all.findIndex((b) => JSON.stringify(b) === JSON.stringify(a)) === i)
      .slice(0, 4)
      .map((a) => ({ label: describeAction(a, ctx.nameOf), actions: [a] }));
    const reason = errors[0]?.message;
    return this.clarify(
      turnId,
      started,
      {
        question: reason
          ? `I couldn't do that: ${reason}. What would you like to do?`
          : "I didn't catch that. What would you like to do?",
        options,
      },
      ctx,
      state,
      emit,
      repairs,
    );
  }

  private async ooc(
    turnId: string,
    started: EventDraft,
    question: string,
    state: GameState,
    emit: (e: TurnStreamEvent) => void,
    repairs: number,
  ): Promise<TurnResult> {
    const p = assemble({
      role: "parser",
      state,
      canon: this.d.canon,
      rules: this.d.rules,
      stable: {
        roleInstructions: OOC_INSTRUCTIONS,
        rulesDigest: EXPLORATION_RULES_DIGEST,
        tone: "",
        worldBible: this.d.worldBible,
      },
      turn: { input: question },
    });
    let answer: string;
    try {
      const c = await this.d.router.complete(
        "parser",
        { instructions: p.instructions, messages: [{ role: "user", content: p.context }] },
        {
          promptVersion: OOC_VERSION,
          turnId,
          ...(this.d.campaignId ? { campaignId: this.d.campaignId } : {}),
        },
      );
      answer = c.text.trim();
    } catch (e) {
      return this.failed(turnId, started, e, emit, repairs);
    }
    this.d.store.append(
      [started, draft("TurnCompleted", { status: "ooc", answer, plan: [], mechanics: [] })],
      { turnId },
    );
    emit({ type: "turn.completed", turnId });
    return { turnId, status: "ooc", answer, mechanics: [], repairs };
  }

  private failed(
    turnId: string,
    started: EventDraft,
    e: unknown,
    emit: (e: TurnStreamEvent) => void,
    repairs: number,
  ): TurnResult {
    const message = e instanceof ProviderError ? `${e.code}: ${e.message}` : (e as Error).message;
    // Nothing was resolved, so nothing changes; the record keeps the input for the journal.
    this.d.store.append(
      [started, draft("TurnCompleted", { status: "failed", answer: message, plan: [], mechanics: [] })],
      { turnId },
    );
    emit({ type: "error", message, retryable: e instanceof ProviderError ? e.retryable : false });
    emit({ type: "turn.completed", turnId });
    return { turnId, status: "failed", mechanics: [], repairs, error: message };
  }

  /**
   * Reroll narration (spec 08): same resolution and context, new prose; dice never change.
   * Emits NarrationRerolled and reruns the guard. Allowed in hardcore.
   */
  async reroll(turnId: string, onEvent?: (e: TurnStreamEvent) => void): Promise<TurnResult> {
    if (this.busy) throw new Error("A turn is already running for this campaign");
    this.busy = true;
    try {
      const emit = onEvent ?? (() => {});
      const turn = this.d.canon.turn(turnId);
      const record = turn?.record as {
        status?: string;
        resolution?: Resolution;
        mechanics?: MechanicsLine[];
      } | null;
      if (!turn || record?.status !== "resolved" || !record.resolution) {
        throw new Error(`Turn ${turnId} has no resolved narration to reroll`);
      }
      const before = this.d.store.state(this.d.store.activeBranchId, turn.startedSeq - 1);
      const call = { campaignId: this.d.campaignId, turnId };
      const voiced = await this.voice(before, turn.input, record.resolution, call, emit, turnId);
      this.d.store.append(
        [...this.canonFromGuard(before, voiced.report), draft("NarrationRerolled", voiced.narration)],
        {
          turnId,
        },
      );
      emit({ type: "narration.final", text: voiced.narration.text, turnId });
      if (voiced.narration.guard.flagged.length)
        emit({ type: "guard.flag", flags: voiced.narration.guard.flagged });
      emit({ type: "turn.completed", turnId });
      return {
        turnId,
        status: "resolved",
        narration: voiced.narration.text,
        mechanics: record.mechanics ?? [],
        guard: voiced.narration.guard,
        repairs: 0,
      };
    } finally {
      this.busy = false;
    }
  }
}

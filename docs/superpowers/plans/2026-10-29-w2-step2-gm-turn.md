# Wyrd 2.0 — Step 2: the GM-with-tools turn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One GM model runs each turn, streaming prose and calling engine tools for dice and state. Cards, choices, retcons with Undo, a non-blocking structural check, and a backup-model badge replace the parser → narrator → guard assembly line for new turns.

**Architecture:**
- `TurnPipeline.run` delegates to a new `runGmTurn` whenever the router has a `gm` route; otherwise the classic pipeline runs unchanged.
- The loop calls `router.complete("gm", …)` repeatedly and executes each tool call against a **working state** (the turn's drafts folded onto a copy). It feeds tool results back as `role:"tool"` messages and, as today, appends everything once at the end.
- `act` and `roll` wrap the existing `validateTurn` / `resolveTurn`, so exploration, travel, combat, scene reactions and world ticks are reused, not rewritten.
- `change_state` and `retcon` map to existing events plus three new ones: `ItemDefined`, `RetconApplied` and `RetconUndone`.

**Tech Stack:** Bun, TypeScript, zod 4, Hono SSE, React, `bun test`, FakeProvider.

**Spec:** `docs/superpowers/specs/2026-10-29-wyrd-2-design.md` §5 (and §3 for the changed invariant).

## Global Constraints

- The engine stays pure. New engine code takes `state` and returns `EventDraft[]` (or `Result`), with no IO.
- Every state change is an event. Cards, choices and the tool log are **turn records** inside `TurnCompleted`'s payload, not game state.
- New tuning goes in `packages/core/src/tuning.ts`: `gm: { maxToolRounds: 8, contextTokens: 32000, checkTimeoutMs: 20000 }`. Role timeouts go in `ROLE_TIMEOUTS_MS`: `gm: 90_000`, `check: 20_000`.
- Prompt versions: `gm@1`, `check@1`. Every prompt change bumps the version.
- Knowledge layers: `observe` and `lookup_lore` return only entities and facts the PC knows or perceives (public facts of known entities). Secret facts never reach the GM prompt or the browser. The ∞ perception scope arrives with Levels in step 3.
- Copy the user sees, exactly:
  - backup badge `backup model`
  - check flag `Possible unrecorded change`
  - check flag buttons `Fix` and `Dismiss`
  - retcon card title `Retcon`
  - retcon card button `Undo`
- FakeProvider emits one tool call or one text per reply. Multi-round tests use a `reply` function that inspects `req.messages` for `role:"tool"` messages.
- `bun run check` is green at every commit. Classic-pipeline tests keep passing.

## Review Focus

1. **The GM calls tools forever.** Expect at most `maxToolRounds` (8) tool rounds, then one forced no-tools round, and a turn that still completes (Task 6 `caps tool rounds`).
2. **The GM model is unavailable mid-turn** (usage limit on round 3). Expect the router to fall back for that call, the passage to carry `backup: true`, and nothing to be lost from the earlier rounds (Task 6 `marks backup model`).
3. **A tool call references an id that doesn't exist** (a wrong item or entity). Expect that change rejected with a reason in the tool result, the others in the same call applied, and no exception (Task 3 `rejects unknown ids per change`).
4. **Undo after the player has already taken another turn.** Expect `409` with `Undo is only available until your next turn`, and state unchanged (Task 8 `undo refuses after the next turn`).
5. **Prose with zero tool calls that claims a change** ("you pocket the ring"). Expect the turn to commit with no item change and a check flag shown, never a silent rewrite (Task 7 `flags an unrecorded claim`).

---

### Task 1: GM and check roles

**Files:**
- Modify: `packages/core/src/schemas/usage.ts:4`. Add `"gm"` and `"check"` to the `Role` enum.
- Modify: `packages/llm/src/router.ts`. Add `ROLE_TIMEOUTS_MS` (:12) entries `gm: 90_000, check: 20_000`. In `presetRouting` (:~225), `gm` joins `PROSE_ROLES` (plan → deepseek → anthropic) and `check` follows the parser's chain.
- Modify: `apps/web/src/ModelSettings.tsx` (~:300-400). Add rows for `gm` and `check` with the labels `Game master` and `Consistency check`.
- Modify: `packages/core/src/tuning.ts`. Add the `gm` block from Global Constraints.
- Test: `packages/llm/test/router.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `balanced routes gm to the plan first`: `presetRouting("balanced", models).gm.provider === models.plan.provider`, with a deepseek fallback.
  - `balanced routes check like the parser`: `presetRouting("balanced", models).check` deep-equals the parser route.
  - `single routes gm and check`: both exist under `single`.
- [ ] **Step 2:** Run `bun test packages/llm/test/router.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the changes. TypeScript then flags every `Record<Role, …>`; fill each in (usage pricing maps etc.) with the value the parser uses for `check` and the narrator uses for `gm`.
- [ ] **Step 4:** Run `bun run check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(llm): gm and check roles`.

### Task 2: GM schemas, turn record and new events

**Files:**
- Create: `packages/core/src/schemas/gm.ts`. Tool arguments, cards, choices and the turn record (below).
- Create: `packages/core/src/schemas/domains/gm.ts`. The event payload map `gmEventSchemas`: `ItemDefined {itemId: ContentId /^campaign:[a-z0-9-]+$/, def: GearDef}`, `RetconApplied {retconId, turnId, summary, inverse: EventDraft[]}` and `RetconUndone {retconId}`.
- Modify: `packages/core/src/schemas/events.ts:21`. Spread `gmEventSchemas`.
- Create: `packages/engine/src/reduce/gm.ts`. Handlers:
  - `ItemDefined` stores `state.customItems[itemId] = def`. Add `customItems: Record<string, GearDef>` (default `{}`) to `GameState`.
  - `RetconApplied` pushes `{retconId, turnId, undone:false}` onto `state.retcons`, a new array that defaults to `[]`.
  - `RetconUndone` marks that entry `undone: true`.

  Spread the handlers into `reduce.ts` and add the three types to `HANDLED_EVENT_TYPES` (:450).
- Create: `packages/engine/src/catalog.ts`. `export function catalogWith(state: GameState, items: ItemCatalog): ItemCatalog` returns `items` with `state.customItems` merged into `gear`. Replace direct `pack.items` / `ItemCatalog` reads in `packages/engine/src/inventory.ts` and in the inventory and shop parts of `apps/server/src/app.ts` with `catalogWith(state, pack.items)`.
- Modify: `packages/core/src/schemas/settings.ts`. Add `narration.choices: z.enum(["gm","always","onRequest"]).default("gm")`.
- Test: `packages/core/test/gm-schemas.test.ts`, `packages/engine/test/gm-reduce.test.ts`

**Interfaces (produced, `packages/core/src/schemas/gm.ts`):**
```ts
export const StateChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item.give"),  actorId: z.string(), itemId: z.string(), qty: z.number().int().min(1).default(1) }),
  z.object({ kind: z.literal("item.take"),  actorId: z.string(), itemId: z.string(), qty: z.number().int().min(1).default(1) }),
  z.object({ kind: z.literal("item.equip"), actorId: z.string(), itemId: z.string(), slot: z.enum(["main","off","worn"]) }),
  z.object({ kind: z.literal("item.define"), name: z.string().min(1).max(80), description: z.string().max(400).default(""), weightKg: z.number().min(0).default(0.5), price: z.number().int().min(0).default(0) }),
  z.object({ kind: z.literal("coins"),      actorId: z.string(), delta: z.number().int() }),
  z.object({ kind: z.literal("hp"),         actorId: z.string(), delta: z.number().int() }),
  z.object({ kind: z.literal("entity.create"), entity: z.object({ kind: EntityKind, name: z.string().min(1), summary: z.string().default("") }) }),
  z.object({ kind: z.literal("fact"),       entityId: z.string(), predicate: z.string().min(1), value: z.string() }),
  z.object({ kind: z.literal("quest.start"), title: z.string(), objectives: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("quest.objective"), questId: z.string(), objectiveIndex: z.number().int().min(0) }),
  z.object({ kind: z.literal("clock.advance"), clockId: z.string(), by: z.number().int().min(1) }),
  z.object({ kind: z.literal("xp"),         actorId: z.string(), amount: z.number().int().min(1) }),
]);
export const RollArgs = z.object({ actorId: z.string().optional(), skill: z.string(), difficulty: Difficulty, goal: z.string(), targetId: z.string().optional() });
export const ActArgs = z.object({ actorId: z.string().optional(), actions: z.array(z.unknown()).min(1) }); // ExplorationAction | CombatAction, validated by validateTurn
export const ChangeStateArgs = z.object({ changes: z.array(StateChange).min(1).max(20) });
export const RetconArgs = z.object({ summary: z.string().min(1).max(200), changes: z.array(StateChange).min(1).max(20) });
export const LookupArgs = z.object({ query: z.string().min(1) });
export const ObserveArgs = z.object({ targetId: z.string() });
export const TimeSkipArgs = z.object({ minutes: z.number().int().min(1).max(60 * 24 * 365), reason: z.string() });
export const Card = z.discriminatedUnion("type", [
  z.object({ type: z.literal("item"), itemId: z.string() }),
  z.object({ type: z.literal("character"), entityId: z.string() }),
  z.object({ type: z.literal("status"), actorId: z.string() }),
  z.object({ type: z.literal("chapter"), title: z.string().max(80), subtitle: z.string().max(120).default("") }),
  z.object({ type: z.literal("roll"), lineIndex: z.number().int().min(0) }),
  z.object({ type: z.literal("retcon"), retconId: z.string() }),
  z.object({ type: z.literal("report"), title: z.string().max(80), body: z.string().max(1200) }),
]);
export const ShowCardArgs = z.object({ cards: z.array(Card).min(1).max(4) });
export const Choice = z.object({ label: z.string().min(1).max(80), description: z.string().max(160).default("") });
export const OfferChoicesArgs = z.object({ choices: z.array(Choice).min(2).max(5) });
export const GmTurnRecord = z.object({
  cards: z.array(Card).default([]), choices: z.array(Choice).default([]),
  tools: z.array(z.object({ name: z.string(), ok: z.boolean(), note: z.string().default("") })).default([]),
  provider: z.string(), model: z.string(), backup: z.boolean().default(false), rounds: z.number().int(),
});
```
`TurnCompleted`'s payload gains `gm?: GmTurnRecord`.

- [ ] **Step 1: Write the failing tests.**
  - Schemas: `StateChange parses each kind`; `rejects an unknown kind`; `Card rejects model-authored layout` (`{type:"html"}` fails).
  - Reduce: `ItemDefined adds a custom item`; `RetconUndone marks the retcon`; `catalogWith merges custom items into gear`.
  - The existing test that checks `HANDLED_EVENT_TYPES` against the registry stays green.
- [ ] **Step 2:** Run `bun test packages/core/test/gm-schemas.test.ts packages/engine/test/gm-reduce.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the schemas, domain events, handlers, `catalogWith` with its call-site swap, and the settings field.
- [ ] **Step 4:** Run `bun run check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): GM tool schemas, cards, turn record and retcon events`, and add D149 to `docs/decisions.md` (*GM-invented items are `campaign:` GearDefs defined by `ItemDefined` and merged into the catalog by `catalogWith`*).

### Task 3: Applying and inverting state changes (engine)

**Files:**
- Create: `packages/engine/src/gm-changes.ts`
- Test: `packages/engine/test/gm-changes.test.ts`

**Interfaces:**
- Consumes: `StateChange` (Task 2), and the inventory helpers `addItem`, `removeItem` and `equipItem` from `packages/engine/src/inventory.ts`, together with `catalogWith`.
- Produces:
  ```ts
  export type ChangeOutcome = { index: number; ok: boolean; reason?: string; ids?: string[] };
  export function applyChanges(state: GameState, changes: StateChange[], ctx: { items: ItemCatalog; newId: () => string }):
    { drafts: EventDraft[]; outcomes: ChangeOutcome[]; inverse: EventDraft[] };
  ```
- Rules:
  - Each change is validated against `state`, folded with the drafts accepted so far. A failure rejects only that change, with a `reason`.
  - `item.define` returns `ids: ["campaign:<slug>"]` (using `slugify` from `packages/core/src/slug.ts`, step 1; on a clash with an existing id, append `-2`, `-3`…), so later changes in the same call can reference it.
  - The emitted events and their inverses:

    | Change | Event | Inverse |
    |---|---|---|
    | item give/take | `ItemTransferred` | the opposite transfer |
    | `coins` | `CoinsChanged` | the negated delta |
    | `hp` | `HpChanged` | the negated delta |
    | `entity.create` | `EntityCreated` (`detail: "stub"`) | `EntityUpdated {status: "retconned"}` |
    | `fact` | `FactAsserted` (`source: "model"`) | `FactRetracted` |
    | `quest.start` | `QuestStarted` | `QuestEnded {status: "retconned"}` |
    | `quest.objective` | `QuestObjectiveMet` | none; listed in outcomes as `irreversible` |
    | `clock.advance` | `ClockAdvanced` | `ClockAdvanced` with negative `by`, if the schema allows it; otherwise irreversible |
    | `xp` | `XpAwarded` | irreversible |
    | `item.define` | `ItemDefined` | none needed |

- [ ] **Step 1: Write the failing tests.**
  - `gives an item`: `item.give` of a catalog item gives an `ItemTransferred` with the qty, `ok: true`, and an inverse removing it.
  - `defines then gives in one call`: `[item.define "Yellow lantern ring", item.give campaign:yellow-lantern-ring]` gives both ok, in order.
  - `rejects unknown ids per change`: `[item.give "nope", coins +5]` gives outcome 0 `ok:false` with a reason containing `nope`, and outcome 1 ok with a `CoinsChanged`.
  - `cannot take what is not carried`: `item.take` qty 2 of a held qty 1 gives `ok:false`.
  - `inverse restores state`: folding `drafts` then `inverse` onto the state yields the same `inventory`, coins and hp as the original state. Use `fold` from `reduce.ts`.
- [ ] **Step 2:** Run `bun test packages/engine/test/gm-changes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `applyChanges` as one `switch` over `kind`, with a running folded state for validation.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): apply and invert GM state changes`.

### Task 4: Tool definitions and executor

**Files:**
- Create: `packages/llm/src/gm/tools.ts`
- Test: `packages/llm/test/gm-tools.test.ts`

**Interfaces:**
- Consumes:
  - `validateTurn` / `resolveTurn` (`packages/engine/src/turns.ts:28,50`)
  - `makeTurnContext` (`pipeline.ts:152`)
  - `applyChanges` (Task 3)
  - `CanonSource.findByName` / `factsAbout` (`packages/memory/src/assembler.ts:7`)
  - the schemas from Task 2
- Produces:
  ```ts
  export function gmToolDefs(o: { inCombat: boolean }): ToolDef[]; // roll, act, change_state, retcon, lookup_lore, observe, time_skip, show_card, offer_choices
  export type ToolEffects = { drafts: EventDraft[]; mechanics: MechanicsLine[]; cards: Card[]; choices: Choice[];
    retcon?: { retconId: string; summary: string; inverse: EventDraft[] }; progress?: { phase: "rolling"|"researching"|"simulating"; detail?: string } };
  export function executeTool(call: ToolCall, x: { state: GameState; pcId: string; ctx: TurnContext; canon: CanonSource; items: ItemCatalog; newId: () => string }):
    { result: string /* JSON returned to the model */; effects: ToolEffects; ok: boolean };
  ```
- Mapping:
  - `roll` → `act` with one `check` action `{skill, goal, proposedDifficulty: difficulty, reason: goal, targetId}`.
  - `act` → `validateTurn(state, actorId ?? pcId, actions, ctx)`, then `resolveTurn(...)`. Errors return `{ok:false, errors: planErrors}` to the model. On success, return the steps' `summary`, `outcome` and mechanics text.
  - `time_skip` (v1) → `act` with `wait {minutes}`, and `progress: {phase:"simulating", detail: reason}`. Step 3 replaces it with the full skip.
  - `change_state` → `applyChanges`.
  - `retcon` → `applyChanges` plus a `RetconApplied {retconId: newId(), turnId, summary, inverse}` draft and a `retcon` card.
  - `lookup_lore` → up to 5 known entities by `findByName`, each with its public facts; `progress: researching`.
  - `observe` → the entity (known only) plus its public facts and current location.
  - `show_card` and `offer_choices` → effects only, with result `{ok:true}`.
  - Invalid arguments return `{ok:false, errors: z.prettifyError(...)}`. The executor never throws.

- [ ] **Step 1: Write the failing tests**, with the pipeline-test campaign setup from `packages/llm/test/pipeline.test.ts`:
  - `roll resolves a check`: the effects include one mechanics line and a `CheckResolved` draft.
  - `act reports plan errors to the model`: an `interact` on an unknown target gives `ok:false` and a result JSON with `errors`.
  - `change_state defines and gives an item`.
  - `retcon emits RetconApplied with an inverse and a retcon card`.
  - `lookup_lore hides secret facts`: a secret fact on a known NPC is absent from the result.
  - `observe refuses unknown entities`: `ok:false`, result `not known`.
  - `bad args never throw`.
- [ ] **Step 2:** Run `bun test packages/llm/test/gm-tools.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `gmToolDefs` (via `z.toJSONSchema`, with a one-sentence `description` per tool) and `executeTool`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(llm): GM tool definitions and executor`.

### Task 5: GM prompt, house style and context

**Files:**
- Create: `packages/llm/src/prompts/gm.ts`. Exports `GM_INSTRUCTIONS` and `GM_VERSION = "gm@1"`.
- Create: `packages/llm/src/prompts/house-style.md`. A written description of the owner's ChatGPT GM voice, from `~/Downloads/chatgpt-rpg/findings.md`, in our own words with no transcript excerpts. It describes the mechanics as well as the prose:
  - chapter-style headings at scene changes
  - bold names
  - dialogue as name-led lines
  - sensory but brisk
  - every turn ending on momentum
  - choices at real forks
  - never refusing; "yes, and"
- Modify: `packages/memory/src/assembler.ts`:
  - `AssemblerRole` adds `"gm"`, with `ROLE_BUDGETS.gm = defaultTuning.gm.contextTokens` (32,000), `MIN_TURNS.gm = 6` and `MAX_TURNS.gm = 20`.
  - The `gm` role gets every narrator section plus a new per-turn section `6.5 Your state`: the PC's inventory with item ids, coins, HP, conditions, active quests with their ids, and companions with their ids.
- Modify: `packages/llm/src/pipeline.ts`. `ROLE_INSTRUCTIONS` (:~265) adds `gm`.
- Modify: `apps/server/src/app.ts`. Read `*.md` files from `WYRD_HOME/style/house/` at launch, if present, and pass them as `styleExamples: string[]` in `PipelineDeps`. Missing or unreadable files mean `[]`.
- Test: `packages/memory/test/assembler.test.ts`, `packages/llm/test/gm-prompt.test.ts`

**GM_INSTRUCTIONS must state** (one line each, in this order):
1. You are the game master. Write the story and call tools for every change of state and every uncertain outcome.
2. Never claim an item, wound, coin, fact or quest change that no tool made.
3. Roll with `roll` or `act` whenever the outcome is uncertain, and narrate the returned degree faithfully.
4. Player canon outranks every other fact.
5. A message starting `/gm`, or a clear correction, is a retcon: use `retcon`. Otherwise treat the message as an action in the world.
6. Never answer "ask your GM" or "I can't change that". Say "yes, and…" with consequences.
7. Answer questions about rules or state directly from Your state.
8. The choice policy is `{policy}`: `gm` means offer choices only at real decision points; `always` means every turn; `onRequest` means only when asked. "Give me choices" always works.
9. Length is `{length}`: guidance, not a limit.
10. Follow the house style.

`{policy}` and `{length}` are substituted from settings. The style examples, when present, are appended under `House style examples (imitate the voice, never the content):`.

- [ ] **Step 1: Write the failing tests.**
  - `gm context includes Your state with item ids`.
  - `gm budget is 32k`.
  - `instructions carry the choice policy and length` (render with `onRequest` / `long` and assert both words).
  - `style examples are appended when present`.
- [ ] **Step 2:** Run `bun test packages/memory/test/assembler.test.ts packages/llm/test/gm-prompt.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the prompt, `house-style.md`, the assembler role and section, and the style loading.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(llm): GM instructions, house style and context`.

### Task 6: The GM loop

**Files:**
- Create: `packages/llm/src/gm/loop.ts`
- Modify: `packages/llm/src/pipeline.ts`. `run(t)` (:~500) calls `runGmTurn` when `this.d.router` has a `gm` route (add `RoleRouter.has(role): boolean`). Otherwise it calls `runInner` as now.
- Modify: `packages/llm/src/pipeline.ts` `TurnStreamEvent` (:84). Add:
  - `progress {phase: "researching"|"rolling"|"simulating"|"writing", detail?: string}`
  - `card {card: Card}`
  - `choices {choices: Choice[]}`
  - `model.backup {provider: string}`
- Test: `packages/llm/test/gm-loop.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4 and 5; `RoleRouter.complete` (`router.ts:~100`); `fold` (engine `reduce.ts:538`).
- Produces: `export async function runGmTurn(d: PipelineDeps, t: TurnInput, x: { styleExamples: string[] }): Promise<TurnResult>`, with the same `TurnResult` as today and `status: "resolved"` (or `"failed"`).
- Algorithm (not determined by the tests):
  ```
  emit turn.accepted; working = state; drafts = [TurnStarted]
  messages = [user: assembled context + input]
  for round in 0..maxToolRounds:
    c = router.complete("gm", {instructions, messages, tools: round < maxToolRounds ? gmToolDefs(...) : undefined, toolChoice: "auto"},
                        {promptVersion: GM_VERSION, turnId, onText: d => emit narration.delta, timeoutMs: ROLE_TIMEOUTS_MS.gm})
    text += c.text; backup ||= c.target is not the gm route's primary  (emit model.backup once)
    if no c.toolCalls: break
    messages += assistant{content: c.text, toolCalls, raw}
    for call in c.toolCalls:
      r = executeTool(call, {state: working, ...}); drafts += r.effects.drafts; working = fold(r.effects.drafts as envelopes, working)
      emit progress / mechanics.line / card / choices as effects say
      messages += tool{toolCallId: call.id, name: call.name, content: r.result}
  if the last round still called tools: one more complete() with tools undefined to finish the prose
  drafts += TurnCompleted{status:"resolved", gm: GmTurnRecord, mechanics, ...}, NarrationCommitted{text}
  store.append(drafts, {turnId}); emit narration.final, turn.completed
  ```
- Rules:
  - An input starting with `/gm` has the prefix stripped, and the line `GM MODE: carry this out with the retcon tool.` is added to the user message.
  - If the very first `complete` throws after the router's fallbacks, fall back to `runInner(t)` (classic) and emit `fallback {message: "The game master is unavailable; using the classic pipeline for this turn."}`.
  - An error in a later round keeps the rounds so far, finishes with the text collected and marks `gm.backup = true`.

- [ ] **Step 1: Write the failing tests**, with a `reply` function keyed on how many `role:"tool"` messages `req.messages` holds:
  - `narrates without tools`: one text reply gives `status: "resolved"`, `NarrationCommitted` with the text, and stream order `turn.accepted, narration.delta, narration.final, turn.completed`.
  - `rolls then narrates`: round 0 replies with a `roll` tool call, round 1 with text. The events include `CheckResolved` before `TurnCompleted`, and `TurnResult.mechanics.length === 1`.
  - `uses working state between rounds`: round 0 `change_state` defines and gives a ring, round 1 `change_state` equips `campaign:yellow-lantern-ring`. Both are ok (the second sees the first).
  - `caps tool rounds`: the fake always returns a tool call. Exactly `maxToolRounds + 1` gm requests are made, and the last has no `tools`. The turn resolves.
  - `marks backup model`: route gm to `fake-plan` with fallback `fake-ds`, and have `fake-plan` reply `{error:{code:"usage_limit"}}`. Then `TurnCompleted.gm.backup === true` and `model.backup` is emitted.
  - `gm prefix forces retcon mode`: input `/gm make my lantern a yellow lantern ring`. The first request's user message contains `GM MODE` and doesn't contain `/gm`.
  - `falls back to classic when gm is down`: gm errors on every target, and the parser/narrator rules answer. The turn resolves via the classic pipeline and `fallback` is emitted.
  - `classic still runs without a gm route`: the existing pipeline tests pass unchanged.
- [ ] **Step 2:** Run `bun test packages/llm/test/gm-loop.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `runGmTurn`, `RoleRouter.has` and the stream-event additions. `RoutedCompletion` must expose the target used. If it doesn't, add `target: Target` to it in `router.ts`.
- [ ] **Step 4:** Run `bun test packages/llm`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(llm): the GM-with-tools turn loop`.

### Task 7: Structural check (never rewrites)

**Files:**
- Create: `packages/llm/src/gm/check.ts`
- Modify: `packages/core/src/schemas/domains/gm.ts` (from Task 2). Add the event `CheckReported {turnId, flags: {quote: string, claim: string}[], recorded: string[]}` with a no-op reducer, registered like Task 2's events.
- Modify: `packages/llm/src/gm/loop.ts`. After `store.append`, start `checkTurn(...)` without awaiting it before `turn.completed`. When it resolves, append `CheckReported` plus `EntityCreated` stubs for unrecorded named entities, and emit `check.flag {turnId, flags}` on the job stream, if it's still open.
- Test: `packages/llm/test/gm-check.test.ts`

**Interfaces:**
- Produces: `export async function checkTurn(router: RoleRouter, o: { prose: string; drafts: EventDraft[]; known: string[]; turnId: string }): Promise<{ flags: {quote: string; claim: string}[]; entities: {name: string; kind: EntityKind}[] }>`. Role `check`, tool `report_unrecorded`, schema `{claims: {quote, claim}[], entities: {name, kind}[]}`, via `proposeStructured` (step 1, Task 1). Timeout `tuning.gm.checkTimeoutMs`. On any failure, return empty results; the check never blocks or fails a turn.
- The prompt gives the model the prose plus a plain list of the committed changes (rendered from the drafts) and the known entity names. It asks only for claims of changed state with no matching change, and for named entities not in the known list.

- [ ] **Step 1: Write the failing tests.**
  - `flags an unrecorded claim`: prose "You pocket the ring." with no drafts, and the fake check reply returns that claim. The result has one flag with that quote, and the turn's `NarrationCommitted` text is unchanged.
  - `records new named entities as stubs`: the loop test appends an `EntityCreated` `detail:"stub"` for the reported name.
  - `check failure is silent`: the check role errors, the result is empty, and the turn is already resolved.
- [ ] **Step 2:** Run `bun test packages/llm/test/gm-check.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `checkTurn`, the event and the loop hook.
- [ ] **Step 4:** Run `bun test packages/llm`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(llm): non-blocking structural check for GM turns`.

### Task 8: Server and web wiring: streaming, cards, choices, Undo, Fix

**Files:**
- Modify: `packages/core/src/schemas/web.ts`:
  - `WebStreamEvent` (:238) adds `progress`, `card`, `choices`, `model.backup` and `check.flag`.
  - `WebTurn` (:81) adds `cards: Card[]`, `choices: Choice[]`, `backup: boolean`, `checkFlags: {quote, claim}[]` and `retcon?: {retconId, summary, undone: boolean, undoable: boolean}`.
- Modify: `apps/server/src/app.ts`:
  - The view builder (~:800-850) fills these from `TurnCompleted.gm`, `CheckReported` and `state.retcons`. `undoable` is true only for the latest turn's retcon, if it isn't undone.
  - The suggestions (:835) come from the latest GM turn's `choices` when the campaign has GM turns, otherwise the current behaviour.
  - New routes:
    - `POST /api/campaigns/:id/retcons/:retconId/undo` appends the stored `inverse` plus `RetconUndone`, and returns the new view. It returns `409 {error: "Undo is only available until your next turn"}` when a later `TurnStarted` exists or the retcon is already undone.
    - `POST /api/campaigns/:id/turns/:turnId/fix` queues a GM turn whose input is `Reconcile the story with the recorded state for these claims: <claims>` (status 202 like `/turns`).
- Modify: `apps/web/src/use-play.ts`:
  - accumulate `narration.delta` into a live passage
  - keep the latest `progress` as a status line
  - collect `card`, `choices` and `check.flag` events
  - on `turn.completed`, refresh as now
- Create: `apps/web/src/Cards.tsx`. Functional renderers for each `Card` type, bound to `GameView` data by id: an item from inventory or catalog, a character from `known`, status from `pc`, a roll from the passage's mechanics line. They use existing CSS classes; UI 2.0 restyles them.
- Modify: `apps/web/src/Passage.tsx`:
  - render the cards
  - render choices as numbered buttons (1–9 key shortcuts; clicking sends the label as the input)
  - render the `backup model` badge
  - render check flags with `Fix` and `Dismiss` buttons. Dismissed flags are remembered per turn in `localStorage`, inside try/catch.
  - render the retcon card with `Undo` when `undoable`
- Test: `apps/server/test/gm-turns.test.ts`, `apps/web/test/` (component test if the existing setup supports it; otherwise covered by server tests plus `bun run typecheck`)

- [ ] **Step 1: Write the failing server tests.** Use a `createApp` router with a `gm` route on FakeProvider.
  - `gm turn streams deltas and completes`: POST `/turns`, read `/stream`. It contains `narration.delta` and `turn.completed`, and `/view`'s last turn has its `cards` and `choices`.
  - `choices become suggestions`.
  - `undo restores state`: a retcon gives a ring; POST undo returns 200, and the view no longer lists the ring.
  - `undo refuses after the next turn`: a retcon, then another turn, then undo gives `409` with the exact message.
  - `fix queues a reconcile turn`: 202, and the queued input starts `Reconcile the story`.
  - `backup flag reaches the view`.
- [ ] **Step 2:** Run `bun test apps/server/test/gm-turns.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the schemas, view fields, routes, `use-play`, `Cards.tsx` and `Passage.tsx`.
- [ ] **Step 4:** Run `bun run check`, then `bun run test:e2e` with one browser only. Expected: PASS. Update e2e selectors that assumed fixed suggestion chips.
- [ ] **Step 5:** Commit `feat(play): stream GM turns with cards, choices, Undo and check flags`.
- [ ] **Step 6:** Update `docs/spec/08-turn-pipeline.md` (the GM turn), `docs/spec/13-ui.md` (cards, choices, flags) and `HANDOFF.md`. Commit `docs: GM turn in spec and handoff`.

## Not in this plan (roadmap step 3 or UI 2.0)

- `delegate`, the full `time_skip` (watch list and interruptions), Levels with the ∞ perception scope, wiki `lookup_lore`, and canon clocks.
- Visual design for cards, choices and the play screen: UI 2.0 restyles the functional components from Task 8 once the owner picks a direction.

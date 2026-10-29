# 08 — Turn pipeline

How one player message becomes validated actions, resolved rules, and narration. Implemented in `packages/llm` (orchestration) calling `packages/engine` (rules) and `packages/memory` (context).

## Modes

The engine is always in one mode, which decides the action catalog and which roles run.

| Mode | Typical actions | Roles per turn |
|---|---|---|
| `exploration` | move, travel, examine, search, check, interact, talk (starts dialogue), rest, use item | parser → engine → narrator → guard |
| `dialogue` | talk (with approach), give, trade, reveal, leave | parser → engine → npcDialogue → guard |
| `combat` | everything in [03](03-combat-and-injury.md#action-points) | parser → engine (+ AI turns) → narrator → guard |
| `downtime` | train, craft, work, research, carouse, recover | parser → engine → narrator (summary) → guard |
| `creation` | session zero only | sessionZero (tools) → engine validation |

## The pipeline

```
1. RECEIVE      player text (+ optional UI context: selected target, chip clicked)
2. PARSE        parser role → exactly one tool call:
                  propose_actions | ask_clarification | answer_ooc
3. GENERATE     if the plan references unknown things → lazy generation (06), committed first
4. VALIDATE     engine checks legality; on failure → repair loop (max 2) → clarification
5. RESOLVE      engine executes the plan in order; reactions; AI turns until the player acts again
                then a bounded scene-response phase (witnesses, speech, legal intervention)
6. VOICE        narrator (or npcDialogue in dialogue mode) writes the passage
7. GUARD        canon guard checks it (07); regenerate once if blocking; flag if still blocking
8. COMMIT       all events in one transaction; projections updated
9. AFTER        background jobs: NPC-mind writes, scene/chapter checks → summaries,
                world ticks if time advanced, media jobs, embeddings, action suggestions
```

A turn is one database transaction from step 3 to step 8. If narration ultimately fails, the resolution still commits with a plain mechanical summary as the passage, and the player can retry narration.

## The GM turn (Wyrd 2.0, D144)

When the router has a `gm` route, a new turn runs the GM loop instead of parser → narrator → guard. Classic turns still run unchanged (and are the fallback).

```
1. CONTEXT      the GM prompt: the narrator sections plus "Your state" (items with ids,
                coins, HP, conditions, quests and companions with ids), the input
                (a leading /gm is stripped and becomes a retcon instruction)
2. LOOP         router.complete("gm", …, tools) up to tuning.gm.maxToolRounds (8) rounds;
                each tool call runs against a working state folded from the turn's drafts,
                so a later call sees an earlier define/give, and results return as role:"tool"
3. FINISH       one final no-tools round if the last round still called tools
4. COMMIT       TurnStarted, the accepted drafts, TurnCompleted{status, mechanics, gm} and
                NarrationCommitted in one append; narration streams as it is written
5. CHECK        after the commit, a background `check` call compares the prose with the
                committed changes; it may add CheckReported (flags + the recorded list) and
                EntityCreated stubs, and emits check.flag. It never rewrites or fails the turn.
```

Tools: `roll`, `act`, `change_state`, `retcon`, `lookup_lore`, `observe`, `time_skip`, `show_card`, `offer_choices`. `act` and `roll` wrap `validateTurn`/`resolveTurn`, so exploration, travel, combat, reactions and world ticks are reused. `change_state` and `retcon` emit ordinary events plus `ItemDefined`, `RetconApplied` and `RetconUndone`. Each change is validated independently: an unknown id rejects only that change, with the reason in the tool result.

Only known campaign entities and their public facts reach `lookup_lore`, `observe` or the GM context. `lookup_lore` can additionally research external wiki lore (D136): selected-world canon → global summary cache → wiki → low-confidence model knowledge, with researching progress before async work. Campaign secrets are never included in the external research prompt. A retcon card carries `Undo`, available until the player's next turn; Undo appends the stored inverse events and `RetconUndone`, and a later attempt returns `409 Undo is only available until your next turn`.

If the first GM call fails after every fallback, the turn reruns through the classic pipeline and emits `fallback`. A later-round failure keeps the rounds already committed, marks `gm.backup`, and finishes with the prose so far. Choices follow `narration.choices` (`gm` default): the GM's latest choices become the suggestion chips.

## Step 2: parse

### Tools

```ts
propose_actions({
  actorId: ActorId,                 // PC by default; a companion when the player commands one
  actions: Action[],                // ordered
  intent: string,                   // one-line summary of what the player is trying to do
})

ask_clarification({
  question: string,
  options: Array<{ label: string; actions?: Action[] }>,   // 2–5 options
})

answer_ooc({ topic: "rules" | "recap" | "status" | "other", question: string })
```

### The action union (core; plugins add more)

```ts
type Action =
  | { type: "move"; toZoneId?: ZoneId; engageTargetId?: ActorId; withdraw?: boolean }
  | { type: "travel"; toSiteId: EntityId; pace?: "careful" | "normal" | "fast" }
  | { type: "strike"; targetId: ActorId; weaponId?: ItemId; mode: "melee" | "ranged" | "unarmed" | "thrown"; calledShot?: Location }
  | { type: "aim" } | { type: "defend" } | { type: "takeCover"; propId?: string }
  | { type: "draw" | "stow"; itemId: ItemId } | { type: "reload"; weaponId: ItemId }
  | { type: "useItem"; itemId: ItemId; targetId?: EntityId }
  | { type: "firstAid"; targetId: ActorId }
  | { type: "grapple" | "shove" | "trip" | "disarm"; targetId: ActorId }
  | { type: "disengage" } | { type: "hide" } | { type: "standUp" }
  | { type: "interact"; targetId: string; verb: string }
  | { type: "ready"; trigger: string; action: Action }
  | { type: "stunt"; effect: StuntEffect; propId?: string; targetId?: EntityId; skill: SkillId }
  | { type: "check"; skill: SkillId | AttributeId; goal: string; proposedDifficulty: Difficulty; reason: string; targetId?: EntityId }
  | { type: "examine" | "search"; targetId?: EntityId; area?: string }
  | { type: "talk"; targetId: EntityId; utterance: string; approach: "neutral" | "persuade" | "deceive" | "intimidate" | "charm" }
  | { type: "give"; itemId: ItemId; toId: EntityId }
  | { type: "buy" | "sell"; itemId: ItemId; qty: number; withId: EntityId; haggle?: boolean }
  | { type: "equip" | "unequip"; itemId: ItemId }
  | { type: "rest"; kind: "short" | "long" }
  | { type: "wait"; minutes: number }
  | { type: "downtime"; activity: "train" | "craft" | "work" | "research" | "carouse" | "recover"; detail: string; days: number }
  | { type: "command"; companionId: ActorId; directive: string }
  | { type: "endScene" | "leave" }
  | { type: string /* plugin namespaced, e.g. "spellcasting/cast" */; [k: string]: unknown };
```

The JSON schema the parser sees is generated from the zod union, **filtered to the actions legal in the current mode**, with the plugins' `describeForParser` lines added.

### Parser instructions (summary)

- Map the player's words to the smallest faithful action list. Never add actions the player didn't imply.
- Only use `check` when the outcome is uncertain and failure is interesting; trivial things are just done (`interact`, `examine`).
- Use IDs from the provided scene and entity lists. If the player refers to something that isn't there and could plausibly exist, use `examine`/`search` and let lazy generation create it; if it couldn't exist, ask.
- Speech in quotes inside a combat or exploration turn becomes a `talk` action (free if short).
- If the input is ambiguous in a way that changes the outcome, ask (2–5 options). Don't ask about trivia.

## Step 4: validation and clarification

```ts
type ValidationResult =
  | { ok: true; plan: ValidatedPlan; apUsed: number }
  | { ok: false; errors: Array<{ actionIndex: number; code: string; message: string; legalAlternatives?: Action[] }> };
```

1. On failure, the errors (with legal alternatives) go back to the parser for a **repair** (max 2 attempts).
2. If repair fails or the problem is genuinely the player's choice, the player gets a **clarification card**: the question, numbered options built from the engine's legal alternatives, and the free-text box. When the parser asks itself, it phrases the options; after failed repairs the engine labels them (no extra model call). Clicking an option submits its actions directly.
3. In combat, the UI always shows the PC's legal actions and remaining AP as hint chips.

## Step 5: resolve

- Actions run in order. Each may trigger reactions (opportunity attacks, readied actions) before or after it resolves.
- If an earlier result makes a later action invalid (the target died, the PC was knocked prone), execution **stops**, and the player gets a quick follow-up for their remaining AP ("The archer is down. You have 1 AP: [Move] [Aim] [Defend] …").
- In combat, after the player's turn the engine runs every AI-controlled combatant until it is a player-controlled actor's turn again.
- The engine produces a structured **resolution** for the voice step: the sequence of outcomes, damage, wounds, conditions, deaths, morale, items, and the **required beats** that the narration must mention.

## Step 6: voice

### Narrator output contract

- **Second person, present tense** ("You shoulder the door…"). A setting allows third person.
- **Length:** follows the significance of resolved events and the configured narration length. Routine exchanges may be a few sentences; do not fill a minimum word count with unchanged ambience. Preserve the player-then-others action order and every essential outcome.
- **Must** narrate every required beat consistently with the resolution. **Must not** invent outcomes, damage, items, deaths, or the PC's feelings and decisions beyond what the player stated.
- **No numbers** in prose (they live in the mechanics log).
- Dialogue is wrapped for voicing: `<say who="npc_harl">Get out of my bar.</say>`. Narration outside tags is the narrator's voice.
- End on the situation, not a menu. (Suggestions are a separate UI feature.)
- Respect content dials, lines and veils, and the narration language.

The narrator has **no state-changing tools**. New named things it mentions are caught by the guard and committed as stubs (or blocked if they contradict canon).

### Incident responses in ordinary turns

Attempted violence is noticed even on a miss. Combat steps capture eligible witnesses before later movement. The engine's bounded scene-response policy uses established reaction profiles, perception, capabilities and previous responses in the incident; active companions retain their M6 control and approval systems. Eligible targets and salient witnesses can protest, request help, retreat or intervene. Scene reactions are separate from occasional companion banter.

A neutral witness's retreat uses a legal adjacent move and normal movement/AP costs. A protector who joins an ongoing fight rolls initiative and acts at their next normal slot; joining grants no attack. A civilian target's escape intent is attempted on their existing turn. A shout cannot create guards or claim their arrival. The policy emits optional `Resolution.responses`, with actual results and speech intents; the narrator has no new state-changing tools.

Incident/round/actor keys persist in optional response metadata on NPC memories. They work while combat advances no game minutes. Repeated identical warnings are suppressed. Narration rerolls do not record the same incident or witness observation again. The voice layer supplies a safe fallback for a selected, speakable NPC if model prose omits a valid spoken line; the guard checks the combined text.

The narrator receives relevant shared history and public characterization for selected responders and `talk`/`speak` targets. Private NPC retrieval namespaces remain outside narrator context. Nonverbal responses do not authorize dialogue. Full isolated private NPC dialogue tools below remain a later capability.

### Dialogue mode (npcDialogue)

1. If the player's `talk` uses an approach that needs a check (persuade, deceive, intimidate, charm), the engine resolves it first (opposed by the NPC's Insight or WIL, modified by disposition).
2. The `npcDialogue` role writes the NPC's response (and small action beats) from the NPC's mind and the check result. Its output **is** the passage; the narrator isn't called separately.
3. The NPC may call validated tools: `reveal_fact` (must be in the NPC's knowledge; allowed by the check result and disposition), `give_item`, `adjust_attitude` (bounded ±10), `offer_quest`, `refuse`, `call_for_help`, `start_combat`, `leave`.

## Step 7: guard

See [07-memory.md](07-memory.md#canon-guard). The guard's report also produces the NPC-mind observations, quest objective proposals and companion approval deltas that step 8 commits after engine validation.

## Streaming to the client (SSE)

| Event | When |
|---|---|
| `turn.accepted` | Input received; UI shows a typing indicator |
| `clarify` | Clarification card (turn ends here) |
| `mechanics.line` | Each resolution line, as soon as resolved (before narration) |
| `state.patch` | UI-facing state diff (HP, AP, wounds, inventory, positions) |
| `narration.delta` | Narration text. In "check before showing" mode this streams the approved text quickly after the guard passes |
| `narration.final` | Final text with `<say>` markup and the turn ID |
| `progress` | GM turn phase: researching, rolling, simulating or writing |
| `card` | One GM card (item, character, status, chapter, roll, retcon, report) |
| `choices` | The GM's latest offered choices; they also become the suggestion chips |
| `model.backup` | The GM turn fell back to another model; the passage shows `backup model` |
| `check.flag` | The background structural check found claims with no recorded change |
| `guard.flag` | Blocking issue that survived regeneration; UI shows the choice card |
| `suggestions` | Optional action chips |
| `media.ready` | A portrait, scene image or audio clip is ready |
| `turn.completed` | Done |
| `error` | Recoverable error with retry options |

## Reroll narration

"Reroll" regenerates the passage for the **same resolution and context**; the dice never change. It emits `NarrationRerolled`, reruns the guard, and replaces the passage. Unlimited, including in hardcore.

## Out-of-character questions

`answer_ooc` routes to a rules helper (parser-class model with the rules digest and the PC's sheet) or to the journal (recaps). No state changes.

## Action suggestions (optional)

After narration, a cheap call (parser role) proposes 3 short, legal next actions as chips. On by default; off in Settings. Clicking a chip fills the input box (it doesn't auto-send), so the player can edit it.

## Reliability

| Role call | Timeout | Retries | On failure |
|---|---|---|---|
| parser | 20 s | 1 (+2 repairs) | Clarification card: "I didn't catch that" with common actions |
| lazy generation | 30 s | 1 | Use a pack-table fallback (generic inn, generic guard) |
| narrator / npcDialogue | 60 s | 1 | Mechanical summary + retry button |
| guard | 20 s | 1 | Show narration unguarded with a small "unchecked" marker; queue a background check |
| gm | 90 s | 1 per round | Fall back to the classic pipeline for the first round; otherwise keep the committed rounds and mark backup |
| check | 20 s | 0 | Silent: empty flags, the turn stays resolved |

Each role has a **provider fallback chain** ([09](09-models-and-providers.md#fallbacks)). One turn runs at a time per campaign; background jobs never block a turn except lazy generation.

## Latency targets (main PC, cloud models)

Parse ≤ 3 s · resolve ≤ 50 ms · guard ≤ 4 s · full passage visible ≤ 10 s in check-before-showing mode (first token ≤ 3 s in show-first mode).

## Calls per turn (Balanced preset)

| Turn type | Calls |
|---|---|
| GM turn | 1–9 gm rounds (usually 1–2) + 1 background check |
| Classic exploration / combat | parser (DeepSeek) + narrator (ChatGPT plan) + guard (DeepSeek) |
| Dialogue | parser (DeepSeek) + npcDialogue (ChatGPT plan) + guard (DeepSeek) |
| Background | summarizer per closed scene (DeepSeek), news batch per in-game day when relevant (ChatGPT plan), suggestions (DeepSeek), embeddings (local) |

## Prompt management

- Each role's prompt template lives in `packages/llm/prompts/<role>.ts`, versioned (`promptVersion`), and recorded on every model call in the usage log.
- Changing a prompt requires running the relevant eval suite ([15](15-testing.md#evals-real-models)).

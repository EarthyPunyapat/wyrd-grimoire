# Decision log

Every design decision behind this spec, in the order it was made, with the reason. These came out of a structured design interview with the owner on 28 October 2026. **Treat them as settled.** If implementation reveals a real problem with one, raise it with the owner rather than quietly changing course.

## Foundations

| # | Decision | Why |
|---|---|---|
| D1 | **Purpose: a game the owner actually plays.** Not a learning exercise, not a product. | Optimise for fun and depth of play, not for teaching or for monetisation. |
| D2 | **Build an engine**, not a single hard-coded game. | The owner wants to play many campaigns in many genres. |
| D3 | **Hybrid truth model.** Code owns hard state (HP, items, location, quests, dice). The model may *propose* changes through validated tool calls and has free rein over flavour (description, dialogue, personality). | Pure "model as GM" drifts: forgets inventory, lets the player talk past any obstacle, no stakes. Rule of thumb: if it can kill you or you can lose it, code owns it. |
| D4 | **Heavy crunch.** CRPG-weight rules. | Owner preference. |
| D5 | **Solo** for v1; party stored as a list so multiplayer stays possible. | Multiplayer is a project of its own (turn order, spotlight, concurrency). |
| D6 | **Full engine, no fixed time budget.** | Owner wants a complete app; build it milestone by milestone. |

## Rules

| # | Decision | Why |
|---|---|---|
| D7 | **Universal core in code + genre packs as data + code plugins** for subsystems data can't express. | "Any genre" rules out one genre-specific ruleset; fully data-driven rules turn into writing a programming language. |
| D8 | **Any genre; fantasy is the first pack.** | Models know fantasy deeply; it is the best first test of the engine. |
| D9 | **Free text → model parses into structured actions → engine validates → model asks to clarify** (with numbered options) when ambiguous or illegal. Valid actions shown as hints in combat. | Feels like a human GM while keeping the rules honest. |
| D10 | **Zones and range bands**, not a grid. | Grids are painful in text and models are unreliable at spatial reasoning. |
| D11 | **Dice system is a per-campaign option: d100 roll-under (default) or d20 + modifier.** Both return the same four degrees of success; skills are stored on one 0–100 scale. | Owner likes d100 and d20. The engine only consumes degrees, so the dice module is swappable. |
| D12 | **Progression is a per-campaign option: classless (default), use-based, hybrid, classes.** Genre packs supply archetype templates. | Owner wanted all of them. Classless and use-based work in any genre for free; classes need per-pack content. |
| D13 | **Show the math: a toggle, on by default.** A mechanics log sits under the narration. | Crunch only feels fair when visible; it also exposes narration that disagrees with the dice. |
| D14 | **Defeat, not death, by default.** 0 HP / lethal wound → captured, robbed, left for dead, rescued — with lasting consequences. **Hardcore mode = permadeath.** | Failure that creates story beats a game-over screen; hardcore exists for real stakes. |
| D15 | **What locks when:** dice and progression lock at creation; difficulty, math display and subsystem toggles change any time; hardcore is chosen at creation and can be turned off (save permanently marked softcore) but never turned back on. | Switching dice mid-run means rescaling the sheet; hardcore must not be switchable after a lucky streak. |
| D16 | **Health = HP + wounds.** HP is stamina/near-misses; big hits or 0 HP cause wounds at body locations. **"Realistic":** hit locations, armour coverage per location, bleeding, fractures, infection, healing over days and weeks. | Owner wants realism; HP keeps combat readable, wounds create lasting consequences. |
| D17 | **Lethality: gritty + Luck.** Everyone uses the same deadly rules; a small Luck pool can reroll a check or downgrade a lethal wound. Lethality is a campaign dial. | Realistic danger without one bad roll ending a 50-hour campaign. |
| D18 | **Combat turns: 3 action points per turn, rolled initiative.** | Cleanest fit for free text: "kick the table, duck behind it, shoot" = three actions. |
| D19 | **Full companions**, up to 3: own sheets, combat turns, opinions, loyalty, can leave. Per-companion toggle: AI-controlled or player-controlled. | Makes solo CRPG play feel alive. |
| D20 | **Every subsystem is built and every subsystem is toggleable**, with presets: Story / Standard / Simulation / Custom. | Owner wants to track everything but not always. |

## World and story

| # | Decision | Why |
|---|---|---|
| D21 | **Worlds come from three sources:** generated at campaign start from a pitch, generated lazily as the player explores, or loaded from hand-written packs. | Flexibility; generated worlds for variety, packs for authored settings. |
| D22 | **Nothing exists until it is written into state; once written, it is canon.** The model reads canon, never its own earlier prose. | Prevents the classic drift (the shopkeeper's name changing between visits). |
| D23 | **Story mode option: Threat Clock (default) or Living World.** Threat Clock = a main threat that advances if ignored, with side hooks. Living World = no doom clock; the world simulates daily life and the player just lives in it. | Direction without railroading, plus a chill mode. |
| D24 | **Character creation: all three paths** — session-zero interview (main path; writes backstory hooks into canon), form/wizard, quick-start pregens — sharing one sheet editor. | Each suits a different mood. |
| D25 | **Content dials per campaign**: violence, horror, romance (off / fade-to-black), language, plus lines and veils. | Standard tabletop safety tools. Cloud providers' own policies still apply on top. |

## Memory

| # | Decision | Why |
|---|---|---|
| D26 | **The full memory system:** event log as source of truth; canon graph with provenance; memory pyramid (turns → scenes → chapters → arcs); NPC minds with rumour propagation; context assembler with exact lookup + graph neighbours + semantic retrieval; canon guard; player-facing journal/codex with retcon. | The owner asked for an intricate system capable of very long campaigns. It is the heart of the engine. |
| D27 | **Contradictions:** the canon guard regenerates narration once silently; if it still conflicts, it flags it to the player. **Rewind:** unlimited (disabled in hardcore). **Reroll narration** button: same outcome, new prose; dice never change. | Owner delegated; these are the best options. |

## Models, media, platform

| # | Decision | Why |
|---|---|---|
| D28 | **Cloud models primarily, local as an option**, behind a provider adapter. | Reliability for structured calls; local for privacy/cost later. |
| D29 | **Per-role model routing with presets** (Balanced / Cheap / Max quality / Fully local). Default "Balanced": ChatGPT Plus plan via Sign in with ChatGPT for narration, NPC dialogue, world generation and session zero; **DeepSeek V4.1 Flash** for parsing, canon guard and summaries; local embeddings. | Narration is where quality shows; structured jobs are cheap and shouldn't eat the weekly ChatGPT limit. Owner is on ChatGPT Plus and uses GPT-6.1 Sol/Terra. |
| D30 | **Usage/cost meter lives in Settings → Usage only**, never in the main play UI. | Owner preference. |
| D31 | **Images: yes** (portraits, scene art). Local **Qwen-Image 2.1 via ComfyUI** on the main PC by default; OpenAI image API as an option. The ChatGPT plan route cannot generate images. | Owner already runs Qwen-Image 2.1; local is free. |
| D32 | **Voice narration: yes.** Local TTS by default; **Deepgram** as the paid option (owner has a key). Speech-to-text input is a later hook. No ambient music. | Owner preference. |
| D33 | **TypeScript web app**, server on the main PC, play from any device over LAN or Tailscale, passcode-protected. | Full-featured UI, local models next to the GPU, play anywhere at home. |
| D34 | **Name: Wyrd Grimoire** (`wyrd` in code). | "Wyrd" means fate, so it literally is "Grimoire of Fate". |
| D35 | **Public repo, MIT licence.** | Sign in with ChatGPT plan usage is open to open-source local apps without partner approval. |
| D36 | **Delivery: this spec + AGENTS.md**, built milestone by milestone in any coding harness. **UI mockups** of the play screen and combat view are added to `docs/design/` as a visual target. | Owner plans to build with another coding harness. |

## Derived decisions (made while writing the spec)

| # | Decision | Why |
|---|---|---|
| D37 | d20 conversion: `modifier = round((skill − 50) / 5)`, Normal DC 11. A skill of *s*% has the same base success chance in both systems. Difficulty steps are ±20% (d100) = ±4 DC (d20). | Keeps the two dice modules balanced against each other so packs don't need per-system numbers. |
| D38 | Canon guard runs **before** narration is shown by default (narration is buffered; mechanics log and a typing indicator appear immediately). A setting allows "show first, check after". | D26 requires contradictions to be caught before the player sees them; the setting exists for players who prefer instant streaming. |
| D39 | Enemy and companion tactics use a **deterministic utility AI** in the engine; the model only writes their spoken lines. | Keeps combat fair, fast, cheap and replayable. |
| D40 | Narrator output uses light markup (`<say who="…">`) for dialogue so TTS can voice each NPC differently. | Per-NPC voices (D32). |

## Implementation decisions (M1)

| # | Decision | Why |
|---|---|---|
| D41 | The dev CLI lives in **`apps/cli`** (`bun run wyrd`). | M1 needs a CLI before the server exists, and it is an app, not a library. |
| D42 | **`storage` takes the engine's `reduce` as a parameter** instead of importing `engine`; its SQL projections are built from event payloads. | Keeps the spec's dependency rule (`core ← storage`) while still letting storage keep snapshots and replay in one transaction. |
| D43 | **`CheckRequest.tags`** (sight, hearing, attack, escape, resist, fear…) added. | Conditions need to know what kind of check it is (Blinded fails sight checks, Unconscious allows only resistance, Grappled spares escapes). |
| D44 | **`GameState.lastChecks`** keeps each actor's latest check; push and Luck act on it. `CheckResolved` records both the roll (`result`) and what counts (`effective`), plus `attempt` = initial / push / luck. | Push and Luck must be validated against the check they modify, and replay must never re-derive outcomes. |
| D45 | **Only a plain `failure` can be pushed**, not a critFailure, an automatic failure or an opposed check. | A fumble already carries a consequence; pushing an impossible task makes no sense; opposed pushes have no clear meaning. |
| D46 | **d20 rounding is half away from zero**, and the **campaign difficulty modifier counts inside the ±40 cap**. | Symmetric conversion around 50; one place where all modifiers meet keeps the cap meaningful. |
| D47 | **Luck rerolls and pushes on opposed checks are deferred to M4** (combat), where attack vs Dodge makes the rules concrete. | Avoids guessing a design the combat milestone will define. |
| D48 | **Frightened applies its −20 whenever present** until scenes track line of sight (M4/M5). | The engine can't know "in view" yet; erring towards the penalty keeps fear meaningful. |
| D49 | **Rewind's fork starts with a `BranchForked` event.** | The fork point is visible in the log and timeline, and the reducer ignores it, so state hashes still match a straight replay. |
| D50 | **Point-buy validates totals**: the sheet stores trained totals, and the validator checks that some split into the core and interest pools exists. Unspent points are warnings. | The sheet schema has no core/interest split; a feasibility check gives exact errors without adding one. |
| D51 | **`fantasy-core` lists no plugins and no class mode yet.** Spellcasting is M7; classes need `classes.yaml`. | The pack validator rejects unknown plugins, so the pack only claims what the build supports. |

## Implementation decisions (M2)

| # | Decision | Why |
|---|---|---|
| D52 | The turn pipeline (`llm`) takes the campaign store and canon through small interfaces (`TurnStore`, `TurnCanon`); the app passes `CampaignStore` and `CanonQueries`. | Keeps the spec's dependency rule (`core, engine, memory ← llm`): `llm` never imports `storage`. |
| D53 | Canon (entities, facts, turns) lives only in storage projections; the engine tracks **presence** through `scene.positions` (id → zone). Exploration scenes reuse the zone shapes from spec 03. | Spec 01 keeps unbounded canon out of `GameState`; validation still needs to know who and what is here. |
| D54 | M2 implements the exploration subset: `check`, `examine`, `search`, `interact`, `move`, `wait`, `talk`. A `talk` with an approach rolls opposed against an actor with a sheet, or a plain Normal check against a canon-only NPC. Dialogue mode proper waits for its milestone. | Smallest set that makes exploration playable; canon NPCs have no stats yet. |
| D55 | Talking needs earshot (same or neighbouring zone). A check aimed at a zone (a climb) moves the climber on success, only from the zone next to the climb. Validation projects earlier moves ("go there, then talk"). | Found in the first playtest: the rules allowed talking across the map and climbs that went nowhere. |
| D56 | After two failed repairs, clarification options are built by the engine from its legal alternatives and labelled locally (`describeAction`), not phrased by the parser. | Saves a model call on an already failing turn and can't produce illegal options. |
| D57 | Guard v1 answers through a `report_canon` tool; an unusable report shows the passage unchecked. New named entities become stubs placed in the current scene; new facts attach only to known IDs. | Tool calling is the most reliable structured output across providers; stubs keep "nothing exists until written" without blocking play. |
| D58 | The hand-authored world's premise is the world bible (section 4), stored as canon entity `concept:world-bible`. | Section 4 needs a stable source; world generation (M5) will replace it. |
| D59 | Until the server exists (M3), the terminal loop reads providers from `WYRD_HOME/config.json`, keys from `WYRD_HOME/secrets/`, and appends usage records to `WYRD_HOME/usage.jsonl`. | The spec puts these in app.db, which arrives with the server; the file layout matches spec 01 otherwise. |
| D60 | The Anthropic adapter uses the official SDK. Forced tool choice becomes `auto` plus an instruction (current models reject forced tool use); sampling parameters aren't sent; server-side refusal fallbacks are on for models that support them; a refusal is a `refused` error so the router moves on. Assistant content (thinking blocks included) is echoed back unchanged on the next turn. | Current Claude API behaviour; editing history would invalidate thinking blocks. |
| D61 | ChatGPT plan details were checked against OpenAI's token-sharing guide on 2026-10-28 (see spec 09). Still unverified: the refresh request's form fields (standard OAuth refresh grant plus `resource` is used) and the JWKS location (OpenID discovery). | Spec 09's VERIFY rule. |
| D62 | A provider that returns `usage_limit`, `not_eligible` or `auth` is benched for an hour (configurable) instead of being retried. | OpenAI documents no reset time for the plan limit and says not to retry or loop. |
| D63 | An offline provider (keyword matching for every role) lets `wyrd play --offline` run with no keys. | Development and demos without spending plan usage. |
| D64 | The DeepSeek playtest config explicitly uses `thinking: "disabled"`; the generic OpenAI-compatible adapter passes an optional thinking-mode setting from config. | A real host probe confirmed that DeepSeek's default thinking mode rejects the parser's forced `tool_choice`. Non-thinking mode supports it and is appropriate for the short parser/guard calls. Other compatible providers keep their existing defaults. |
| D65 | Retry malformed provider output once on the same target when the adapter marks it retryable, within the existing router attempt budget; then fall back. | Intermittent malformed DeepSeek parser JSON previously triggered immediate fallback despite the adapter's retryable flag. Regeneration happens before engine resolution and cannot repeat an action or roll. |
| D66 | M3 uses explicit passcode sessions on every device, including loopback; setup and account/key changes additionally require a loopback peer and hostname. SIWC starts with POST and returns a browser link. | Safe first-run setup and CSRF protection without silently trusting a local hostname. The loopback bypass in spec 14 was optional. |
| D67 | M3 journals turn-request IDs and numbered SSE messages in app.db. Campaign state and narration remain event-log projections in campaign.db. Interrupted jobs finish with a recovery message on restart; the browser refreshes GameView. | Resumable streams and durable deduplication without executing an uncertain action twice. |
| D68 | Model config and usage import from CLI files into app.db; CLI files remain intact. Dialog styles use per-page CSP nonces. Guard flags offer regeneration; retcon/edit waits for canon-editing events. | Preserve existing terminal playtests, keep account secrets server-side, and avoid bypassing event sourcing to implement a UI shortcut. |
| D69 | The default web creation path is pitch → generated world/origins/backgrounds → review → play. Names start blank; character name is optional, with an explicit generated suggestion on review. The original Ashford fixture remains available only through the explicit quick-start API for tests. | Owner correction: Wyrd is any-genre; the M3 fantasy fixture must not define the product's creation experience. This brings a bounded opening-site slice of M5/M6 forward without claiming those milestones complete. Code owns budgets and freezes generated content; NPC secrets remain server-side. |
| D70 | Dialogue resolves IDs and supplied display names; GameView includes names only for speakers already referenced in visible narration, in addition to its current scene. Reading uses restrained strong emphasis for known names/places and narrator-marked important details. Hover/focus/tap reference cards are scheduled with M5 Codex/knowledge work. | Owner request to improve readability now and defer detail cards. Fixes the generic "A voice" fallback without exposing the full NPC registry. Text is escaped; no general Markdown/HTML execution. Narrator prompt is versioned `narrator@2`. |
| D71 | M3 review fixes: the scene location's public facts (opening passage, zone descriptions) enter narrator and guard context; a reroll hides turns and facts asserted after the re-narrated turn; only the PC or a commanded companion may be the acting `actorId`; guard flags show the quoted line plus a fixed reason; mechanics render under the passage and show-the-math defaults on. | The player reads the opening passage, so the models must see it or turn one can contradict it; a past reroll must not use the future; a parser misparse must not move an NPC; guard detail can restate a secret it was given to check; spec 13 and D13 already settled reading order and the math default. |

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

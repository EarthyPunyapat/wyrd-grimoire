# Wyrd 2.0 — design spec (2026-10-29)

This spec comes from a 72-question design interview with the owner on 29 October 2026, run after M7 and before M8. The raw answers are in the owner's notes (`~/Downloads/chatgpt-rpg/decisions.md`), and the settled ones are recorded as D129–D144 in `docs/decisions.md`. **Treat this document as settled.** Where it conflicts with `docs/spec/*`, this document wins, and each implementing change updates the affected spec file in the same commit (AGENTS.md rule).

## 1. Why

The owner played their first real campaign on deepseek-flash and found it "so lacking". Four of their six turns were an argument with the out-of-character helper about an inventory they couldn't see. A "yellow lantern ring" they wrote at creation became a plain lantern, and the helper told them to "ask your GM". "Use its power" produced mood but no outcome.

The benchmark is the owner's own ChatGPT RPG sessions: four shared chats, 275 player turns, a cosmic Green Lantern campaign that ended with an omnipotent "Absolute Sovereign". The owner's notes analyse them (`findings.md`). In those chats ChatGPT:
- rolls real d20s in Python
- never says no
- does time skips at any scale
- keeps canon characters autonomous and in character
- searches the web for lore
- matches the source novel's prose style
- draws cards and per-turn choice buttons
- gives the companion advisor (Ari) a real voice

Its weakness is the context limit: the owner restarts chats with hand-written state recaps of up to 8.7k characters.

**The bar:** every turn feels at least as good as those chats, and Wyrd beats them on memory, real dice and a living world.

## 2. What stays

- **Code owns hard state (D3).** The model proposes, and the engine validates, resolves and commits events. The event log is the truth, `rebuild` recreates projections, and the engine stays pure and seeded.
- Storage, history (rewind, branches, `.wyrd` export), settings and presets, memory (summary pyramid, retrieval), world simulation (living world, clocks, factions), and the d100 rules for `fantasy-core`.
- Secrets stay in `WYRD_HOME/secrets/`. Tests stay offline (FakeProvider and cassettes); real model calls belong to `evals/`.

## 3. Invariants that change

| Old | New |
|---|---|
| "The narrator describes resolved outcomes; it never decides them." Four fixed stages: parser → engine → narrator → guard. | **The GM decides what is attempted and when dice are needed. The engine resolves every roll and commits every change.** The GM model calls engine tools. A change exists only if a tool call made it, and prose may not claim a change no tool recorded (§5.4). |
| Heavy CRPG crunch everywhere (D4). | **Rules depend on the pack.** `fantasy-core` keeps d100 crunch. Source and new campaigns use d20 plus the Level scale (§6). |
| "Original content: pack text is written fresh." | Still true for everything **shipped in the repo**. Runtime source lore (§8) is per-user data in `WYRD_HOME`, stored as summaries with source links, and never committed. |
| Knowledge layers: prompts see what the PC knows. | Unchanged, except that an actor at Level ∞ has perception scope `omniscient` (the GM may read any public or private state the story needs), and the `observe` tool grants perception of a target. NPC minds still get only their own knowledge. |

## 4. Order of work

1. **Small fixes that survive the rebuild** (plan `2026-10-29-w2-step1-fixes.md`):
   - creation never drops player-authored details
   - generated campaigns get starting items and a shop
   - flash-robust structured output for world generation and session zero
   - documented ChatGPT-plan model setup
2. **The GM-with-tools turn** (plan `2026-10-29-w2-step2-gm-turn.md`), built by Claude. It ships with the card protocol and the first UI 2.0 play screen.
3. **Game systems** (roadmap `2026-10-29-w2-roadmap.md`, workstreams for the deepseek agents): Levels and abilities, avatars and sealing, wiki lore, canon clocks, time skips and watching, Ari and delegation, multi-world data.
4. **Import, replay and test:** the Ethan and Ari import from the share links, a side-by-side replay against the chats, and the owner's 20-turn playtest.

M8 (media) resumes after the step-4 playtest passes. Two "after M8" roadmap items go: the cyberpunk pack is superseded by source mode, and the post-M8 UI overhaul is pulled forward as UI 2.0.

**Runtime limit while building:** the owner's laptop has 12 GB RAM. Run only one headless browser or heavy agent at a time.

## 5. The GM turn

### 5.1 Loop
One **GM role** (new router role `gm`) runs the whole turn (D144):
1. The context is assembled (memory assembler, §5.6).
2. The GM streams prose and may call tools.
3. Each tool call is validated with zod and executed by the engine, and the result is returned to the GM as a tool-result message.
4. The loop ends when the GM finishes without a tool call, or after `tuning.gm.maxToolRounds` rounds (default 8, from config). After the cap, the GM is asked once to finish without tools.

The old parser, narrator, guard and OOC roles stay in the router so existing campaigns and evals keep working, but new turns use `gm`.

### 5.2 Tools (v1)
| Tool | Effect |
|---|---|
| `roll` | Make a check: actor, ability or skill, opposition (DC or opposing actor), reason. The engine resolves it by the campaign's resolution (d20+Level or d100) and returns the dice, the modifiers and a degree. Returns a `mechanics` line. |
| `change_state` | A list of typed state changes (item give/take/equip, HP or resource, entity create, fact assert, quest or clock update, XP, level proposal, location move). The engine validates each one against current state; rejected changes come back with a reason. |
| `lookup_lore` | Look up a name or topic in the campaign's lore (§8). It may trigger a cached wiki fetch. Returns a summary and the fact ids. |
| `time_skip` | Advance by a duration, or until a condition. Runs the world simulation (§10) and returns a digest plus any interruption. |
| `delegate` | Give a companion a task (§11). |
| `observe` | Look at any entity or location now (scope rules in §3). Returns perceivable state. |
| `show_card` | Ask the UI to show a card (§5.5) bound to engine data by id. |
| `offer_choices` | 2–5 choices, each with a label and a one-line description, following the choice policy (§5.3). |
| `retcon` | GM mode (§5.3): a list of state changes applied as a retcon group with an Undo. |

### 5.3 Player authority
These rules are in priority order (D129):
1. **Anything the player writes at creation is canon** and is never paraphrased away.
2. **GM mode.** A request to change the game (gear, sheet, world facts) is carried out as a `retcon`, and the UI shows a **Retcon card** with **Undo**. Undo appends the inverse of every change, so items, coins, HP and facts return to their prior values and created entities and quests are marked `retconned` and hidden. It is available until the next player turn. A message starting with `/gm` forces GM mode. Without `/gm`, the GM treats a message as an in-world act unless it is clearly a correction. Example: "make Batman forget who I am" is an act, and the world can notice it.
3. **Otherwise "yes, and…"** with real consequences. The GM never answers "ask your GM" or "I can't change that".

There is **no separate OOC helper.** The GM answers rules and state questions with full access to the player's state.

**Choice policy** (`narration.choices`): `gm` (default: choices only at real decision points), `always`, or `onRequest`. "Give me choices" always works.

### 5.4 Structural check
After each turn, the cheap model (`check` role, deepseek-flash by default) compares the prose against the turn's committed changes. It reports claims of state change with no matching tool record (for example "you now hold the sword" with no item change) and named entities the GM introduced without a record.
- It runs **right after the prose finishes**, without delaying the turn, and its flags arrive on the open stream or with the next view refresh.
- It never rewrites anything.
- A finding shows as a small flag on the passage, with "Fix", which asks the GM to reconcile in a follow-up mini-turn, and "Dismiss".
- Unrecorded named entities are auto-recorded as stubs.

### 5.5 Cards
The GM chooses from a fixed set of cards, and the UI draws them from engine data:
- `status`
- `item`
- `character`
- `roll`
- `choices`
- `chapter` (a title plus a location/time line)
- `retcon`
- `report` (an observation or delegation report)
- `levelUp`

A card references ids, and the UI never renders model-authored layout. Cards with unknown ids are dropped.

### 5.6 Context, length, latency, models
- **Context:** the GM gets the memory assembler's sections (story so far, party, scene, present entities, knowledge, retrieved memories, quests and clocks, recent turns) plus the style profile (§9) and the tool list.
- **Length:** the GM chooses. `narration.length` (short/normal/long) is guidance only, and the `MAX_CHARS` truncation is removed.
- **Latency:** quick actions should start streaming in about 5 seconds; big moments (skips, ascensions, new locations) may research. The UI shows a progress line from stream events (`researching <topic>`, `rolling`, `simulating <span>`, `writing`).
- **Models:** `gm` and `worldGen` on the ChatGPT plan; `check`, the parser fallback and summaries on deepseek-flash. When the plan is unavailable (usage limit or not eligible), the router falls back to deepseek-flash and the UI shows a **"backup model"** badge on affected passages. Play is never blocked.

## 6. Levels, abilities, power

- **The Level scale** (D130): 1–4 human → peak human → street level; 5–8 city → country; 9–12 planet → star system; 13–16 galaxy → universe; 17–20 multiversal → beyond; 21+ open-ended; and **∞** (the schema value `"infinite"`).
- **Resolution** (d20 campaigns). Let Δ = actor's effective level − opposition level:

| Δ | Result |
|---|---|
| 0 | d20 + ability-rank bonus + situational modifiers vs DC, or an opposed roll |
| +1 | Roll with +10 |
| −1 | Roll with −10 |
| ≥ +2 | Automatic success, no roll |
| ≤ −2 | Automatic failure, unless a tool call cites an exploit (a weakness, ability or canon vulnerability). Then roll at −10. |

  An ∞ actor never rolls against finite opposition. All of these numbers live in config (`tuning.levels`).
- **Abilities:** a sheet entry with a name, description, level, cost or limit, and a rank of 1–10. The rank bonus is `ceil(rank/2)` (+1 to +5) and applies only when Δ = 0. Abilities come from the source research (§8) or the GM.
- **Power rating:** cosmetic and shown on the sheet. `powerRating = floor(2^(1.5·level) · (1 + Σranks/20))`, with the formula in config. ∞ shows "∞".
- **Levelling up** (D131), four ways:
  - story milestones (the GM proposes a `levelUp` card and the player accepts)
  - XP thresholds (config)
  - a breakthrough roll during training or a time skip (it can fail, or succeed with a cost)
  - GM mode
- **Dice per pack** (D132): `fantasy-core` stays d100; source and new campaigns default to d20 with Levels.
- **Death** (D133): chosen per campaign at creation, hardcore by default (the hardcore preset already locks rewind).

## 7. Avatars and sealing

- **Avatar** (D134): a playable actor linked to a sovereign (an ∞ actor), created at a chosen Level in a chosen world.
  - Avatars roll real dice and can die. Death ends the **run** (`ended: died`), and the sovereign is unaffected.
  - Sovereign intervention during a run is allowed (§5.3) but marks the run **`unsealed`**, and the run's record shows it. Companions can enter as avatars too.
- **Sealing:** a sovereign or high-level actor sets an `effectiveLevel` used for resolution until the seal is broken. Breaking a seal is always allowed, and the world can notice it.

## 8. Source stories and lore

- **Campaign source** (D135): optional at creation (an original world from a pitch, or "inside <source>"). For a source, creation researches it into the world bible: characters, places, power systems as abilities, and the timeline as canon clocks.
- **Lore fetch** (D136): Wyrd fetches pages through the official MediaWiki APIs of Wikipedia and Fandom wikis (DC uses `dc.fandom.com`):
  - at most 1 request/s, with the user agent `WyrdGrimoire/<version> (personal, non-commercial)`
  - pages are cached **once, globally**, in `WYRD_HOME/lore-cache/` and shared across campaigns
  - pages are summarised into facts (source `lore`, with a link to the source page); stored text is summaries, never copied passages
  - the model's own knowledge is the fallback when no page is found, marked lower confidence
- **Continuity:** "greatest hits" by default. The GM picks the most iconic version and the player can override it per fact.
- **Canon events** (D137) are clocks on the timeline that advance with time and resolve unless the player intervenes. Canon characters keep acting on their own and stay in character.

## 9. Style

A campaign style profile has three parts:
- the source-derived style (automatic)
- the player's own words
- a **sample paragraph** shown at creation, which the player revises until it's right

The profile can be edited mid-campaign. The **default house style** imitates the owner's ChatGPT GM voice. The repo carries a written style guide, and the owner's actual excerpts live in `WYRD_HOME/style/house/` and are never committed.

## 10. Time skips and the god-game

- **`time_skip`** takes a duration ("a month") or a condition ("until the clones are done"). It runs the world ticks across the span (daily and weekly: factions, NPC life events, clocks, canon clocks, delegated tasks) and returns a digest.
- **Watch list:** the player marks entities or factions, and each gets an observation report during skips (a `report` card).
- **Interruptions:** a skip stops early when an event involving a watched entity reaches severity ≥ `major`, a canon clock is about to resolve, or a delegated task needs the player.
- **`observe`:** looks in on anything, now.

## 11. Companions and Ari

- **Ari** is a **loyal** companion (D138): she has no approval meter and won't leave. She has her own voice (speaker blocks, §12) and acts as advisor (she argues and recommends) and as a delegate.
- **Delegation:** a task is `{id, assignee, goal, startedAt, dueAt?, status: active|blocked|done|failed, report?}`. It resolves during time advances with real rolls at the assignee's Level against the opposition's. A task can go sideways, and it reports back with a `report` card or by asking for help.
- **The Ethan campaign:** Ari is Level 20 and Ethan is Level ∞.

## 12. UI 2.0

**References:** ChatGPT's in-chat cards, and the modern UI of Caves of Qud: one dark dominant hue with bright accents, a dense one-line status strip on top, a message log on the right with coloured keywords, an ability hotbar along the bottom with key hints, and centred thin-bordered event pop-ups. Qud's **structure** with a modern finish (D139).

- **Layout presets:**
  - **Reader** (default, the "Night Codex" mockup): book serif prose, chapter numerals, rolls and items as margin notes.
  - **Cockpit** (the "Qud Modern" mockup): dense monospace chrome, a right-hand log and watch list, a 1px accent line for selection.
  - **Chat** (the "Lantern Glass" mockup): true black, soft rounded cards, input as a chat bubble.
  - **Visual Novel** (with M8 art).

  All presets share components, data and accent meanings; they change only layout, fonts and spacing (D150).
  - Customization is presets plus dials: text size, column width, light/dark, density, motion. No free drag-and-drop.
- **Chrome:**
  - a slim status strip (level or power rating, key resource, location, game time, model badge)
  - a bottom **ability hotbar** that changes with the character (for Ethan: Observe, Time skip, Delegate to Ari, Seal/Avatar), with key hints. A click sends the action or prefills it.
- **Story:**
  - the player's input as a muted echo
  - the prose in the theme's reading font
  - dialogue as **speaker blocks** (portrait and name) inside the prose flow
  - cards inline
  - entity names **tinted by type** (person, place, item, faction, companion), each opening a card on hover or click
  - rolls and changes in a collapsible line under each passage (Reader); in Cockpit they also go to the right-hand log
- **Menus:** a full-screen **status screen** with tabs (Character, Inventory, Quests, Journal, Codex, Map, Timeline, Settings), opened with C, I, Q, J and M and closed with Esc back to the story. The **Inventory** is a paper doll (worn and wielded slots) plus a bag grid. Every item opens the same item card the GM uses.
  - Equip, move and sort are instant.
  - Use, give, throw and drop send a story turn.
  - Selling happens only in shop scenes.
- **Keyboard first:** 1–9 pick choices, C/I/Q/J/M open menus, arrows navigate, Esc goes back, `/` focuses the input. The mouse works everywhere.
- **Motion:** only at big moments (a d20 tumble, a level-up flare, an artifact card flip, a crit pulse).
  - Toasts announce minor changes.
  - A centred pop-up (dismissed with a key press) is reserved for big moments: level-up, a new artifact, an avatar's death, a missed canon event.
- **Theme recipe:** a fixed shell, plus a per-campaign theme picked by the GM at creation (and overridable):
  - one dark dominant hue
  - accents with **fixed meanings in every theme**: gold for companions and artifacts, red for danger, cyan for interactive things
  - fonts: crisp monospace for the chrome and a reading font for the prose
  - the Green Lantern theme: near-black space with emerald
- **Icons:** a free game-icon set with attribution, chosen by item type. AI art for key items arrives with M8.
- **Laptop first;** the phone must work.
- **Process:**
  1. tasteskill (`~/.agents/skills/design-taste-frontend`) deals three directions, one of them "Qud modern".
  2. Each direction becomes a static mockup of the real play screen with Ethan, Ari and AXIOM PRIME.
  3. The owner picks one or mixes them.
  4. impeccable (`~/.agents/skills/impeccable`) writes `DESIGN.md` and the tokens, and critiques and polishes every screen.

  The `ux-audit` and `design-critic` skills from `sergekostenchuk/ui-ux-agent-skill-system` are read as text for a second opinion. That package is not installed.
- **Redesign order:**
  1. the play screen, cards and inventory (with step 2)
  2. the menus and panels
  3. home and creation (including source mode and the import)

## 13. Creation

- **Pitch-first, with an optional source** (§8). Style uses the sample paragraph (§9).
- **The GM proposes the subsystem toggles** to fit the setting (D140): survival, hunger, exposure, encumbrance, disease and light are **on** for an apocalypse and **off** for cosmic DC. It also proposes the theme, the resolution (d20/d100), the death rule and the starting Level (default from the source, e.g. Level 9 for a rookie Lantern). The review step shows all of these for override.
- **Player-authored gear, looks, backstory and pitch specifics** are stored verbatim as pinned facts with source `player`, and they win any conflict (§5.3.1).

## 14. Multi-world data

A campaign holds `worlds[]`, and v1 creates one. Entities, facts, clocks and lore carry a `worldId`. A sovereign can open a new world (a new source) later without starting over. Companions and history carry across (D141).

## 15. Import and the test

- **Share-link import** (D142): decode a ChatGPT share page into a transcript (the format is a React Router turbo-stream: an indexed array with `_N` key references and `linear_conversation`). A prototype is in the owner's `~/Downloads/chatgpt-rpg/decode.py`.
  - A `worldGen`-role extraction then drafts the PC sheet, companions and history facts from the transcript, and the player reviews them at creation.
  - Only what the player keeps is imported. For the owner's campaign that's Ethan Hunt (Level ∞, AXIOM PRIME and his abilities as reference), Ari, and the DC-side history: the Justice League rings he secretly monitors, Vale, the Trinity Lanterns, Hal, John and Kyle. Reverend Insanity and Fang Yuan are excluded.
- **Replay harness** (D143), in `evals/replay/`: feed the player inputs from the chats into Wyrd's GM on real providers, and write a side-by-side HTML page (ChatGPT's turn next to Wyrd's) for the owner to judge.
- **Done fixing** means:
  1. the replay shows no systematic losses (flat prose, ignored intent, refusals)
  2. the owner plays 20 turns of the Ethan and Ari campaign in DC with no recap pasted and judges it at least as good as ChatGPT

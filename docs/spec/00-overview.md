# 00 — Overview

**Wyrd Grimoire** is a solo, any-genre, text-based role-playing game engine. A language model plays the game master's voice, but **code owns the rules and the truth**. The player types what they want to do in plain language; the engine turns that into validated actions, resolves them with real dice and real rules, and the model narrates exactly what happened.

> "Wyrd" is Old English for fate. The dice decide; the model tells the story.

## Goals

1. **A game, not collaborative fiction.** Stakes are real because state lives in code: HP, wounds, inventory, money, reputation, quests and time cannot be talked away.
2. **Any genre.** One universal rules core; genres are content packs (data) plus small code plugins for genre-specific subsystems (spellcasting, hacking, cyberware, vehicles).
3. **Heavy crunch, optional everything.** Deep simulation is available, and every subsystem can be switched off. Presets make campaign setup quick.
4. **Long campaigns that stay consistent.** A layered memory system (event log, canon graph, memory pyramid, NPC minds, retrieval) keeps a 200-session campaign coherent. Nothing exists until it is written into state; once written, it is canon.
5. **Runs on the player's own hardware, cheaply.** A web app served from the player's main PC, playable from any device on the LAN or over Tailscale. Text models via the player's ChatGPT Plus plan and DeepSeek; images and voice locally on the PC's GPU, with paid APIs as options.

## Non-goals (for now)

- Multiplayer. The data model stores "the party" as a list so this stays possible later, but v1 is one human player.
- Hosting as a public service. It is a self-hosted, single-user app.
- Grid or coordinate-based tactical maps. Positioning uses zones and range bands.
- Ambient music.

## Who it is for

One player (the repo owner) who wants a crunchy, CRPG-weight experience — Baldur's Gate / Call of Cthulhu / GURPS energy — with the freedom of a human game master, in any genre, on any device at home.

## The core loop (one turn)

```
player types free text
  → PARSER (model) turns it into a structured action plan, or asks to clarify
  → ENGINE validates the plan (legal? enough action points? in range?)
  → ENGINE resolves it (dice, rules, state changes) and emits events
  → NPCs / enemies / companions react (engine AI, model for words only)
  → NARRATOR (model) narrates the resolved outcome, never inventing results
  → CANON GUARD (model) checks the narration against canon before it is shown
  → events committed; memory, world simulation and media jobs updated
```

The full pipeline is in [08-turn-pipeline.md](08-turn-pipeline.md).

## Glossary

| Term | Meaning |
|---|---|
| **Engine** | The deterministic TypeScript rules engine. No network, no model calls, seeded RNG. |
| **Event** | An immutable, append-only record of something that happened (`CheckResolved`, `DamageApplied`, `EntityCreated`…). The event log is the single source of truth. |
| **State** | The current game state, computed by folding events through pure reducers. |
| **Canon** | Every entity (NPC, place, faction, item, quest) and every fact about it that has been committed via events. The model reads canon; it never treats its own earlier prose as truth. |
| **Campaign** | One playthrough: a world, a player character, settings, and an event log. Stored as one SQLite file plus a media folder. |
| **Branch** | A line of history in a campaign. Rewinding creates or switches branches; saves are pointers into a branch. |
| **Genre pack** | Data (YAML/JSON) that defines a genre: skills, abilities, items, creatures, archetypes, naming style, UI theme, and which plugins it enables. |
| **Plugin** | A small code module that adds a subsystem data can't express (e.g. spellcasting). Enabled by packs. |
| **Resolution module** | The swappable dice system: `d100` (default) or `d20`. Both return the same four degrees of success. |
| **Degree** | The result of a check: `critSuccess`, `success`, `failure`, `critFailure`. |
| **AP** | Action points. Every combatant gets 3 per turn. |
| **Zone** | An abstract area of a scene (e.g. "the bar", "the doorway", "behind the altar"). Distance is counted in zones, not metres. |
| **Wound** | A lasting injury at a body location with a severity and effects, separate from HP. |
| **Luck** | A small pool the player spends to reroll a check or downgrade a lethal wound. |
| **Role** | A job the model does: `parser`, `narrator`, `npcDialogue`, `worldGen`, `guard`, `summarizer`, `sessionZero`, `embeddings`. Each role can use a different provider and model. |
| **Threat clock** | A segmented progress track for the main threat; it advances with time and player inaction. |
| **Living World** | Story mode with no doom clock; the world still simulates daily life. |
| **Memory pyramid** | Verbatim recent turns → scene summaries → chapter summaries → arc summaries. |
| **NPC mind** | An NPC's private memory: only what it witnessed, was told, or heard as rumour. |
| **Canon guard** | The post-narration check that extracts new facts and catches contradictions. |
| **SIWC** | "Sign in with ChatGPT": lets the app use the player's ChatGPT Plus plan for text model calls. |

## Document map

| File | Covers |
|---|---|
| [01-architecture.md](01-architecture.md) | Stack, packages, runtime topology, event sourcing, data flow |
| [02-rules-core.md](02-rules-core.md) | Attributes, skills, checks, resolution modules, difficulty, Luck, conditions |
| [03-combat-and-injury.md](03-combat-and-injury.md) | Zones, initiative, action points, attacks, hit locations, armour, HP and wounds, bleeding, infection, healing, defeat, enemy AI |
| [04-characters.md](04-characters.md) | Character sheet, three creation paths, four progression modes, companions |
| [05-genre-packs.md](05-genre-packs.md) | Pack format, plugin API, the starter fantasy pack |
| [06-world-and-story.md](06-world-and-story.md) | World generation, lazy generation, story modes, factions, time, world simulation |
| [07-memory.md](07-memory.md) | The memory system end to end |
| [08-turn-pipeline.md](08-turn-pipeline.md) | Per-turn orchestration, action schemas, prompts, clarification, streaming, reroll |
| [09-models-and-providers.md](09-models-and-providers.md) | Provider adapters (ChatGPT plan, DeepSeek, Anthropic, OpenAI-compatible, Ollama), role routing, presets, usage meter |
| [10-media.md](10-media.md) | Images (ComfyUI + Qwen-Image 2.1, OpenAI images) and voice (local TTS, Deepgram) |
| [11-subsystems.md](11-subsystems.md) | Inventory, money, time, reputation, crafting, survival, ammo and durability; toggles and presets |
| [12-campaign-settings.md](12-campaign-settings.md) | Settings schema, what locks when, content dials |
| [13-ui.md](13-ui.md) | Screens, layout, combat view, map, themes, mobile |
| [14-server-and-persistence.md](14-server-and-persistence.md) | SQLite layout, saves and branches, HTTP API, auth, LAN/Tailscale |
| [15-testing.md](15-testing.md) | Deterministic tests, fake providers, record/replay, evals |
| [../milestones.md](../milestones.md) | Build order with acceptance checks |
| [../decisions.md](../decisions.md) | Every design decision and why |

## Conventions used in this spec

- **MUST / SHOULD / MAY** are used in the usual RFC sense.
- **`VERIFY:`** marks a fact about a third-party service that was correct when the spec was written (October 2026) but must be checked against official docs at implementation time. Never hardcode anything marked VERIFY without checking.
- Numbers (costs, thresholds, budgets) are **tuning defaults**. They live in config, not in code, so playtesting can change them.

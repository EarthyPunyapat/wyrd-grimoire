# Milestones

Eight milestones, built in order. **Every milestone ends runnable**, with its acceptance checks passing. Milestone 4 is the first point where the game is genuinely fun to play.

Each milestone lists its scope, the spec sections it implements, and acceptance checks. A milestone is done only when every acceptance check passes and CI is green.

---

## M1 — Engine core (no models)

**Spec:** [01](spec/01-architecture.md), [02](spec/02-rules-core.md), [04 sheet + creation budget](spec/04-characters.md#character-sheet), [05 pack loader](spec/05-genre-packs.md), [14 storage](spec/14-server-and-persistence.md#storage), [15 engine tests](spec/15-testing.md#engine-pure-deterministic)

- Bun workspace scaffold (`packages/*`, `apps/*`), TypeScript strict, lint, `bun test`, GitHub Actions CI.
- `core`: ULIDs, seeded RNG, event envelope, the first event schemas, shared zod types.
- `engine`: attributes, skills, derived stats, check requests, **d100 and d20 modules**, degrees, boons/banes, opposed checks, pushing, Luck, core conditions, reducers.
- `storage`: `campaign.db` schema, event store, branches, saves, snapshots, `rebuild` command.
- Character sheet schema, point-buy validator.
- Pack loader and validator; `fantasy-core` with skills, ancestries, archetypes and a handful of items.
- A dev CLI: roll checks, build and validate a sheet, append events, rewind, rebuild.

**Acceptance**
- [x] d20/d100 equivalence test passes for every skill 5–95.
- [x] Reducer property tests pass (determinism, snapshot + replay = full replay, rewind reproduces the branch).
- [x] Dev CLI: create a campaign file, append events, rewind, rebuild → identical state hash.
- [x] `bun run wyrd pack validate packs/fantasy-core` passes.
- [x] CI green.

## M2 — The model loop

**Spec:** [08](spec/08-turn-pipeline.md), [09](spec/09-models-and-providers.md), [07 context assembler v1 + guard v1](spec/07-memory.md)

- Provider adapters: `openai-compatible` (DeepSeek, Ollama), `chatgpt-plan` (Sign in with ChatGPT + Responses API), `anthropic`; **FakeProvider**; record/replay cassettes; role router with presets and fallbacks; usage records.
- Context assembler v1: sections 1–4, 6–8, 12–13 (no retrieval yet).
- Pipeline for **exploration** turns: parse → validate (repair → clarify) → resolve checks → narrate → guard v1 (contradictions, state claims, new entities) → commit. Reroll narration.
- A terminal play loop for testing before the UI exists, against a small hand-authored test location.

**Acceptance**
- [x] With FakeProvider, an exploration turn runs end to end in CI, including a repair → clarification path and a guard regeneration path.
- [ ] Connecting ChatGPT via "Continue with ChatGPT" works on the host PC; tokens refresh and rotate; a mocked `429` usage-limit error switches the narrator to its fallback without retry loops.
- [ ] With real DeepSeek + ChatGPT plan: a 20-turn exploration session in the test location with every blocking guard issue either regenerated away or flagged.
- [x] Usage records written for every call.

## M3 — Web UI v1

**Spec:** [13](spec/13-ui.md), [14 API, auth, network](spec/14-server-and-persistence.md), mockups in [`design/`](design/)

- Hono server: passcode auth, campaigns, turns, SSE streaming, GameView (filtered to PC knowledge).
- Web: Home; pitch-first new campaign → generated opening world, origins and backgrounds → review → play (owner correction, D69); Play screen (narration, mechanics log, input, suggestion chips, clarification card, guard flag card, reroll); compact Sheet tab with balanced seven-attribute layout; Settings → Models, Connection, Usage; parchment theme; phone layout. Offline preview labels its fixed sci-fi example. The authored fantasy fixture remains an explicit test API.

**Acceptance**
- [ ] Server on the main PC; play from the laptop over LAN and from a phone.
- [x] Mechanics lines appear before narration; narration appears after the guard by default.
- [x] No cost or token counts anywhere in the play UI.
- [x] Playwright e2e (FakeProvider) passes on desktop and phone viewports.

## M4 — Combat ← first truly playable point

**Spec:** [03](spec/03-combat-and-injury.md), [08 combat mode](spec/08-turn-pipeline.md)

- Zones and `propose_zone_map`; surprise and initiative; 3 AP; every core action; stunts; attacks, defence, hit locations, armour, HP, wounds, bleeding, lethal checks, Luck spending; morale; utility AI for enemies and companions; combat end, loot, defeat outcomes; hardcore death, obituary and Legacy.
- Combat panel: initiative strip, zone diagram, legal action chips, AP pips, target details.
- `fantasy-core`: weapons, armour, ≥ 10 creatures.

**Acceptance**
- [x] A tavern brawl is playable start to finish through the UI with free text ("kick the table over, duck behind it, shoot the archer" works as three actions).
- [x] Golden combat scenarios pass.
- [x] Defeat in a normal campaign produces a consequence and a new hook; death in hardcore produces an obituary and offers Legacy.

## M5 — World and memory

**Spec:** [06](spec/06-world-and-story.md), [07](spec/07-memory.md) (complete)

- World generation stages 1–2; lazy generation; name registry; Threat Clock mode; factions; quests; time and calendar; world ticks; travel and encounters.
- Memory: full canon graph, PC knowledge, memory pyramid with summaries and session recaps, NPC minds, rumours, retrieval (FTS + vectors + RRF), the complete context assembler, guard v2 (secrets, witnesses, objectives, approval).
- UI: Journal, Codex (pin, retcon), Map.
- Narration reference cards: hover/focus/tap character, location and important entity names for player-known details and a Codex link. Use canonical IDs, handle duplicate names and keep unrevealed information private. Bold reading emphasis ships earlier in M3.
- Setting-aware forms of address: replace generic labels such as `[traveller]` in clarification/welcome copy with wording appropriate to the generated setting and the player's established identity or title (for example, "Lantern" for a Green Lantern character, "Detective" for a detective). Derive and persist player-facing address metadata during world/character creation, allow player correction, and update it when the established identity changes. Never infer a title from genre alone or reveal an undiscovered identity. Neutral copy is a temporary fallback, not the finished feature; see spec 13.

**Acceptance**
- [ ] Generate a world from a pitch, then play 100+ turns across at least 3 sites. *(Offline: passing, `apps/server/test/soak.test.ts`. Real-model run: owner.)*
- [ ] Memory eval recall@10 ≥ 0.9; NPC-knowledge eval passes ([15](spec/15-testing.md#evals-real-models)). *(Offline memory eval: recall@10 = 1.0. NPC-knowledge eval: run `bun evals/npc-knowledge/run.ts` on the host.)*
- [x] The codex shows only what the PC knows; lying to an NPC, then their `reportsTo` superior later knowing, is demonstrable.

## M6 — Characters and companions

**Spec:** [04](spec/04-characters.md)

- Session zero with tools and live sheet preview; hooks consumed by world generation stage 2; form wizard; quick-start pregens; sheet editor.
- Classless progression with the spend UI.
- Companions: recruiting, sheets, AI/manual control, directives, approval, personal quests, banter.

**Acceptance**
- [x] A character can be created through each of the three paths; session-zero hooks appear in the generated world. *(`apps/server/test/creation.test.ts`, `e2e/creation.e2e.ts`; offline interviewer. Real-model session zero: owner.)*
- [x] A companion can be recruited, fights, gains or loses approval from things they witness, and leaves at the threshold. *(`packages/packs/test/companions.test.ts`; guard deltas through the pipeline in `packages/llm/test/pipeline.test.ts`. Real-model approval judgement: owner.)*

## M7 — Breadth

**Spec:** [11](spec/11-subsystems.md), [12](spec/12-campaign-settings.md), [04 progression modes](spec/04-characters.md#progression), [05 spellcasting](spec/05-genre-packs.md#the-spellcasting-plugin-fantasy-core), [06 Living World + downtime](spec/06-world-and-story.md)

- Every subsystem with toggles and presets; use-based, hybrid and class progression; d20 in the UI; Living World mode; downtime; the `spellcasting` plugin; full content dials; settings locks; Timeline/branches UI; export/import; backups.
- Complete `fantasy-core` content to the minimums in [05](spec/05-genre-packs.md#the-starter-pack-fantasy-core).

**Acceptance**
- [x] A campaign on each preset is playable; toggling subsystems mid-campaign causes no errors.
- [x] A d20 campaign plays end to end.
- [x] Living World runs a month of in-game time with visible faction events and news.
- [x] Locked settings are refused by the API and greyed out in the UI.

## After M8 — UI rework

The owner wants a full UI rework once M8 ships; a dedicated roadmap will be written at that point.
Recorded asks so far: campaign management (delete, rename, archive), resumable creation and a draft
library, visible progress for every long job, clearer model/provider errors, and a broader layout,
mobile and accessibility pass.

## M8 — Media

**Spec:** [10](spec/10-media.md)

- Image adapters (ComfyUI with the owner's Qwen-Image 2.1 workflows; OpenAI images), triggers, canonical portraits and edit-mode consistency, UI placement.
- TTS adapters (local, Deepgram), voice casting, segmented playback, controls; GPU mutex.

**Acceptance**
- [ ] New NPCs get portraits, and the same NPC looks the same in later scene images.
- [ ] Narration plays with distinct, persistent NPC voices.
- [ ] Media never delays a turn.

---

## After M8

Speech input; a second genre pack (cyberpunk, with `hacking` and `cyberware` plugins) to prove genre independence; polish.

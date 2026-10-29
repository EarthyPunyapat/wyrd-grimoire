# Handoff notes

Working notes for whoever picks this up next. Read `AGENTS.md` first, then this file.

## Status (2026-10-29)

**M1–M7, W2 step 2 and workstreams A (Levels/abilities), B (avatars/sealing), C (wiki lore) and D (source creation/style/canon clocks) are built.** Owner-only and remaining W2 checks stay unticked in `docs/milestones.md`.
The GM-with-tools turn (Tasks 1–8 of `docs/superpowers/plans/2026-10-29-w2-step2-gm-turn.md`) is on
`w2-gm-ui` and merges to `main`: one GM model runs a turn with engine tools, streams prose, shows
cards and choices, retcons with Undo, marks a backup model and runs a non-blocking structural check
with Fix/Dismiss. `bun run check` is green: typecheck → lint (warnings only) → **795 tests** →
`pack validate packs/fantasy-core`.

Owner-only checks still outstanding (need real hardware or keys):

- M2: ChatGPT plan sign-in end to end, and one 20-turn session on a real provider.
- M3: LAN/phone playtest from the Arch laptop and a phone.
- M5: a real-model world run and the NPC-knowledge eval.
- M8: media (images, TTS) has not been built.

## W2 A — Levels and abilities (2026-10-29)

Built test-first on `w2-levels`, merged to `main`. Plan: `docs/superpowers/plans/2026-10-29-w2-levels.md`; implementation defaults: D155.

- `core/schemas/domains/levels.ts` defines Level, Ability, proposals and the four events; `engine/reduce/levels.ts` alone handles them. Sheets default to Level 1 and empty abilities; optional effective levels are honored. Class levels remain separate.
- `engine/levels.ts`: effective levels/Δ, a native-d20 wrapper, no-roll infinity, power rating, proposal/acceptance helpers, ranked abilities, cumulative XP thresholds, breakthroughs and GM corrections. Every quantitative default is in `tuning.levels`.
- `checks.ts` applies the gap table, selected ability rank and cited exploit; opposed checks and d20 combat strikes pass actual opposition. Finite d100 checks retain their mechanics. Infinity never rolls even in legacy dice campaigns; infinite-vs-infinite stalemates. Large finite power ratings use magnitude labels instead of numeric infinity.
- `gm/tools/levels.ts` owns roll, propose_level_up, grant_ability, rank_ability, breakthrough and set_level (one index import). Explicit `/gm` gates set_level and records a Retcon with Undo. Milestones never silently grant a level.
- Lifetime XP awards in turns, chapter closes and GM changes emit every crossed level. Breakthrough success advances one configured step and applies the declared HP strain; failure keeps the level. The helper can be reused by future training/skip work.
- `POST /api/campaigns/:id/levels/:proposalId/accept` rejects stale/double acceptance, hidden actors and running-turn conflicts. GameView exposes party proposals and power rating. Strip shows Level/∞, Sheet shows abilities/ranks/costs and power, and hotbar abilities prefill the composer.
- Offline engine, tool, server, replay and render tests cover the rules and flow. Combat goldens were deliberately regenerated; only ActorCreated hashes changed for default sheet fields, with all combat outcomes unchanged.
- Validation: `bun run check` passed: typecheck, lint (existing warnings), **771 tests**, and fantasy-core pack validation. `bun run build` also passed.
- Browser verification: dedicated Levels workflow passes desktop and phone. Full `bun run test:e2e`: **45 passed, 3 existing skips**, sequential with one worker/browser at a time. Browser install/build outputs are not committed.

## W2 B — Avatars and sealing (2026-10-29)

Built test-first on `w2-avatars`, merged to `main`. Plan: `docs/superpowers/plans/2026-10-29-w2-avatars.md`; implementation defaults: D156.

- `core/schemas/domains/avatars.ts` defines `AvatarCreated`, `AvatarRunEnded`, `SealSet` and `SealBroken` plus the run projection type; `engine/reduce/avatars.ts` alone handles them. `avatarRuns`/`activeAvatarRuns`/`runForSovereign`/`endAvatarRun` in `engine/avatars.ts` read the log.
- `create_avatar` (infinite sovereign only) builds a finite actor at the chosen Level, joins it under manual control, and starts a run. An infinite avatar is refused so every avatar rolls real dice through A's Level rules.
- `ActorDied` now lives in the avatars domain: an active avatar run closes with `reason: died` and the avatar is marked dead; a linked sovereign is never marked dead. `AvatarRunEnded {completed|unsealed}` closes other runs.
- `seal` writes `effectiveLevel` and `unseal` removes it, so A's gap table and infinity rule apply while sealed. Any player-acted GM tool naming the sovereign during an active run appends `AvatarRunEnded{unsealed}`; the play screen asks for confirmation first.
- GameView carries avatar runs (id/name/Level/status), and an ∞ character's hotbar shows Seal and Send avatar. Finite characters do not see those actions.
- Offline engine/tool/render tests cover creation, real dice, death, sovereign safety, unsealing, sealing and breaking a seal.
- Validation: `bun run check` passed (typecheck, lint with existing warnings, **795 tests**, fantasy-core pack validation). `bun run build` passed. Focused Playwright (`play`, `levels`) passed sequentially on desktop and phone with one worker.

## W2 D — Source creation, style and canon clocks (2026-10-29)

Built test-first on `w2-source`; merged to `main`. Plan: `docs/superpowers/plans/2026-10-29-w2-source.md`.

- Creation optionally runs inside a named source/wiki. `llm/src/source-creation.ts` reuses C's `LoreLookup`/`LoreResearch` and global summary cache to build a source bible, starting abilities, canon NPC routines and iconic timeline events. Confidence/URL evidence is retained as lore facts and a lore record; downloaded passages never enter campaign logs.
- `Clock` supports `kind: "canon"` with an elapsed-time plan and intervention predicate. New events live only in `domains/canon-clocks.ts`, with handlers only in `reduce/canon-clocks.ts`. `engine/src/canon-clocks.ts` resolves each clock once, asserting an outcome or recording that an intervention averted it. World-mismatched, retracted and superseded evidence is excluded.
- Daily `runTicks` advances canon and records in-character NPC activity facts and private memories. Dead/inactive characters stop, and canon characters bypass random generic life events. Source clocks also advance during API downtime. E can reuse `runTicks` for full daily skips; absolute clock progress catches up across the existing daily-tick cap.
- `gm/tools/source.ts` owns `source_timeline` and `intervene_canon` (one index import). Accepted earlier-in-turn fact drafts are available for intervention validation before storage projections commit. Behind-screen timeline details stay out of GameView; witnessed outcomes gain knowledge normally.
- `CampaignSettings.style = {source, playerWords, sample}` persists through events/rebuild and enters GM instructions (`gm@2`), with `prompts/house-style.md` as the default voice. Creation shows a generated sample, editable fields and a “More like…” revision loop; Settings edits all three later.
- The GM proposes all subsystem toggles, an optional light/dark theme palette, dice, hardcore/lethality/companion death and starting Level. Every field can be overridden; starting powers use A's `AbilityGained`. Existing hunger/thirst use survival, exposure uses weather, and encumbrance uses inventory mode. Legacy explicit preset/dice/death selections keep their meaning.
- UI remains functional in the current layout for U5. Theme overrides use a validated JSON palette editor for now. Missing review/sample generation is labelled and recoverable; offline preview permits direct style edits and requires a connected model for source research or sample revision.
- Offline tests use FakeProvider plus C's recorded wiki fixture. Coverage includes clocks/interventions/world isolation/replay, NPC actions, source research, apocalypse/cosmic review proposals, style instructions, same-turn evidence, creation/settings/downtime/rebuild and desktop/phone creation flows.
- Validation: `bun run check` passed: typecheck, lint (existing warnings), **781 tests**, and fantasy-core pack validation. Build passed; full sequential Playwright: **47 passed, 3 existing skips** on desktop/phone. Combat goldens changed only the `CampaignCreated` hashes for the new default settings fields; combat outcomes are unchanged.

## W2 UI U4 — the status screen (2026-10-30)

Built on `w2-ui-menus`; plan `docs/superpowers/plans/2026-10-29-w2-ui-menus.md`, decision D157.

- One full-screen status screen replaces the separate panels: Character, Inventory, Quests, Journal, Codex, Map, Timeline and Settings. C/I/Q/J/M open it on that tab; Esc, the close control and a Back to the story button return. The tablist supports arrows, Home and End, and keeps key hints as hints rather than names.
- Inventory is a paper doll (main hand, off hand, worn armour) plus a sortable bag grid. Every item opens the same `ItemCard` the story uses. Equip, stow and sort are instant; Use, Give, Throw and Drop compose one story turn. Selling stays a shop action.
- `moveEquipment` is the new engine rule: one validated `EquipmentChanged`, with carried quantities synced from the item stacks. `POST /api/campaigns/:id/inventory/move` serves the instant actions, and GameView derives each item's location from the sheet so the bag and card agree.
- Styles are in `apps/web/src/menus.css`; item and chrome icons come from game-icons.net (CC BY 3.0), credited per icon in `NOTICE`.
- Validation: `bun run check` passed (typecheck, lint warnings only, **803 tests**, fantasy-core pack validation). Build passed. Full sequential Playwright with one worker: **54 passed, 4 existing skips**; the new menus workflow passes desktop and phone including axe WCAG A/AA.
- U5 (home and creation) and U6 (Cockpit/Chat presets) remain.

## W2 C — Lore from wikis (2026-10-29)

Built test-first on `w2-lore`; merged to `main`. Plan: `docs/superpowers/plans/2026-10-29-w2-lore.md`.

- `llm/src/lore/mediawiki.ts`: injected-fetch MediaWiki search, Wikipedia extracts and Fandom wikitext parsing; shared 1 request/s queue and versioned user agent. `defaultTuning.lore` owns limits.
- `storage/src/lore-cache.ts`: global `WYRD_HOME/lore-cache/<wiki>/<title-hash>.json`, summaries only, no expiry/pruning. Corrupt entries recover on the next write.
- `llm/src/lore/{summarise,research}.ts`: worldGen structured summaries, copying guard (including fallback), cache/search/fetch, low-confidence model fallback without fake citations. IO/provider errors are sanitized.
- `gm/tools/lore.ts` owns `lookup_lore` (one index import). Registry/dispatcher/loop now await async tools; research progress arrives before IO. Server enables research outside offline preview and provides a fixture-injection boundary.
- Known/public current-world canon wins, including player corrections through research aliases. Summaries become `source: "lore"` facts with confidence and source-URL evidence, plus knowledge events. Only `domains/lore.ts` / `reduce/lore.ts` define/handle the new `LoreRecorded` event; replay retains world-scoped provenance in `flags.loreRecords`.
- Codex includes researched concepts and editable notes. Source/confidence metadata lives on stored facts and tool results; dedicated citation UI can follow later.
- Tests are offline: sanitized recorded Wikipedia envelope, documented Fandom/search shapes with original fixture prose, FakeProvider, fake clock, temporary cache directories, and server/GM/Codex/rebuild coverage. Live Wikipedia worked during fixture recording; live Fandom returned HTTP 402 here, so real Fandom success still needs checking on the owner's host.
- Validation: `bun run check` passed (typecheck, lint with existing warnings, **749 tests**, fantasy-core pack validation).
- Architecture checks now resolve relative imports against package roots; nested imports within llm pass, actual package escapes still fail. No browsers were launched.

## What M7 added (breadth)

- **Settings and presets** (`core/presets.ts`, `apps/server/src/campaign-settings.ts`,
  `apps/web/src/CampaignSettings.tsx`): Story/Standard/Simulation/Custom, live subsystem toggles,
  locked dice/progression refused with 409 and greyed in the UI.
- **Classes and all four progression modes** (`core/schemas/classes.ts`, `engine/classes.ts`,
  `packs/fantasy-core/classes.yaml`; six classes × ten levels).
- **d20 legibility**: `MechanicsLine.roll` + `GameView.resolution`; d20 campaigns read
  die + modifier vs DC, d100 text is unchanged.
- **Living World and downtime** (`engine/world/ticks.ts`, `engine/downtime.ts`): weekly faction
  goals and news, NPC life events, festivals, job board; train/craft/work/research/carouse/recover
  through `POST /api/campaigns/:id/downtime`.
- **Spellcasting plugin** (`core/schemas/spellcasting.ts`, `engine/plugins/spellcasting.ts`,
  30 spells in `packs/fantasy-core/spells.yaml`): strain, school checks, effects, miscasts, parser
  spell list, sheet display.
- **Injury completion** (`engine/injury/healing.ts`): healing over days, infection, fracture
  setting, permanent injuries, short/long rests; every toggle respected.
- **Inventory and money** (`engine/inventory.ts`, `engine/economy.ts`, `apps/web/src/Inventory.tsx`):
  encumbrance bands, equip/worn slots, ammo spending/recovery, durability, a starting shop with
  buy/sell/haggle, 50-coin purse.
- **Content floor**: 44 talents, 30 weapons, 12 armour, 82 gear, 35 creatures, 30 spells, six
  classes; guarded by `packages/packs/test/content-floors.test.ts`.
- **History**: Timeline tab, rewind/fork, branches, named saves, `.wyrd` export/import and daily
  backups (`packages/storage/{history,export,backups}.ts`, `apps/server/src/history.ts`).
- **Content dials** injected into every prose role and enforced by the canon guard.
- **Pack themes**: `packs/fantasy-core/theme.yaml` → `GameView.theme` → CSS variables, light/dark,
  contrast-tested.
- **Acceptance tests**: `apps/server/test/m7-acceptance.test.ts`, `packages/engine/test/m7-toggles.test.ts`,
  `packages/engine/test/living.test.ts`, `packages/engine/test/{spellcasting,injury-healing,inventory,downtime}.test.ts`.

## Map of the code

| Package | What's there |
|---|---|
| `packages/core` | RNG/IDs/stable JSON, `tuning.ts` (every number), zod schemas: settings, sheet, events (domain modules under `schemas/domains/`), pack content, spells, inventory, survival, history, web views, calendar, downtime, recipes |
| `packages/engine` | checks and d100/d20 resolution, reducer (`reduce.ts` + `reduce/<domain>.ts`), combat and injury, progression and classes, exploration/travel, world ticks, survival, downtime, inventory/economy, spellcasting |
| `packages/storage` | campaign.db, event store, branches/rewind/saves, snapshots, rebuild, `.wyrd` export/import, daily backups |
| `packages/packs` | YAML loader → namespaced `CompiledPack` (spells, classes, recipes, economy, theme, calendar, loot, naming), lints, scaffold |
| `packages/llm` | parser/narrator/guard prompts, content-policy assembly, Pipeline, providers, offline stand-ins |
| `packages/memory` | context assembler, retrieval, summaries, canon guard and content-dial enforcement |
| `apps/server` | Hono API: auth, creation, turns/SSE, settings, timeline/history, downtime, shop, party, world journal/codex/map, providers |
| `apps/web` | React client: Play, Sheet, Inventory, Party, Combat, Journal, Codex, Map, Timeline, Campaign settings |
| `apps/cli` | `bun run wyrd …` |
| `packs/fantasy-core` | full content floor, spells, classes, economy, recipes, theme, two worlds |

## How to add things

- **A new event:** add the payload to the matching `core/schemas/domains/<domain>.ts`, then its
  handler to `engine/src/reduce/<domain>.ts`. The domain modules are spread into `events.ts` and
  `reduce.ts`; a missing handler is a compile error and a registry test keeps them in sync.
- **A tuning number:** `Tuning` + `defaultTuning` in `core/src/tuning.ts`.
- **A condition:** `engine/src/conditions.ts`.
- **A pack file:** add it to `CONTENT_FILES` in `packages/packs/src/loader.ts` (list-of-entries) or
  load it like `theme.yaml`/`economy.yaml` (single object).
- **Golden fixtures:** change only on purpose with
  `WYRD_UPDATE_GOLDEN=1 bun test packages/packs/test/combat/golden.test.ts`, then review the diff.

## Known gaps (deliberate, recorded in `docs/decisions.md`)

- Wealth-level auto-purchases and seasonal price drift are data-ready but only haggling is
  enforced (D118).
- Spirit casting is wired in exploration; a dedicated combat `cast` action is not in the combat
  action union yet (D116).
- Only the pack's first shop opens (at campaign start); per-settlement shop generation is future
  work (D118).
- Themes exist for fantasy-core; other packs still use the app default palette (D119).
- The Playwright e2e suite (`bun run test:e2e`) is not part of `bun run check`; run it separately after UI changes. The current A run passes 45 tests with 3 existing skips (one worker, sequential browsers).

## Next milestone

**W2 — Wyrd 2.0** (before M8). The owner played M7 and found it lacking next to their own ChatGPT RPG sessions, and a 72-question interview on 2026-10-29 redesigned the game.

Step 2 and step 3 A/B/C/D are done. Next: F delegation, and E full time skips/watch list (after F). A exports the level/check/breakthrough helpers; C exports `LoreResearch`. Infinite observe scope remains in E.

Read these first:
- the spec: `docs/superpowers/specs/2026-10-29-wyrd-2-design.md`
- the decisions: D129–D144 in `docs/decisions.md`
- the plans in `docs/superpowers/plans/`:
  - `2026-10-29-w2-roadmap.md`: order, owners and workstreams
  - `2026-10-29-w2-step1-fixes.md`: detailed, ready to execute
  - `2026-10-29-w2-step2-gm-turn.md`: detailed, ready to execute (Claude builds it)

In short:
- One GM model runs each turn and calls engine tools.
- Source-story campaigns are researched from wikis.
- A cosmic Level scale (1–20 plus ∞) with avatars and sealing.
- Time skips with a watch list, and Ari as a loyal companion with delegation.
- UI 2.0 follows Caves of Qud's modern UI plus ChatGPT-style cards.
- "Done" is the owner's 20-turn test on their imported Ethan Hunt + Ari campaign.

**Machine limit:** run only one browser or Playwright process at a time; the owner's 12 GB laptop crashed running several.

## Model setup for Wyrd 2.0 (owner)

1. Sign in with ChatGPT on the host PC: **Settings → Models → Connection → Continue with ChatGPT**
   (the redirect goes to `127.0.0.1`, so it must happen on the PC running the server).
2. List the plan's model ids with `bun run wyrd models chatgpt-plan`, then put the id you want in
   the **ChatGPT plan (prose)** slot in Settings → Models — that is `models.plan` in the provider
   config: `{ "provider": "chatgpt-plan", "model": "<id>" }`.
3. Set the routing preset from **One model for everything** to **Balanced**. Prose roles (narrator,
   npcDialogue, worldGen, sessionZero) then prefer the plan; parser, guard and summarizer prefer
   DeepSeek (see `presetRouting` in `packages/llm/src/router.ts`).
4. Restart the server (`bun run start`).

`ModelServices.ready()` (`apps/server/src/models.ts`) rejects any route whose model starts with
`PICK-WITH`, so save only after a real model id is chosen.

After W2: **M8 — Media** (see `docs/spec/10-media.md`): image adapters (ComfyUI/Qwen-Image 2.1, OpenAI), portraits and scene-art consistency, TTS adapters (local, Deepgram), voice casting, segment playback and the GPU mutex.

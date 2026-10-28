# Handoff notes

Working notes for whichever agent picks this up next. Read `AGENTS.md` first, then this file.
Delete this file once its notes are no longer useful.

## Status (2026-10-28)

**M1 — Engine core is done** on branch `m1-engine-core` (PR #1). Every acceptance box is ticked,
including CI green on Linux and Windows. Windows needed LF line endings (`.gitattributes`) and tests
that close SQLite files before deleting temp folders; keep both in mind for new tests.

`bun run check` runs everything locally: typecheck → lint → 147 tests → `pack validate`.

## Map of the code

| Package | What's there |
|---|---|
| `packages/core` | xoshiro128** RNG, injectable ULIDs, stable JSON, `tuning.ts` (every number), zod schemas: settings, sheet, check, events (registry in `schemas/events.ts`), pack content |
| `packages/engine` | skills + derived stats, `conditions.ts`, `resolution/` (d100, d20), `checks.ts` (prepare/resolve/push/opposed), `luck.ts`, `reduce.ts`, `settings.ts` (locks), `campaign.ts`, `creation.ts` (sheet builder + point-buy validator) |
| `packages/storage` | `CampaignStore`: campaign.db schema/migrations, append (one transaction), branches/rewind, saves, gzip snapshots, rebuild, state hash. Depends on `core` only; the reducer is injected |
| `packages/packs` | YAML loader → namespaced `CompiledPack`, reference resolution, balance lints, `pack new` scaffold |
| `apps/cli` | `bun run wyrd …` (see `--help`) |
| `packs/fantasy-core` | 4 ancestries, 6 archetypes, arcana/spellcasting(4 schools)/faith, 12 talents, 7 weapons, 4 armour, 15 gear |
| `test/architecture.test.ts` | Enforces the spec's dependency rules and engine purity |

## How to add things

- **A new event:** add its payload schema to `eventPayloadSchemas` in `core/src/schemas/events.ts`, then a handler in `engine/src/reduce.ts` (a missing handler is a compile error, and a test checks the registry and reducer match). If it feeds a SQL projection, handle it in `storage/src/projections.ts` and add the table to the migrations (append a new migration; never edit v1).
- **A tuning number:** add it to `Tuning` and `defaultTuning` in `core/src/tuning.ts`; never hard-code it.
- **A condition:** `engine/src/conditions.ts` (`onCheck` covers the bearer's own checks only; effects on attackers and AP are M4).

## Deferred to later milestones (deliberately)

- Luck rerolls and pushes on **opposed** checks: M4, with attack vs Dodge (D47).
- Condition effects on attackers, AP loss (Stunned/Dazed), Bleeding/Burning ticks: M4.
- Extended tasks / progress clocks (`ClockAdvanced`): the state has an empty `clocks` slot.
- Progression (XP, marks): M6/M7. Spellcasting plugin and class mode: M7.
- More fantasy-core content (~40 talents, ~25 weapons, creatures, economy, calendar…): M4–M7.

Every M1 implementation choice is recorded in `docs/decisions.md` as D41–D51.

## M2 — The model loop (branch `m2-model-loop`, stacked on `m1-engine-core`)

### Windows host playtest fix (2026-10-28)

The browser launcher in `apps/cli/src/main.ts` used `cmd /c start`, which split the OAuth URL at
`&` and opened only `?response_type=code`. This caused OpenAI's `missing_required_parameter`
page. `apps/cli/src/browser.ts` now uses an encoded PowerShell command with a literal URL on
Windows. `apps/cli/test/browser.test.ts` exercises the real Windows parser with `Start-Process`
replaced by an argument capture, including apostrophes and shell metacharacters. No browser or
model calls happen in these tests. The owner has confirmed real sign-in works. Real refresh/rotation
and the 20-turn session review remain outstanding, so the M2 real-provider acceptance boxes stay open.

### DeepSeek playtest and terminal feedback (2026-10-28)

The first real turn resolved through ChatGPT after DeepSeek returned `invalid_output` and then
`bad_request`. A standalone parser probe reproduced HTTP 400: `Thinking mode does not support
this tool_choice`. The generic adapter had silently stripped `tool_choice` before retrying.
DeepSeek enables thinking by default, so the playtest config and new CLI example configs now
explicitly set `thinking: "disabled"`. The provider schema and adapter pass this optional extension
through; other compatible servers omit it by default. A live parser + repair probe with this setting
completed without the HTTP rejection and did not append campaign events. Invalid model plans still
go through the existing engine validation/repair path; occasional invalid JSON still falls back safely.

The terminal now prints `Working on your turn…` as soon as a turn is accepted and prints fallback
notices immediately, instead of buffering them until the entire narration/guard pass finishes.
Restart the running play process to load these changes; the campaign remains in its existing DB.

### Intermittent malformed parser JSON (2026-10-28)

The owner still saw `invalid_output` on "Walk up to wenna" after the mode fix. Four isolated live
parser probes of that input returned valid action JSON; no campaign events were appended. This
failure is intermittent, rather than an always-rejected request. The adapter marked malformed JSON
as retryable, but the router did not include it among same-provider retries. The router now honors
that flag with its existing one-retry budget before using the fallback. Contract tests exercise
malformed streamed arguments followed by valid JSON, verify usage for both attempts, and prove
two malformed replies fall back without looping. This does not guarantee that DeepSeek will always
produce valid output; persistent failure still correctly uses ChatGPT. Restart play to load the fix.

All seven build steps are done and committed (A llm foundation, B canon/turn events, C exploration
actions, D context assembler, E turn pipeline, F test world + `wyrd play`, G real adapters).
M2 implementation choices are D52–D63 in `docs/decisions.md`.

### Acceptance status

- [x] **FakeProvider end to end in CI** (repair → clarification, guard regeneration): `packages/llm/test/pipeline.test.ts`, green on Linux and Windows (PR #2).
- [ ] **Continue with ChatGPT on the host PC; refresh and rotation; mocked 429 falls back without loops.** The mocked parts are tested (`packages/llm/test/chatgpt.test.ts`). The owner must run `bun run wyrd connect chatgpt` on the main PC, then play a few turns, then (after an hour, or by editing `expires_at` in the record) play again to exercise a real refresh.
- [ ] **20-turn session with real DeepSeek + ChatGPT plan** in Ashford Ferry, every blocking guard issue regenerated away or flagged. Owner-only; see "Real play" below. Run it with `--input` lines or interactively and keep the transcript.
- [x] **Usage records for every call**: the router writes one per attempt; the CLI appends them to `WYRD_HOME/usage.jsonl`.

### Real play (owner)

```sh
bun run wyrd config init                                  # writes WYRD_HOME/config.json (~/.wyrd or %APPDATA%\Wyrd)
printf %s 'sk-…' | bun run wyrd secret set deepseek.key   # keys never go in the config file
bun run wyrd connect chatgpt                              # on the PC that runs Wyrd
bun run wyrd models chatgpt-plan                          # pick slugs, then edit "models" in config.json
bun run wyrd models deepseek
bun run wyrd sheet build --archetype cutpurse --name Wren --ancestry halfling --out wren.json
bun run wyrd campaign create ashford.db --name "A Night at Ashford" --pc wren.json --world ashford-ferry
bun run wyrd play ashford.db                              # or --offline to try it without keys
```

VERIFY before trusting: the DeepSeek base URL and model ID (`wyrd models deepseek` lists what the key can use), and the ChatGPT refresh request fields (D61). If the plan route rejects a parameter, the adapter strips what `error.param` names; anything else shows up as a `bad_request` with OpenAI's message.

### Known gaps to pick up later

- Spending caps (spec 09) aren't implemented; nothing in M2 needs them.
- The guard is v1 only (contradictions, state claims, new entities/facts). Secrets, witnesses, objectives and approval are guard v2 (M5).
- The offline provider's keyword parser is deliberately dumb; it exists for demos and tests.

### M3 — Web UI v1 (feature/m3-web-ui)

The web implementation is runnable. See `docs/m3-web.md` for commands, supported flows, recovery,
and current boundaries. The owner is independently playtesting M2 in `../m2-playtest`; do not reset
that checkout or its campaign, and do not use the owner's real credentials for automated tests.

- `apps/server`: Hono API, host-only first-run setup/account operations, passcode sessions, quick
  starts, filtered GameView, persistent idempotent turn jobs, resumable SSE, rerolls, model settings,
  connection status and usage. CSP style nonces support the dialog primitives without unsafe-inline.
- `apps/web`: React/Vite home, pitch-first creation, play, mechanics, clarification and canon cards, compact
  and expanded sheets, phone layout, reading preferences and Models/Connection/Usage settings.
- `storage/AppStore`: forward-only app.db migrations for sessions, campaign registry, request/stream
  journals, settings, provider/routing tables and usage. Config imports once; JSONL usage imports
  idempotently. Live attempts each get a separate record even when their contents are identical.
- Shared HTTP/provider schemas live in core. The web dependency check prohibits server/IO imports.
- Browser tests use a fresh temp home and FakeProvider, covering desktop, phone, 320px/tablet layout,
  a clean console and automated WCAG checks. An auth-guard mutation was caught by the regression test.
- Latest checks: `bun run check` (263 tests), production build, 10 Playwright cases and `bun audit`
  pass locally on Windows. CI now includes the browser suite and builds on Linux/Windows, but its
  new remote run has not been observed yet.

M3 is NOT fully accepted: the physical laptop/phone LAN check is still unticked. M2's real refresh
and 20-turn review also remain unticked. Guard v1 remains the M2 implementation. Canon retcon/edit,
combat, Journal/Map/Inventory/Party, media, and portable CLI-campaign import follow later milestones.
The browser creates its own campaigns; it does not modify the owner's CLI campaign.

Next: review the owner's M2 playtest when they report completion; perform the M3 LAN/device check,
then begin M4 combat from its spec. D66–D69 record the web implementation choices.

### Owner corrections included in M3

Creation now asks for campaign name, optional character name (both initially blank), and an adventure/
world pitch before any origin/background choices. `llm/generateWorld` calls the configured worldGen
role with a bounded proposal schema. `packs/compileGeneratedWorld` compiles setting-specific content
and canon-ready opening data; `engine/allocateStartingTraining` owns point allocation under tuning.
`POST /api/world-drafts` persists a server-side draft; `POST /api/campaigns` starts it after review,
validating choices and freezing the pack. Repeated starts return the existing campaign. Draft previews
and GameView exclude NPC secrets. The old Ashford fixture is explicit `/api/campaigns/quick-start`.

Offline preview uses a clearly labelled fixed sci-fi example. Tests exercise generated proposals via
FakeProvider, including different genres, invalid skills/priorities/positions, draft restart, validation
and private-data exclusion. The real worldGen call has not been evaluated with the owner's providers.
The seven attributes remain unchanged mechanically and now fill two rows (three physical, four
mental/social). Full multi-region generation, lazy expansion and session zero remain M5/M6.

### Reading improvements

Dialogue resolves a supplied name or canonical ID instead of replacing names with "A voice".
GameView includes display names only for speakers referenced in visible narration, keeping old
dialogue labels working outside the current room without returning the entire NPC registry.
`apps/web/src/Narration.tsx` safely renders text, speech and strong emphasis. Known character/place
names are emphasized automatically; the `narrator@2` contract allows sparse `**bold**` clues and
important objects. Renderer and pipeline regressions plus desktop/phone flows pass; a deliberately
broken highlighting condition was caught. Real-provider style evaluation remains for owner play.
Hover/focus/tap detail cards are planned with M5 Codex/knowledge, documented in spec 13 and D70.

### Pending owner request: setting-aware address

Removing "traveller" from clarification/welcome copy was only a temporary fallback. The owner
explicitly wants a setting- and character-appropriate address (e.g. "Lantern" for their Green Lantern
character), generated from established world/character context, persisted, player-correctable and
updated with identity changes. This remains unimplemented and is recorded in the M5 roadmap and
spec 13, including cross-genre acceptance and protection against revealing secret identities.

## M4 — Combat (branch `m4-combat`, stacked on `feature/m3-web-ui`)

**M4 is built: steps A–G are done and every acceptance box is ticked.** Step A (damage and injury) is below; steps B–G (combat state, actions, AI, endings, pipeline, panel) followed in three commits. Decisions are D80–D90.

Where combat lives:

- `packages/core/src/schemas/combat.ts`: `CombatState`, `CombatAction` (the parser's union in a fight), `CombatView` (browser), combat events.
- `packages/engine/src/combat/`: `flow.ts` (start, turns, death clocks, morale, endings), `actions.ts` (validation with codes and alternatives, resolution, `legalActions`), `attack.ts` (attack → Dodge/Parry → `resolveHit`), `ai.ts` (utility AI), `turn.ts` (`runCombatTurn`, `startFight`, `autoFight`), `view.ts`, `legacy.ts`.
- `packages/engine/src/turns.ts`: `validateTurn`/`resolveTurn` dispatch exploration vs combat; the pipeline calls only these.
- `packages/llm`: combat parser tools and digest, `makeTurnContext`, two-paragraph combat narration (`narrator@3`, `parser@2`), offline combat parsing.
- `packs/fantasy-core`: `creatures.yaml` (11), `bodyplans.yaml` (quadruped), `worlds/tavern-brawl`.
- Tests: `packages/packs/test/combat/` (fights, golden scenarios in `golden/`, tactics, defeat, hardcore death, Legacy), the API brawl in `apps/server/test/app.test.ts`, and `e2e/combat.e2e.ts`.
- Golden files change only on purpose: `WYRD_UPDATE_GOLDEN=1 bun test packages/packs/test/combat/golden.test.ts`, then review the diff.

Still to check with real models (owner): the parser mapping free text to combat actions on DeepSeek, and the two-paragraph narration on the ChatGPT plan. Quick start into the brawl: `POST /api/campaigns/quick-start` with `{"name":"Brawl","characterName":"Wren","archetype":"hunter","world":"tavern-brawl"}`.

Known gaps: Luck rerolls on attacks (D83), companion directives (M6), chases (M5), loot tables (M5), initiative groups/Delay/Ready/Hide/items/spells (D82).

**Step A (damage and injury).** It is pure engine work plus core schemas and pack data.

What step A adds:

- Events in `packages/core/src/schemas/events.ts` (reduced in `packages/engine/src/reduce.ts`): `HitResolved`, `HpChanged`, `WoundInflicted`, `WoundWorsened`, `EquipmentChanged`.
- `resolveHit` in `packages/engine/src/injury/hit.ts`: attack to damage, armour, wound, Down and lethal checks.
- `bleedTick` in `packages/engine/src/injury/bleeding.ts`: bleeding at the end of a turn, and END rolls at 0 HP.
- `woundModifiers` in `packages/engine/src/injury/penalties.ts`: wound penalties on checks.
- `startingEquipment` in `packages/engine/src/equipment.ts`: the sheet's equipment from the archetype kit.

First aid and the death clock now exist (step C); out-of-combat bleeding per minute is still open. Infection, fractures, healing and permanent injuries are M5 (D71).

The plan is `docs/superpowers/plans/2026-10-28-m4-roadmap.md` (steps A–G). The decisions are D71–D79 in `docs/decisions.md`.

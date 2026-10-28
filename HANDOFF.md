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

Build order (each step is its own commit):

- [x] **A. llm foundation** — `packages/llm`: `ChatProvider` interface (`types.ts`), `FakeProvider`, `collect`, `RoleRouter` (fallback chains, retry transient once, bench a provider on `usage_limit`/`not_eligible`/`auth` instead of looping, one usage record per attempt), presets, price table, `CassetteProvider` (record/replay keyed by request hash, secrets scrubbed). `UsageRecord`/`Role` schemas live in `core`.
- [x] **B. Canon + turn events** — `EntityCreated`, `FactAsserted`, `SceneOpened/Closed`, `EntityMoved`, `TurnStarted`, `TurnCompleted`, `NarrationCommitted/Rerolled` (`core/src/schemas/canon.ts`). Engine tracks scene presence (`GameState.scene.positions`); storage projects `entities`, `facts`, `turns` (migration v2); `CanonQueries` reads them.
- [x] **C. Exploration actions** — `core/src/schemas/actions.ts` + `engine/src/exploration.ts`: `validatePlan` (stable codes + legal alternatives) and `resolvePlan` (re-validates each step, stops mid-plan, emits events + `Resolution` with required beats).
- [x] **D. Context assembler v1** — `packages/memory/src/assembler.ts` (parser/narrator/guard).
- [x] **E. Turn pipeline** — `packages/llm/src/pipeline.ts` + `prompts/`: parse → validate → repair (max 2) → clarify → resolve → narrate → guard v1 (contradictions, state claims, new entities) → regenerate once → flag → commit one transaction; reroll; mechanical-summary fallback.
- [x] **F. Test location + terminal loop** — `packs/fantasy-core/worlds/ashford-ferry/world.yaml`, world loader in `packs`, `wyrd play` in the CLI.
- [ ] **G. Real adapters** — openai-compatible (DeepSeek/Ollama), anthropic, chatgpt-plan (SIWC OAuth PKCE + Responses API), secrets in `WYRD_HOME/secrets/` with atomic writes; mocked-HTTP contract tests. Everything marked VERIFY in spec 09 must be checked against official docs.

Try it offline (no keys): `bun run wyrd sheet build --archetype cutpurse --name Wren --out /tmp/wren.json`, then `bun run wyrd campaign create /tmp/a.db --name Ashford --pc /tmp/wren.json --world ashford-ferry`, then `bun run wyrd play /tmp/a.db --offline`. Real providers: `apps/cli/src/providers.ts` (`loadRouterFromConfig`) is a stub until step G.

Acceptance 1 (FakeProvider end to end, repair → clarification, guard regeneration) is covered by `packages/llm/test/pipeline.test.ts`; tick it once CI is green on the M2 PR.

Acceptance 2 and 3 (real ChatGPT sign-in, a 20-turn session with real DeepSeek + ChatGPT) need the owner's accounts on the host PC; the code can be finished and tested offline, but those boxes are ticked only after the owner runs them.

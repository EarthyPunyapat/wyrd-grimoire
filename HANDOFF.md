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

### Next: M3 — Web UI v1

Read `docs/milestones.md` (M3), specs 13 and 14, and `docs/design/`. The pipeline's `TurnStreamEvent`s already match the SSE event names in spec 08, and `TurnPipeline` is the thing the Hono server wraps. Move `WYRD_HOME/config.json` and `usage.jsonl` into app.db then (D59).

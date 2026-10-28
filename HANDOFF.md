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

## Next: M2 — The model loop

Read `docs/milestones.md` (M2) and specs 07, 08 and 09. Start with `packages/llm`: FakeProvider and the cassette format first, so the pipeline can be built and tested offline. Anything marked `VERIFY:` in spec 09 (ChatGPT plan / Responses API details) must be checked against official docs before it is coded.

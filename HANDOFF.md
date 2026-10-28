# Handoff notes

Working notes for whichever agent picks this up next. Read `AGENTS.md` first, then this file.
Delete this file once M1 is merged and its notes are folded into the spec or decisions log.

## Current milestone: M1 — Engine core (branch `m1-engine-core`)

### Done
- Bun workspace: `packages/{core,engine,packs,storage}`, `apps/cli`. Root `tsconfig.json` (strict, `tsc -p .`), Biome lint (code + JSON only; `docs/` excluded on purpose so it never reformats the spec).
- `core`: xoshiro128** RNG (`rng.ts`), injectable ULID factory (`ids.ts`), stable JSON, tuning defaults (`tuning.ts`), zod schemas for settings, sheet, checks, events, pack content.

### Next (in order)
1. `engine`: derived stats, skill values, conditions → modifiers, d100 + d20 modules, check pipeline (push, Luck reroll), opposed checks, reducer + initial state, settings-lock validation, point-buy validator.
2. `storage`: `campaign.db` (meta, pack_snapshot, events, branches, saves, snapshots, actors projection), append, rewind/fork, snapshots, rebuild, state hash.
3. `packs`: YAML loader, namespacing, validator (schema, references, balance lints), `packs/fantasy-core`.
4. `apps/cli`: `bun run wyrd` — roll, sheet validate, campaign create/append/rewind/rebuild/hash, pack validate.
5. CI workflow, dependency-rule test, tick M1 boxes in `docs/milestones.md`.

### Choices made so far (record in docs/decisions.md before merging)
- Dev CLI lives in `apps/cli` (not in the spec's layout).
- Last check per actor is kept in engine state (`lastChecks`) so push/Luck can validate against it.
- `spellcasting` plugin is M7, so `fantasy-core/pack.yaml` lists no plugins yet.

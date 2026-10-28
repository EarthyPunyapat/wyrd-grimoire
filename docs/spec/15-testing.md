# 15 — Testing and evals

Two kinds of verification:

- **Tests** are deterministic, run offline in CI, and never call a real model.
- **Evals** measure model-dependent quality with real providers. They cost money or plan usage and run on demand (or nightly on the owner's machine).

## Engine (pure, deterministic)

- **Unit tests** for every rule: checks, degrees, boons/banes, opposed checks, pushing, Luck, every condition, AP costs, hit locations, armour, wounds by location and severity, bleeding, infection, fractures, healing, encumbrance, progression costs and thresholds.
- **Equivalence test:** for every skill value 5–95 in steps of 5, d20 base success probability equals d100's at Normal difficulty (exact arithmetic, not sampling).
- **Distribution tests:** Monte Carlo with fixed seeds for critical rates and damage distributions, within tolerances.
- **Property tests** (fast-check) on reducers:
  - folding the same events always produces the same state;
  - snapshot + replay equals full replay;
  - rewinding to seq N and replaying the same events reproduces the original branch.
- **Golden combat scenarios:** seeded fights (e.g. PC + companion vs three bandits and an archer in the tavern zone map) must produce the exact recorded event sequence. Any rules change that alters a golden file must be deliberate and reviewed.
- **Validation tables:** for each action type, legal and illegal cases with the exact error codes.
- **AI tactics:** scenario tests asserting sensible choices (takes cover when shot at from range, flees on failed morale, focuses the downed-but-dangerous target on Hard).

## Packs

- `fantasy-core` and every example pack pass `pack validate` in CI.
- Reference integrity and balance lints run as tests.

## Memory

- **Context assembler:** never exceeds a role's budget; sections 1–4 are byte-identical across turns when inputs are unchanged (prompt-cache contract); trimming order is correct.
- **Visibility:** narrator prompts never contain `secret` facts unknown to the PC; NPC prompts never contain memories from other NPCs' namespaces.
- **Rumour spread:** deterministic under a seed; `reportsTo` edges spread crimes faster than casual edges.
- **Retrieval:** on a synthetic campaign fixture, known queries return the expected items in the top 10 (offline, using a fake deterministic embedder plus FTS).

## LLM layer

- **FakeProvider:** scripted responses selected by role and request matchers. Used for development without API keys and for all CI tests.
- **Record/replay cassettes:** run a real provider once with recording on; responses are stored keyed by a hash of the normalised request (secrets scrubbed) and replayed offline afterwards.
- **Adapter contract tests** with mocked HTTP: streaming parsing, tool-call assembly, usage reporting, SIWC token refresh with rotation (and atomic storage), the `429` usage-limit error triggering fallback without retry loops, `403` not-eligible messaging, unsupported-parameter stripping.
- **Pipeline tests** (FakeProvider): repair loop then clarification; plan stops mid-way when a target dies; guard blocking → one regeneration → flag; reroll leaves dice untouched; turn transaction rolls back cleanly on failure.

## Evals (real models)

Stored under `evals/`, each with a dataset, a runner, and a results log keyed by provider, model and `promptVersion`.

| Eval | Dataset | Pass bar |
|---|---|---|
| Parser | ≥ 200 player inputs across modes, with expected action plans | ≥ 90% exact on action types and targets; difficulty within one step |
| Clarification | Ambiguous inputs that should trigger questions, and clear ones that shouldn't | ≥ 90% correct ask/don't-ask |
| Guard | Narrations with injected contradictions, state claims, secret leaks and line violations | Recall ≥ 0.95 on blocking issues; precision ≥ 0.85 |
| Narrator | Resolutions with required beats | 100% beats present (checked by the guard model plus string checks); no numbers in prose; no invented outcomes |
| Memory | A long synthetic campaign (≥ 1,000 turns) with recall questions | Recall@10 ≥ 0.9 |
| NPC knowledge | NPC conversations probing things they shouldn't know | < 1 leak per 200 lines |

Changing a role's prompt or default model requires running that role's eval and recording the result.

## End to end

Playwright against the real server with FakeProvider:

- Create a campaign with quick start; take exploration, dialogue and combat turns.
- Click a clarification option; resolve a guard flag; reroll narration.
- Rewind and switch branches; confirm hardcore refuses rewind.
- Settings: locked fields refused; preset → custom.
- Phone viewport: bottom tabs, combat sheet, input.

## Performance

- Engine resolve ≤ 50 ms per turn on the main PC.
- Opening a campaign with 50,000 events ≤ 2 s (snapshots).
- Retrieval ≤ 150 ms per query at 100,000 indexed items.

## CI (GitHub Actions)

Typecheck → lint → unit and property tests → pack validation → end-to-end (FakeProvider). No secrets, no real model calls.

## Definition of done (every task)

Code + tests + typecheck clean + relevant spec section still accurate (update the spec in the same change if behaviour deliberately changed, and add a line to [decisions.md](../decisions.md)).

# Evals (spec 15)

Real-model evals run on the host with the owner's configured providers; they never run in CI.
Each appends a line to its `results.jsonl` keyed by provider, model and prompt version.

| Eval | Command | Pass bar |
|---|---|---|
| NPC knowledge | `bun evals/npc-knowledge/run.ts --turns 40` | < 1 leak per 200 NPC lines |

Offline evals run with `bun test` in CI:

- Memory recall over a 1,000-turn synthetic campaign: `packages/storage/test/memory-eval.test.ts` (recall@10 ≥ 0.9).
- Retrieval fixture with realistic queries: `packages/storage/test/retrieval.test.ts`.
- Who-knows-what (a lie reaching the liar's target's superior): `packages/engine/test/world.test.ts`.

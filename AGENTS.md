# AGENTS.md

Wyrd Grimoire is a solo, any-genre LLM role-playing engine: a TypeScript (Bun) web app where **code owns the rules and the truth** and language models only parse player intent and tell the story. The spec in `docs/` is the source of truth for what to build.

## Where things are

- `docs/milestones.md` — the build order and acceptance checks. Read it at the start of every task to find the current milestone.
- `docs/spec/00-overview.md` — glossary and a map of every spec file. Read the spec files the current milestone lists before writing code.
- `docs/decisions.md` — every design decision and why. Read it when a design choice looks wrong or unsettled: decisions there are settled, so raise a concern with the owner instead of changing course.
- `docs/design/` — UI mockups; the visual target for milestone 3 onward.
- Once code exists, `package.json` scripts and `--help` output are authoritative for commands.

## How to work a milestone

1. **Locate:** the current milestone is the first one in `docs/milestones.md` with unticked acceptance boxes.
2. **Read:** every spec section that milestone lists, plus the glossary.
3. **Build** in small, tested steps. Engine rules are written test-first (red → green).
4. **Done** means all of: every acceptance box for the milestone passes and is ticked in `docs/milestones.md`; typecheck, lint, tests and `pack validate` are green; any behaviour that deliberately differs from the spec is updated in the spec in the same change, with a line added to `docs/decisions.md`.

## Invariants

These hold in every change:

- **Pure engine.** `packages/engine` is deterministic: randomness only from the seeded RNG in `core`, time only from game state, no network, filesystem or clock. IO lives in `storage`, `llm` and `media`.
- **Event log is truth.** Every state change is an event; everything else is a projection that `rebuild` can recreate from the log.
- **Canon.** Model output enters the game only as zod-validated proposals the engine accepts and turns into events. The narrator describes resolved outcomes; it never decides them.
- **Knowledge layers.** Narrator prompts and the browser's GameView receive only what the PC knows or can perceive; NPC prompts receive only that NPC's mind. Secrets stay server-side.
- **Config over constants.** Model names, endpoints, prices and every tuning number come from config. Anything marked `VERIFY:` in the spec is checked against the provider's official docs before it is coded.
- **Secrets** (API keys, OAuth tokens, the passcode) stay in `WYRD_HOME/secrets/`, out of logs, errors and the browser.
- **Original content.** Pack text, stat blocks and names are written fresh, using generic folklore concepts.
- **Tests stay offline.** CI uses FakeProvider and recorded cassettes; real model calls belong to evals.

## Owner's setup (shapes defaults)

- Server runs on the owner's main PC (RTX 5070 Ti, 16 GB); they also play from an Arch Linux laptop and a phone over LAN or Tailscale.
- Text models: ChatGPT Plus via Sign in with ChatGPT (GPT-6.1 Sol/Terra) and DeepSeek V4.1 Flash.
- Local media: Qwen-Image 2.1 in ComfyUI; local TTS. Deepgram key available for paid voice.

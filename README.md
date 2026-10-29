# Wyrd Grimoire

*A grimoire of fate.* A solo, any-genre, text-based RPG engine where **code owns the rules and the truth**, and language models parse what you want to do and tell the story.

- **Real rules, real stakes.** d100 (or d20) checks, 3-action-point combat in zones, hit locations, armour by body part, HP plus lasting wounds, bleeding, infection, healing over weeks. Defeat has consequences; hardcore mode means death is death.
- **Any genre.** A universal rules core with genre packs (data) and plugins (code). Fantasy first.
- **A world that remembers.** An event log as the single source of truth, a canon graph, a memory pyramid, NPCs who only know what they saw or heard, rumours that spread, and a canon guard that checks every line of narration.
- **Your hardware, your models.** Runs on your PC and plays in any browser on your network. Text via your ChatGPT Plus plan (Sign in with ChatGPT) and DeepSeek; portraits via local Qwen-Image 2.1 in ComfyUI; voice via local TTS or Deepgram.

## Status

**M1–M6 are built:** the engine core, the model loop, the web client, combat, world and memory, and characters with companions. Four acceptance checks still need the owner at a real keyboard — real-provider M2 sign-in and a 20-turn session, the M3 LAN/phone playtest, and the M5 real-model world run and NPC-knowledge eval. **M7 (breadth) is next**; see [docs/milestones.md](docs/milestones.md).

```sh
bun install
bun run check                      # typecheck, lint, tests, pack validate
bun run wyrd --help                # dev CLI
bun run wyrd roll 65 --difficulty hard --label Stealth
```

## Play in a browser

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run start --offline             # preview without model calls
```

Open `http://localhost:4777` on the host PC, set a passcode, and create an Ashford Ferry campaign.
`bun run start` uses real providers, with Models, Connection and Usage under Settings.
Provider settings and usage migrate from the CLI files into `app.db`; credentials stay in `WYRD_HOME/secrets/`.
See [the web guide](docs/m3-web.md) for isolated previews, LAN access and browser tests.

## Read the spec

1. [Overview and glossary](docs/spec/00-overview.md) — start here; it maps every other file.
2. [Decision log](docs/decisions.md) — what was decided and why.
3. [Milestones](docs/milestones.md) — build order and acceptance checks.
4. [UI mockups](docs/design/) — the visual target.

Building with a coding agent? It should read [AGENTS.md](AGENTS.md) first.

## Licence

[MIT](LICENSE)

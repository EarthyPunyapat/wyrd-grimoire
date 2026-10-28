# 01 — Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict: true`, no `any` in engine code | One language end to end; shared types between engine and UI |
| Runtime | **Bun** (current stable) | Fast, built-in SQLite and test runner, runs on Windows and Linux. The owner already uses Bun. |
| Schemas | **zod** (v4) | One schema validates engine data, model tool calls (via `z.toJSONSchema`) and drives UI forms |
| Server | **Hono** on `Bun.serve` | Small, typed routes, first-class SSE |
| Database | `bun:sqlite`, one file per campaign | Portable campaigns, transactional event log, no external DB |
| Query layer | Drizzle ORM (bun:sqlite driver) or thin typed SQL helpers | Either is fine; keep migrations versioned |
| Web UI | React 19 + Vite, Tailwind v4, Radix primitives, Zustand (client state), TanStack Query (server state) | Standard, accessible, themeable |
| Tests | `bun test`; Playwright for end-to-end | See [15-testing.md](15-testing.md) |

Target OSes for the server: **Windows 11 and Linux** (the main PC with the RTX 5070 Ti; the owner's laptop runs Arch). Clients: any modern browser, including phones.

## Repository layout (Bun workspaces)

```
wyrd-grimoire/
  packages/
    core/        # zod schemas, IDs, event types, RNG, shared types. No IO.
    engine/      # rules core, resolution modules, combat, subsystems, reducers, validators, AI tactics. Pure.
    packs/       # pack loader + validator, plugin registry (code only)
    memory/      # canon graph queries, memory pyramid, NPC minds, retrieval, context assembler
    llm/         # provider adapters, role router, prompt builders, turn pipeline orchestration
    media/       # image + TTS adapters, job queue
    storage/     # SQLite schema, migrations, event store, projections, snapshots
  apps/
    cli/         # dev CLI (`bun run wyrd`): dice, sheets, campaign files, history, packs
    server/      # Hono HTTP + SSE server, auth, settings, wiring
    web/         # React client
  packs/         # built-in pack data (fantasy-core first); user packs live in WYRD_HOME/packs/
  docs/
```

### Dependency rules (enforced by lint or a test)

```
core   ← engine ← packs
core   ← storage
core, engine, storage ← memory
core, engine, memory  ← llm
core ← media
everything ← apps/server, apps/cli
apps/web depends only on core (types/schemas) and talks to the server over HTTP
```

- `engine` MUST NOT import `llm`, `storage`, `media`, or anything that does IO, reads the clock, or uses `Math.random`.
- `storage` doesn't import `engine`: the engine's `reduce` is injected when a campaign file is opened, and SQL projections are built from event payloads (whose schemas live in `core`).
- Only `storage` touches SQLite. Only `llm` and `media` touch the network.
- The web client never sees API keys or OAuth tokens.

## Runtime topology

```
                ┌──────────────── Main PC (RTX 5070 Ti) ─────────────────┐
 phone/laptop   │  apps/server (Bun)                                       │
 browser ──LAN/─┼─▶ Hono HTTP + SSE ── turn pipeline (llm) ── engine        │
 Tailscale      │        │                     │                           │
                │        │               storage (SQLite: app.db,          │
                │        │                 campaigns/<id>/campaign.db)     │
                │        ├── media jobs ──▶ ComfyUI :8188 (Qwen-Image 2.1) │
                │        ├── TTS ─────────▶ local TTS server / Deepgram    │
                │        └── embeddings ──▶ local (Ollama or in-process)   │
                └──────────────┬───────────────────────────────────────────┘
                               │ HTTPS
              ChatGPT plan (SIWC, Responses API) · DeepSeek · Anthropic · OpenAI API
```

## Event sourcing

The event log is the **only** source of truth. Everything else — current state, canon, NPC minds, summaries index, journal — is a **projection** that can be rebuilt by replaying events.

### Event envelope

```ts
type EventEnvelope<T extends EventType = EventType> = {
  id: string;            // ULID
  campaignId: string;
  branchId: string;
  seq: number;           // monotonic per branch, starting at 1
  turnId: string | null; // groups the events produced by one player turn
  type: T;
  payload: EventPayload<T>; // zod-validated
  source: "engine" | "model" | "player" | "system";
  gameTime: number;      // in-game minutes since campaign epoch
  createdAt: string;     // wall clock ISO, informational only
  schemaVersion: number;
};
```

Event families (non-exhaustive; each payload has a zod schema in `core`):

- **Session/meta:** `CampaignCreated`, `SettingsChanged`, `BranchForked`, `TurnStarted`, `TurnCompleted`, `NarrationCommitted`, `NarrationRerolled`.
- **Characters:** `ActorCreated` (a full sheet enters the campaign; the PC, companions, statted NPCs).
- **Rules:** `CheckResolved`, `LuckSpent`, `ConditionApplied`, `ConditionRemoved`, `XpAwarded`, `AdvancementPurchased`, `SkillMarked`, `SkillImproved`.
- **Combat:** `CombatStarted`, `InitiativeRolled`, `RoundStarted`, `ActionDeclared`, `AttackResolved`, `DamageApplied`, `WoundInflicted`, `BleedingTicked`, `MoraleChecked`, `CombatantDefeated`, `CombatEnded`.
- **World/canon:** `EntityCreated`, `FactAsserted`, `FactRetracted`, `RelationshipChanged`, `EntityMoved`, `TimeAdvanced`, `ClockAdvanced`, `RumorCreated`, `RumorSpread`, `WorldEventOccurred`.
- **Inventory/economy:** `ItemAcquired`, `ItemLost`, `ItemEquipped`, `CurrencyChanged`, `ShopTransaction`, `ItemConditionChanged`.
- **Memory:** `SceneOpened`, `SceneClosed`, `SummaryWritten`, `NpcMemoryRecorded`, `FactPinned`, `Retconned`.
- **Media:** `AssetRequested`, `AssetReady`, `VoiceAssigned`.

### Reducers and projections

- `engine` exports `reduce(state, event) → state`, pure and total. Unknown event types MUST throw in tests and be skipped with a warning in production (forward compatibility).
- `storage` maintains SQL projection tables (entities, facts, edges, npc_memories, summaries, inventory…) updated in the **same transaction** as the event insert.
- **Snapshots:** every 200 events (config) a compressed snapshot of engine state is stored per branch. Loading = latest snapshot + replay of later events.
- **Rebuild:** a CLI command `bun run wyrd rebuild <campaign>` drops projections and replays the whole log. Used by tests and after schema migrations.

### Determinism

- All randomness goes through `core/rng`: a seeded PRNG (e.g. PCG32 or xoshiro128**) whose seed and counter are part of state. Every roll is recorded in its event, so replay never re-rolls — it re-applies.
- The engine never reads wall-clock time; in-game time is state.
- Model outputs enter the system **only** as validated proposals that become events. Replaying a campaign never calls a model.

### Branches, saves and rewind

- A **branch** is `(id, parentBranchId, forkSeq)`. Rewinding to `seq N` forks a new branch from N and makes it the active branch; the old branch stays available ("alternate timelines" list).
- A **save** is a named pointer `(branchId, seq)`. Autosave = the head of the active branch after every turn.
- **Hardcore campaigns:** rewind, forking, and loading earlier saves are disabled; only the head exists. If hardcore is turned off later, the campaign is permanently marked `softcore` (see [12-campaign-settings.md](12-campaign-settings.md)).

## Engine state shape (top level)

```ts
type GameState = {
  campaign: { id; settings: CampaignSettings; packIds: string[]; rngState; gameTime: number };
  mode: "exploration" | "dialogue" | "combat" | "downtime" | "creation";
  party: { pcId: string; companionIds: string[] };     // list, so multiplayer stays possible
  actors: Record<ActorId, ActorState>;                  // PC, companions, NPCs with stats loaded
  scene: SceneState | null;                             // location, zones, present actors, lighting, weather
  combat: CombatState | null;
  inventory: Record<OwnerId, InventoryState>;
  economy: EconomyState;                                // currency, prices, shops
  factions: Record<FactionId, FactionState>;            // reputation, clocks
  quests: Record<QuestId, QuestState>;
  clocks: Record<ClockId, ClockState>;                  // threat clock, faction clocks, timers
  calendar: CalendarState;
  flags: Record<string, unknown>;                       // plugin-owned state lives under flags[pluginId]
  lastChecks: Record<ActorId, LastCheck>;               // each actor's latest check, so a push or Luck reroll can be validated
};
```

Canon (entities, facts, relationships) and memory live in projections, not in `GameState`, because they grow without bound. The engine receives the slices it needs through narrow query interfaces.

## Configuration

- `~/.wyrd/` on Linux, `%APPDATA%\Wyrd\` on Windows (override with `WYRD_HOME`).
  - `app.db` — app settings, provider configs, credential references, usage records, pack registry.
  - `secrets/` — API keys and OAuth tokens, file mode 0600 / user-only ACL. Never logged, never sent to the client.
  - `campaigns/<campaignId>/campaign.db` and `campaigns/<campaignId>/media/`.
- All tuning numbers (budgets, thresholds, XP costs, decay rates) live in a versioned `tuning` config object with defaults in code and overrides in `app.db`. The spec's numbers are defaults.

## Error handling principles

- Model failures never corrupt state: a turn is a transaction. If any model step fails after retries, the engine's resolution is still committed and the narration step can be retried ("Narration failed — retry / use plain mechanical summary").
- Every model output is parsed with zod. Invalid output → one repair retry with the validation errors fed back → then fail that step gracefully.
- Long operations (world generation, summaries, media) are background jobs with a persistent queue in `campaign.db`, so they survive restarts.

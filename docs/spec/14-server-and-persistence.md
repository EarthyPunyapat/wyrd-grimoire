# 14 — Server and persistence

## Process model

- One Bun process (`apps/server`) serves the HTTP API, the SSE streams and the built web client.
- An in-process **job runner** handles background work (summaries, embeddings, world-tick news, media, re-embeds, rebuilds) from a persistent queue.
- Startup: open `app.db`, run migrations, discover packs, probe configured providers (non-blocking), resume queued jobs.
- Start with `bun run start`. Docs cover running it at login on Windows and as a systemd user service on Linux.

## Storage

### `app.db`

| Table | Contents |
|---|---|
| `settings` | App settings ([12](12-campaign-settings.md#app-settings-appdb)) |
| `providers`, `routing` | Provider configs (secrets referenced, not stored inline), role routes, presets |
| `usage_records` | Every model/media call ([09](09-models-and-providers.md#usage-meter-settings--usage-only)) |
| `packs` | Installed packs, versions, validation status |
| `auth_sessions` | Login sessions |

### `campaigns/<id>/campaign.db`

SQLite in WAL mode, single writer.

| Table | Contents |
|---|---|
| `meta` | Campaign ID, schema version, created/updated, active branch |
| `pack_snapshot` | Frozen compiled pack content + hash ([05](05-genre-packs.md#ids-and-mixing-packs)) |
| `events` | The event log (envelope columns + JSON payload); index on (branch_id, seq) |
| `branches`, `saves`, `snapshots` | History structure and fast loading |
| `turns` | Per turn: input, parsed plan, mechanics lines, final narration, guard report, status |
| `entities`, `facts`, `edges` | Canon graph projections |
| `pc_knowledge` | Fact IDs the PC knows, with source |
| `npc_memories`, `npc_dispositions`, `rumors` | NPC minds |
| `summaries` | Memory pyramid |
| `retrieval_items`, `retrieval_fts`, `retrieval_vectors` | Retrieval index |
| `quests`, `clocks`, `inventory`, `shops` | Game projections |
| `assets`, `voices` | Media |
| `jobs` | Background job queue |

### Migrations and event versions

- Schema migrations are versioned and forward-only.
- Events carry `schemaVersion`. **Upcasters** convert old event versions to the current shape on read; after an upcaster is added, projections are rebuilt.

### Backups and export

- Daily automatic backup of each active campaign (SQLite backup API), keeping the last 7.
- **Export** a campaign as a `.wyrd` file (zip of `campaign.db`, `media/`, and a manifest). **Import** validates the manifest and schema version before opening.

## Saves, branches and rewind

| Operation | Effect |
|---|---|
| Autosave | After every turn, the active branch head moves |
| Named save | `saves` row pointing at (branch, seq) |
| Rewind to turn | Forks a new branch at the event before that turn and activates it; the old branch remains in the timeline |
| Load save | Activates its branch at that seq (forking if it's not the branch head) |
| Hardcore | Rewind, fork and load-earlier are refused by the API (`409 hardcore`) |

Background jobs tied to a branch's future (e.g. a summary of a now-abandoned scene) are cancelled or ignored when their branch isn't active.

## HTTP API

All routes are under `/api`, JSON in and out, zod-validated on both sides (schemas shared from `packages/core`).

### Auth

| Route | |
|---|---|
| `POST /auth/login` | `{ passcode }` → HttpOnly, SameSite=Strict session cookie |
| `POST /auth/logout` | |

### Campaigns and creation

| Route | |
|---|---|
| `GET /campaigns`, `POST /campaigns`, `GET/DELETE /campaigns/:id` | List, create (wizard setup), read, delete |
| `POST /campaigns/:id/worldgen/:stage` | Start or regenerate a world-generation stage |
| `POST /campaigns/:id/session-zero` | Send a message in the session-zero interview |
| `PUT /campaigns/:id/character` | Save the sheet editor (validated) |
| `POST /campaigns/:id/begin` | Integration + opening scene |
| `GET /campaigns/:id/events` | SSE: campaign-level progress (world generation, jobs, media) |

### Play

| Route | |
|---|---|
| `POST /campaigns/:id/turns` | `{ input, clientTurnId, uiContext? }` → `{ turnId }`. Idempotent on `clientTurnId` |
| `GET /campaigns/:id/turns/:turnId/stream` | SSE turn stream ([08](08-turn-pipeline.md#streaming-to-the-client-sse)); resumable |
| `POST /campaigns/:id/turns/:turnId/reroll` | Reroll narration |
| `POST /campaigns/:id/turns/:turnId/guard` | Resolve a guard flag: `keep` / `retcon` / `edit` |
| `GET /campaigns/:id/view` | The current **GameView** (below) |
| `GET /campaigns/:id/journal`, `/codex`, `/codex/:entityId`, `/map`, `/timeline` | Read models |
| `POST /campaigns/:id/codex/facts/:factId/pin`, `/retcon` | Pin or retcon a fact |
| `POST /campaigns/:id/rewind`, `GET /branches`, `POST /branches/:id/activate`, `GET/POST /saves` | History |
| `PATCH /campaigns/:id/settings` | Emits `SettingsChanged`; refuses locked fields |
| `POST /campaigns/:id/export`, `POST /import` | Export and import |

### App

| Route | |
|---|---|
| `GET/PUT /app/settings` | App settings |
| `GET/PUT /providers`, `POST /providers/:id/test` | Provider config and capability probe |
| `GET /providers/chatgpt/connect` | Starts SIWC sign-in. **Loopback requests only**; from other devices it returns instructions to use the host PC |
| `GET /usage?from&to&groupBy` | Usage meter data |
| `GET /media/:assetId`, `POST /media/:assetId/regenerate`, `GET /audio/:turnId/:segment` | Media |
| `GET /packs`, `POST /packs/validate` | Packs |

The SIWC OAuth callback is served by a temporary listener on `127.0.0.1:1455` that exists only during the connect flow.

### The GameView

The server builds a UI view model from engine state and projections, **filtered to what the PC knows and can perceive**. World truth and secrets never reach the browser, so nothing can be spoiled through dev tools.

## Network and security

- Default bind `0.0.0.0:4777` (configurable). Loopback requests may skip the passcode (configurable); all other requests need a session.
- **First run** on the host sets the passcode.
- Login is rate-limited; sessions expire after 30 days of inactivity.
- CORS: same origin only. CSRF protection via SameSite=Strict cookies plus an `X-Wyrd` header on mutating requests.
- **LAN:** open `http://<pc-ip>:4777` from the laptop or phone. Windows will ask to allow the firewall rule on first start.
- **Tailscale:** with Tailscale on the PC and the other devices, open `http://<pc-name>:4777` from anywhere (MagicDNS). For HTTPS, Tailscale's serve feature can front the app (VERIFY current Tailscale commands).
- Secrets: see [09](09-models-and-providers.md#secrets). Logs are structured and redact keys, tokens and passcodes.

## Job runner

```ts
type Job = {
  id: string; type: "summarize" | "embed" | "reembed" | "worldNews" | "image" | "tts" | "rebuild" | "guardLate";
  campaignId: string; branchId?: string; payload: unknown;
  priority: number; status: "queued" | "running" | "done" | "failed" | "cancelled";
  attempts: number; runAfter: string; lastError?: string;
};
```

- Concurrency per type (e.g. 1 image, 2 TTS, 2 summaries); a **GPU mutex** shared by local LLM calls and image jobs.
- Exponential backoff, max 3 attempts; failures surface in Settings → Advanced, never as popups during play.

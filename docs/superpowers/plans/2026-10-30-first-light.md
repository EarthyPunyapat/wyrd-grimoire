# First Light Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Characters and places get pictures: from the campaign's source wiki first, generated on the owner's main PC for originals, a placeholder otherwise. Media never delays a turn.

**Architecture:** A new `packages/media` holds the asset cache, the image providers (ComfyUI, OpenAI images) and the portrait resolver. Wiki images come from a `pageImage` method on the existing `MediaWikiClient` (same limiter and user agent). A server-side media worker runs after turns, one job at a time, and attaches results to entities with an `AssetAttached` event, so `rebuild` restores them. Uncertain matches become candidates the player picks from.

**Tech Stack:** Bun, TypeScript, zod, Hono, bun:sqlite, React 19, Playwright. Recorded HTTP fixtures; no network in tests.

**Spec:** [W3 roadmap § 00 First Light](2026-10-30-w3-roadmap.md), decision D168, and [spec 10 Media § Images](../../spec/10-media.md) (adapter, ComfyUI workflows, prompts, consistency).

**Builder:** Claude, in a `wyrd-first-light` worktree on branch `w2x-first-light`.

## Global Constraints

- Sources in order: the campaign's source wiki page image → Wikipedia (places only) → web image search only with a key → generation (ComfyUI on the main PC; OpenAI images exists but is off by default).
- **Never real people.** People and companions get images only from the campaign's *source wiki* (fiction) or generation; Wikipedia/Commons are used for places only.
- Images only for entities the PC knows (`state.knowledge.entities`, the same list the GameView exposes). Prefer the page's lead image.
- Cache at `WYRD_HOME/media-cache/<sha256>.<ext>`, never committed; each asset keeps its source page URL, licence when known, and origin.
- Media never blocks a turn: the worker runs after turns, appends events only while no turn is running, and drops to a placeholder on any failure.
- New tuning lives in `tuning.media` (no constants). Anything marked VERIFY is checked against official docs before coding.
- **AppStore migration `user_version = 5`** (Presets & Cards takes 4; whoever merges second rebases).

## Review Focus

1. **A wiki page that exists but has no image** (common on Fandom stubs): no portrait, no retry storm; the entity is marked attempted and retried after `tuning.media.retryMinutes`. Test in Task 6.
2. **A turn starting while the worker holds a result**: the worker must not append mid-turn; it re-queues the attach. Test in Task 6.
3. **An oversized or non-image response** (HTML error page, 40 MB file): rejected by content type and `tuning.media.maxBytes`, never cached. Test in Task 2.
4. **Offline or no model/provider configured**: no network calls at all, placeholders everywhere, no errors in the UI. Test in Task 6.
5. **The same entity name in two campaigns** (two "Batman"s): the cache is shared by content hash, but attachment is per campaign; deleting one campaign doesn't break the other's image. Test in Task 2.

---

## File Structure

- Create `packages/core/src/schemas/domains/media.ts` and `packages/engine/src/reduce/media.ts` (spine domain pair): `MediaAsset`, `AssetAttached`; spread once into `events.ts` / `reduce.ts`.
- Modify `packages/core/src/schemas/domains/source*.ts` (`CanonSourceSet` gains optional `wiki`), `packages/core/src/schemas/common.ts` (`World.wiki?`), `packages/core/src/tuning.ts` (`media`).
- Create `packages/media/` (`package.json`, `src/index.ts`, `src/cache.ts`, `src/providers/{types,comfyui,openai}.ts`, `src/resolve.ts`, `src/prompt.ts`, `test/`).
- Modify `packages/llm/src/lore/mediawiki.ts` (`pageImage`).
- Create `apps/server/src/media.ts` (`MediaWorker`, `mountMedia`); modify `apps/server/src/app.ts` (worker hooks, GameView fields), `apps/server/src/world-views.ts` (map thumbnails), `packages/storage/src/app-store.ts` (v5: `media_candidates`, media settings).
- Create `apps/web/src/Portrait.tsx`, `apps/web/src/MediaSettings.tsx`; modify `Narration.tsx`, `Sheet.tsx`, `Party.tsx`, `World.tsx` (Codex, map), `Passage.tsx`/`Play.tsx` (chapter banner), `App.tsx` (settings panel).

---

### Task 1: Assets are events

**Files:**
- Create: `packages/core/src/schemas/domains/media.ts`, `packages/engine/src/reduce/media.ts`
- Modify: `packages/core/src/schemas/events.ts`, `packages/engine/src/reduce.ts`, `packages/engine/src/state.ts`, `CanonSourceSet` schema, `World`, `apps/server/src/source-creation.ts` (record the wiki), `packages/core/src/tuning.ts`
- Test: `packages/engine/test/media.test.ts`

**Interfaces:**
- Produces:
  ```ts
  MediaAsset = z.object({ id: z.string().regex(/^[0-9a-f]{64}$/), mime: z.enum(["image/jpeg","image/png","image/webp"]),
    width: z.number().int().optional(), height: z.number().int().optional(),
    origin: z.enum(["wiki","wikipedia","search","generated"]), pageUrl: z.string().optional(),
    sourceUrl: z.string().optional(), license: z.string().optional(), credit: z.string().optional(),
    prompt: z.string().optional(), seed: z.number().int().optional() })
  AssetAttached: { entityId: Id, role: z.enum(["portrait","banner"]), asset: MediaAsset }
  // GameState: media: { portraits: Record<entityId, MediaAsset>, banners: Record<entityId, MediaAsset> } (default empty)
  campaignWiki(state: GameState, lore: { wiki: string }[]): string | null
    // World.wiki of the main world, else the most frequent wiki in LoreRecorded records, else null
  tuning.media = { maxBytes: 5_000_000, thumbSize: 640, candidates: 6, retryMinutes: 60, jobsPerTurn: 3, timeoutMs: 20_000 }
  ```
- [ ] **Step 1: Failing tests** — `AssetAttached` sets `media.portraits[id]`; a second attach replaces it; rebuild of a log with attaches equals the live state; an old log with no media events has empty maps; `campaignWiki` prefers `World.wiki`, falls back to the most common lore wiki, else null; `sourceEvents` records `wiki` on `CanonSourceSet`.
- [ ] **Step 2: Run** `bun test packages/engine/test/media.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(media): assets attach to entities as events`.

### Task 2: The asset cache

**Files:**
- Create: `packages/media/package.json`, `packages/media/src/{index,cache}.ts` (add the workspace to root `package.json`/tsconfig paths like the other packages)
- Test: `packages/media/test/cache.test.ts`

**Interfaces:**
- Produces: `class AssetCache { constructor(dir: string); put(bytes: Uint8Array, meta: Omit<MediaAsset,"id"|"mime">): MediaAsset; path(asset: MediaAsset): string; has(id: string): boolean }` and `sniffImage(bytes): MediaAsset["mime"] | null` (magic bytes for JPEG, PNG, WebP). `put` throws `"Not an image"` / `"Image too large"` past `tuning.media.maxBytes`; same bytes → same id, one file.
- [ ] **Step 1: Failing tests** — a PNG fixture round-trips with its sha256 id; an HTML body throws "Not an image"; a 6 MB buffer throws "Image too large"; putting the same bytes for two campaigns writes one file.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat(media): content-addressed image cache`.

### Task 3: Wiki page images

**Files:**
- Modify: `packages/llm/src/lore/mediawiki.ts`
- Create: `packages/llm/test/fixtures/lore/pageimages-wikipedia.json`, `pageimages-fandom.json`, `pageimages-none.json`
- Test: `packages/llm/test/lore-mediawiki.test.ts`

**Interfaces:**
- Produces: `MediaWikiClient.pageImage(wiki: string, title: string): Promise<{ title: string; pageUrl: string; imageUrl: string; width?: number; height?: number } | null>` and `MediaWikiClient.fetchBytes(url: string): Promise<{ bytes: Uint8Array; mime: string }>` (same limiter, user agent and `tuning.media.timeoutMs`; refuses non-https and redirects).
- VERIFY before coding: `action=query&prop=pageimages&piprop=thumbnail|name&pithumbsize=<n>&redirects=1&titles=<t>` on Wikipedia, and whether Fandom wikis expose PageImages (if not, use `prop=pageprops` `page_image_free`/`page_image` + `prop=imageinfo&iiprop=url` on the file).
- [ ] **Step 1: Failing tests** with recorded fixtures through an injected `fetch`: a Wikipedia title → image URL and size; a Fandom title → image URL; a page with no image → null; a missing page → null; the limiter spaces two calls by the configured interval (fake clock, as the existing limiter test does).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(lore): page images from MediaWiki`.

### Task 4: Image providers

**Files:**
- Create: `packages/media/src/providers/{types,comfyui,openai}.ts`, `packages/media/src/prompt.ts`
- Test: `packages/media/test/providers.test.ts`

**Interfaces:**
- Produces the spec 10 adapter: `interface ImageProvider { id: "comfyui" | "openai-images"; generate(req: { mode: "t2i" | "edit"; prompt: string; negativePrompt?: string; width: number; height: number; seed?: number; referenceAssetIds?: string[] }, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: string; seed?: number; meta: object }> }`.
- `ComfyUIProvider({ url, workflowsDir, fetch? })`: loads `workflowsDir/portrait.json` (API-format workflow) and `portrait.map.json` (`{ prompt: "<node>.<field>", negative?, seed?, width?, height? }`), `POST /prompt`, polls `GET /history/{id}`, downloads `GET /view`. VERIFY each endpoint against the ComfyUI docs. Missing workflow → throws "Export your ComfyUI portrait workflow to <dir>".
- `OpenAIImagesProvider({ apiKey, model })`: off unless a key is configured; VERIFY the current endpoint and model id.
- `portraitPrompt(entity: { name; kind; summary }, facts: { predicate; value }[], world: { name; tone; theme?: string }): { prompt: string; negativePrompt: string }` — appearance facts first, a portrait composition template, the world tone as style, a negative prompt with "text, watermark, logo".
- [ ] **Step 1: Failing tests** — ComfyUI against a fake server: maps prompt and seed into the workflow node fields, polls history until outputs appear, returns the PNG bytes; missing workflow gives the message above; `portraitPrompt` includes appearance facts and never the entity's secret facts (pass only public facts).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(media): ComfyUI and OpenAI image providers`.

### Task 5: The resolver

**Files:**
- Create: `packages/media/src/resolve.ts`
- Test: `packages/media/test/resolve.test.ts`

**Interfaces:**
- Produces: `resolveImage(input: { entity: { id; name; kind: "pc" | "npc" | "companion" | "location" | "site" }; wiki: string | null; wikiClient: Pick<MediaWikiClient,"pageImage"|"search">; search?: (q: string) => Promise<ImageHit[]> }): Promise<{ kind: "confident"; hit: ImageHit } | { kind: "candidates"; hits: ImageHit[] } | { kind: "none" }>` where `ImageHit = { imageUrl; pageUrl; title; width?; height?; origin: MediaAsset["origin"] }`.
- Rules: an exact (case-insensitive, punctuation-trimmed) wiki title match with an image → confident. Otherwise search the wiki, take up to `tuning.media.candidates` titles that have images → candidates (none → `none`). Places with no wiki hit try `en.wikipedia.org` the same way. People never use Wikipedia or web search unless the campaign has a source wiki. The web `search` hook is used only when provided (a key is configured).
- [ ] **Step 1: Failing tests** with a fake wiki client — "Batman" exact match → confident; "the Bat" → candidates from search; an original NPC in a campaign with no wiki → none, and Wikipedia is never called for a person; a place in an original world falls back to Wikipedia.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(media): portrait and banner resolver`.

### Task 6: The media worker

**Files:**
- Create: `apps/server/src/media.ts`
- Modify: `apps/server/src/app.ts` (construct the worker; call `worker.after(campaignId)` when a turn job finishes and when a view is opened), `packages/storage/src/app-store.ts` (migration 5: `media_candidates(campaign_id, entity_id, role, value, PRIMARY KEY(campaign_id, entity_id, role))`, `media_attempts(campaign_id, entity_id, role, at)`, media settings under the `settings` table key `media`)
- Test: `apps/server/test/media.test.ts`

**Interfaces:**
- Produces: `class MediaWorker { constructor(deps: { cache: AssetCache; wiki: MediaWikiClient; provider: () => ImageProvider | null; store: AppStore; campaign: (id: string) => CampaignStore<GameState>; running: (id: string) => boolean; settings: () => MediaSettings }); after(campaignId: string): void; idle(): Promise<void> }`. `MediaSettings = { webImages: boolean (default true), searchKey?: string, comfyUrl?: string, workflowsDir: string, openaiImages: boolean (default false) }`.
- Behaviour: queue per campaign, one job at a time globally, at most `jobsPerTurn` entities per pass. Picks known PC, companions, NPCs and the current location lacking an image and not attempted within `retryMinutes`. Confident → fetch, cache, append `AssetAttached` (if a turn is running, keep the result and retry the append after it). Candidates → store in `media_candidates`. None → generate when a provider is configured (portraits for people; banners for places), else mark attempted. Offline (`options.offline`) or `webImages: false` with no provider → does nothing. Errors are logged without secrets and marked attempted.
- [ ] **Step 1: Failing tests** with fake wiki client, fake provider and a PNG fixture — after a turn in a source campaign, Batman gets a portrait event; an original NPC gets a generated portrait when the fake provider is set, none otherwise; a page with no image is attempted once and not retried within the window; a result arriving while `running()` is true is appended only after it turns false; offline makes zero client calls; the turn's own response time doesn't wait for the worker (the turn resolves while the fake wiki call is still pending).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(media): background media worker`.

### Task 7: Routes and the GameView

**Files:**
- Modify: `apps/server/src/media.ts` (`mountMedia`), `apps/server/src/app.ts` (GameView), `apps/server/src/world-views.ts` (map), `packages/core/src/schemas/web.ts`
- Test: `apps/server/test/media.test.ts`

**Interfaces:**
- Routes (all behind auth): `GET /api/media/:assetId` (the cached bytes with their mime, `Cache-Control: private, max-age=31536000, immutable`; 404 when missing), `GET /api/campaigns/:id/media/candidates` → `{ entityId, role, name, hits: ImageHit[] }[]` (known entities only), `POST /api/campaigns/:id/media/:entityId/choose { role, index }` → fetches, caches and attaches, `POST /api/campaigns/:id/media/:entityId/regenerate { role }` → queues generation, `GET/PUT /api/settings/media`, `POST /api/settings/media/test` (generates a small test image via the configured provider).
- GameView: `known[].portrait?: string` (the `/api/media/<id>` URL), `pc.portrait?`, `companions[].portrait?`, `scene.banner?`; MapView `sites[].thumb?` (the site's banner).
- [ ] **Step 1: Failing tests** — after attaching, the view's `known` entry for Batman has `portrait: "/api/media/<id>"` and the route serves PNG bytes; an unauthenticated request → 401; candidates exclude entities the PC doesn't know; choose attaches and clears that candidate; the GameView JSON contains no `pageUrl` for secret entities (only known ones are listed at all).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(media): media routes and portraits in the game view`.

### Task 8: Pictures in the UI

**Files:**
- Create: `apps/web/src/Portrait.tsx`, `apps/web/src/MediaSettings.tsx`
- Modify: `Narration.tsx` (reference pop-up), `Sheet.tsx` (`.portrait` heading), `Party.tsx`, `World.tsx` (Codex entry + "Choose a portrait" picker; map site thumbnail), `Play.tsx`/`Passage.tsx` (chapter heading banner for the current location), `App.tsx` (Media section in the shared settings panel)
- Test: `apps/web/test/media.test.tsx`, `e2e/first-light.e2e.ts`

**Interfaces:**
- `Portrait({ name, kind, src, size })`: an `<img>` with `alt={name}` when `src` is set, else the styled placeholder (initial on the entity tint); an image that fails to load falls back to the placeholder.
- Picker: in a Codex entry with candidates, 3–6 thumbnails with their page title and source host; picking one calls choose; "Generate instead" when a provider is configured.
- Settings → Media: Web images on/off, search key (stored server-side, never echoed back), ComfyUI address + Test generation, OpenAI images toggle (disabled without a key), and a line that the cache lives in `WYRD_HOME/media-cache`.
- [ ] **Step 1: Failing unit tests** — Portrait renders an `img` with alt text when `src` is set and the placeholder initial otherwise; the reference pop-up shows the portrait for a known entity with one; MediaSettings never renders the search key value.
- [ ] **Step 2: Failing e2e** — in the fixture server with a recorded wiki image, after a turn the Codex entry and the name pop-up show the portrait, and the chapter heading shows the place banner; a candidate picker appears for an ambiguous name and choosing one updates the portrait. Desktop and phone.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** unit and e2e, then the full sequential suite.
- [ ] **Step 5: Commit** `feat(web): portraits, banners, picker and media settings`.

### Task 9: Docs and acceptance

**Files:** `docs/spec/10-media.md` (web-first sources, AssetAttached, the worker, no real people), `docs/milestones.md` (First Light acceptance), `HANDOFF.md`, `README.md` (ComfyUI setup: export the portrait workflow and mapping into `WYRD_HOME/media/workflows/`).

- [ ] **Step 1:** Add and tick only what passes:
  - [ ] Known canon characters in a source campaign get wiki portraits automatically; ambiguous names offer a picker.
  - [ ] Places get banners and map thumbnails.
  - [ ] With ComfyUI configured on the main PC, originals get generated portraits; without it, placeholders.
  - [ ] Media never delays a turn; offline makes no network calls.
- [ ] **Step 2: Run** `bun run check` and the full sequential Playwright suite; record counts in HANDOFF.md.
- [ ] **Step 3: Commit** `docs: First Light spec, acceptance and handoff`.

# Presets & Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creation becomes *choose a character card → choose a world (setup or saved world) → review → begin*, so the owner never retypes a setup or a character.

**Completed:** Tasks 1–8 on `w2x-presets`, including main through `10f90ea` (D173). Final `bun run check`: **953 passed**; full sequential Playwright on port 4799: **88 passed, 4 existing skips**. The only deferred item is external verification of the plan-supplied Reverend Insanity wiki host (network forbidden). Rulings are recorded in [HANDOFF.md](../../../HANDOFF.md).

**Architecture:** Three new app-store libraries (world setups, character cards, saved worlds) with REST routes. A character card reuses the existing ChatGPT-import shape (`CampaignImport`), so starting with a card goes through the already-tested `StartGeneratedCampaign.import` path. A world setup prefills the creation form and overrides the GM's creation review. A saved world copies the creation draft that built a campaign, so a new campaign starts in the same generated world.

**Tech Stack:** Bun, TypeScript, zod, Hono, bun:sqlite (`AppStore`), React 19, Playwright. Offline tests only (FakeProvider).

**Spec:** [W3 roadmap § 2.x Presets & Cards](2026-10-30-w3-roadmap.md) and decision D167 in [decisions.md](../../decisions.md).

**Builder:** Codex. Read `AGENTS.md` and `HANDOFF.md` first. Work in a `wyrd-presets` worktree on branch `w2x-presets`.

## Global Constraints

- Starter text is written fresh (AGENTS.md "Original content"). Source starters only *name* the source and its wiki.
- Stored in the app store (`WYRD_HOME/app.db`) so every device sees them. **AppStore migration `user_version = 4`** (First Light is merged and its media tables use CREATE TABLE IF NOT EXISTS without changing user_version).
- Built-in starters are read-only: they can be duplicated, never edited or deleted.
- A card changes only through "Update card from this campaign". Adapting a card for a world is a per-campaign proposal and never writes the card.
- Media never blocks: cards show an initials placeholder. First Light owns portraits; don't build portraits here.
- Keep `bun run check` green (typecheck → lint → tests → pack validate). One Playwright/browser process at a time on the owner's laptop.

## Review Focus

1. **A card whose ability or skill ids don't exist in the new world's pack**: start must still succeed; unknown skill ids are dropped, abilities carry over as abilities (they're free text). Test in Task 5.
2. **"Begin with these" with no card chosen**: uses the world's suggested name with the first origin and first background, the same as the existing quick path. Test in Task 7 (e2e).
3. **"Save this world" on a campaign with no creation draft** (quick-start and pre-U5 campaigns): 409 with "This campaign has no saved world to copy", never a crash. Test in Task 4.
4. **Deleting a built-in starter or editing it**: 409 "Built-in setups can't be changed; duplicate it". Test in Task 3.
5. **Two devices editing the same setup**: last write wins, `updatedAt` returned so the UI shows the fresh copy after a save. Test in Task 3 (PATCH returns the stored record).

---

## File Structure

- Create `packages/core/src/schemas/presets.ts` — `WorldSetup`, `CharacterCard`, `SavedWorldMeta` and request schemas. Export from `packages/core/src/index.ts`.
- Modify `packages/storage/src/app-store.ts` — migration 4 and CRUD.
- Create `apps/server/src/world-starters.ts` — the 8 built-in setups.
- Create `apps/server/src/presets.ts` — `mountPresets(app, deps)`: setups, cards, saved worlds, vary, adapt; `cardFromCampaign()`.
- Modify `apps/server/src/app.ts` — mount, plus `StartGeneratedCampaign.card` handling in `POST /api/campaigns`.
- Create `packages/llm/src/presets.ts` — `varyPitch()` and `adaptCharacter()`.
- Create `apps/web/src/CreationChooser.tsx` (+ `apps/web/src/chooser.css`), modify `NewCampaign.tsx`, `CreationReview.tsx`, `ImportPanel.tsx`, `Menus.tsx` (settings tab).
- Create `apps/web/public/starters/<id>.webp` × 8 (Codex-generated art).
- Tests: `packages/core/test/cards.test.ts`, `packages/storage/test/app-store.test.ts`, `apps/server/test/presets.test.ts`, `packages/llm/test/presets.test.ts`, `apps/web/test/chooser.test.tsx`, `e2e/presets-cards.e2e.ts`.

---

### Task 1: Schemas

**Files:**
- Create: `packages/core/src/schemas/presets.ts`; modify `packages/core/src/index.ts`
- Test: `packages/core/test/cards.test.ts`

**Interfaces:**
- Produces:
  ```ts
  WorldSetup = z.object({
    id: z.string().min(1), builtin: z.boolean().default(false),
    name: z.string().trim().min(1).max(80), blurb: z.string().trim().max(240).default(""),
    art: z.string().max(200).optional(),            // "/starters/<id>.webp" for built-ins
    pitch: WorldPitch.shape.pitch, source: WorldPitch.shape.source,
    rules: z.object({ preset: CampaignPreset, storyMode: StartGeneratedCampaign.shape.storyMode,
      resolution: ResolutionId, hardcore: z.boolean(), progression: ProgressionMode }).partial(),
    review: CreationReview.partial().default({}),    // overrides merged onto the GM's review
    updatedAt: z.string().default(""),
  })
  CardSheet = DraftSheet.pick({ pronouns, attributes, skills, appearance, personality }).partial()
  CharacterCard = z.object({
    id, title: z.string().trim().min(1).max(80),
    origin: z.enum(["created", "campaign", "import"]),
    pc: CampaignImport.shape.pc, companions: CampaignImport.shape.companions,
    sheet: CardSheet.optional(), updatedAt: z.string().default(""),
  })
  SavedWorldMeta = z.object({ id, name, worldName: z.string(), premise: z.string(),
    sourceCampaignId: z.string(), updatedAt: z.string() })
  WorldSetupInput = WorldSetup.omit({ id: true, builtin: true, updatedAt: true })
  CharacterCardInput = CharacterCard.omit({ id: true, updatedAt: true })
  StartCard = z.object({ id: z.string(), adapted: CampaignImport.shape.pc.optional() })
  ```
  and `StartGeneratedCampaign` gains `card: StartCard.optional()` (still `.strict()`; `card` and `import` are mutually exclusive, enforced by `.refine`).

- [x] **Step 1: Write the failing tests** — `WorldSetup` parses a setup with `review: { startingLevel: "infinite" }`; `CharacterCard` parses Ethan (level `"infinite"`, two abilities, Ari companion with `voice`); `StartGeneratedCampaign` rejects `{ draftId, card: {id:"c"}, import: {...} }` with an issue on `card`.
- [x] **Step 2: Run** `bun test packages/core/test/cards.test.ts` — expect FAIL (module missing).
- [x] **Step 3: Implement the schemas above.**
- [x] **Step 4: Run** the test — expect PASS; `bunx tsc -p .` clean.
- [x] **Step 5: Commit** `feat(core): world setup, character card and saved world schemas`.

### Task 2: App store migration 4

**Files:**
- Modify: `packages/storage/src/app-store.ts`
- Test: `packages/storage/test/app-store.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces on `AppStore`: `worldSetups(): WorldSetup[]`, `saveWorldSetup(s: WorldSetup): WorldSetup`, `removeWorldSetup(id)`, `characterCards(): CharacterCard[]`, `characterCard(id): CharacterCard | null`, `saveCharacterCard(c): CharacterCard`, `removeCharacterCard(id)`, `savedWorlds(): (SavedWorldMeta & { draft: unknown })[]`, `savedWorld(id)`, `saveSavedWorld(meta, draft: unknown)`, `removeSavedWorld(id)`. Each save stamps `updatedAt` (ISO) and returns the stored record.

- [x] **Step 1: Failing tests** — a fresh store has `user_version` 4 and empty lists; a v3 database (create one with the v3 schema, as the existing migration test does) migrates and keeps its creation drafts; save → list → save again updates `updatedAt` and keeps one row; remove deletes.
- [x] **Step 2: Run** — FAIL.
- [x] **Step 3: Implement** migration 4: tables `world_setups`, `character_cards`, `saved_worlds`, each `(id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`, inside one transaction, then `PRAGMA user_version = 4`. Values are JSON, parsed with the Task 1 schemas on read (skip rows that fail to parse rather than throw).
- [x] **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat(storage): world setups, character cards and saved worlds (store v4)`.

### Task 3: Built-in starters and setup routes

**Files:**
- Create: `apps/server/src/world-starters.ts`, `apps/server/src/presets.ts`, `apps/web/public/starters/*.webp`
- Modify: `apps/server/src/app.ts` (call `mountPresets`)
- Test: `apps/server/test/presets.test.ts`

**Interfaces:**
- Produces: `WORLD_STARTERS: WorldSetup[]` (all `builtin: true`); routes `GET /api/world-setups` (starters first, then own, newest first), `POST /api/world-setups` (body `WorldSetupInput`, 201), `PATCH /api/world-setups/:id` (partial input), `DELETE /api/world-setups/:id`. `POST /api/campaigns/:id/world-setup` creates a setup from a campaign: its name, pitch, source (from `CanonSourceSet` / the creation draft), and settings (preset, resolution, hardcore, progression, subsystems, lethality, style, theme, starting Level).

The 8 starters (write the `pitch` and `blurb` fresh, 2–4 sentences, second person):

| id | name | source / wiki | rules and review overrides |
|---|---|---|---|
| `dc-superhero` | Superhero, inside DC | DC Comics · `dc.fandom.com` | standard, d20, livingWorld |
| `reverend-insanity` | Cultivation, inside Reverend Insanity | Reverend Insanity · `reverend-insanity.fandom.com` (VERIFY the wiki host) | standard, d20, livingWorld, lethality high |
| `cosmic-god-game` | Cosmic god-game | — | story, d20, livingWorld, `startingLevel: "infinite"` |
| `grimdark` | Grimdark fantasy | — | simulation, d100, hardcore, survival on |
| `classic-fantasy` | Classic fantasy adventure | — | standard, d100 |
| `space-opera` | Space opera | — | standard, d20 |
| `cyberpunk-noir` | Cyberpunk noir | — | standard, d100 |
| `zombie-survival` | Zombie survival | — | simulation, d100, survival and scarcity on |

**Art (Codex):** generate one 800×450 WebP per starter at `apps/web/public/starters/<id>.webp`, dark and painterly, in the style of the 3.0 roadmap graphic (candlelit grimoire palette, teal and gold accents), no text, no logos, no real people, no recognisable copyrighted characters (evoke the genre, e.g. a caped silhouette over a rain-soaked skyline). Keep each under 150 KB.

- [x] **Step 1: Failing tests** — every starter parses as `WorldSetup` and its `art` file exists under `apps/web/public`; `GET` lists 8 starters then own setups; `POST` → 201 with id and `updatedAt`; `PATCH` returns the stored record; `PATCH`/`DELETE` on `dc-superhero` → 409 "Built-in setups can't be changed; duplicate it"; `POST /api/campaigns/:id/world-setup` on a generated campaign copies its resolution and pitch.
- [x] **Step 2: Run** `bun test apps/server/test/presets.test.ts` — FAIL.
- [x] **Step 3: Implement** the starters, art and routes (guarded by the existing auth middleware).
- [x] **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat(presets): eight world starters and world setup routes`.

### Task 4: Character cards and saved worlds

**Files:**
- Modify: `apps/server/src/presets.ts`
- Test: `apps/server/test/presets.test.ts`

**Interfaces:**
- Produces: `cardFromCampaign(game: CampaignStore<GameState>): CharacterCardInput` — PC name, Level (`"infinite"` kept), `AbilityGained` abilities (name, description, rank), `player:` gear (name, description), sheet attributes, core skills, appearance and pronouns, and every loyal companion (name, summary from its entity, `voiceProfile` as `voice`, level). Backstory from the sheet identity (fallback: the campaign pitch, truncated to 4000).
- Routes: `GET/POST /api/character-cards`, `PATCH/DELETE /api/character-cards/:id`; `POST /api/campaigns/:id/character-card` (origin `campaign`, 201); `POST /api/character-cards/:id/update-from/:campaignId` (replaces `pc`, `companions`, `sheet`; keeps `title` and `origin`); `POST /api/campaigns/:id/save-world` → finds the creation draft whose `campaignId` is this campaign, stores a copy without `campaignId`, `sheet` or `interview` (201 `SavedWorldMeta`), or 409 "This campaign has no saved world to copy"; `GET /api/worlds`, `DELETE /api/worlds/:id`; `POST /api/worlds/:id/draft` → saves a new creation draft (new uuid) from the copy and returns `{ draftId }` for the existing resume path (`GET /api/world-drafts/:id`).

- [x] **Step 1: Failing tests** — save-as-card from a campaign created with an import (Ethan ∞, Ari loyal with voice) returns a card with level `"infinite"`, both abilities and Ari's voice; update-from copies a new ability gained later and keeps the title; save-world on a generated campaign → `GET /api/worlds` lists it; `POST /api/worlds/:id/draft` returns a draft id whose `GET /api/world-drafts/:id` has the same `worldName`; save-world on a quick-start campaign → 409 with the message above.
- [x] **Step 2: Run** — FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat(presets): character cards and saved worlds`.

### Task 5: Start a campaign with a card

**Files:**
- Modify: `apps/server/src/app.ts` (`POST /api/campaigns`)
- Test: `apps/server/test/presets.test.ts`

**Interfaces:**
- Consumes: `StartGeneratedCampaign.card`, `AppStore.characterCard`.
- Behaviour: with `card`, the server builds `import = { pc: card.adapted ?? card.pc, companions: card.companions, history: [] }` and then runs the existing import path. When `card.sheet` exists, its `attributes`, `appearance`, `pronouns` and `personality` overlay the built sheet, and its `skills` overlay only ids present in the pack's skill catalogue (others dropped). An unknown card id → 404 "Character card not found".

- [x] **Step 1: Failing tests** — starting a generated draft with `card: { id }` gives a PC with the card's name, Level ∞ and abilities, and Ari as a loyal companion with her voice; a card whose `sheet.skills` includes `custom:nonexistent` still starts and drops that skill; `card.adapted` with a different ability set is what the campaign gets, while `GET /api/character-cards/:id` is unchanged.
- [x] **Step 2: Run** — FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat(presets): start a campaign with a character card`.

### Task 6: Vary it and Let the GM adapt

**Files:**
- Create: `packages/llm/src/presets.ts`; export from `packages/llm/src/index.ts`
- Modify: `apps/server/src/presets.ts`
- Test: `packages/llm/test/presets.test.ts`, `apps/server/test/presets.test.ts`

**Interfaces:**
- Produces: `varyPitch(router: RoleRouter, input: { pitch: string; source?: { title: string; wiki: string } }): Promise<string>` — worldGen role, tool `propose_pitch { pitch: string(10..4000) }`, instruction: a fresh twist in the same genre, tone and rules; never name real people. `adaptCharacter(router, input: { pc: CampaignImport["pc"]; world: { name: string; premise: string; tone: string; source?: string } }): Promise<CampaignImport["pc"]>` — worldGen role, tool `propose_adaptation` returning the `pc` shape; same name; abilities may be re-skinned; Level may change.
- Routes: `POST /api/world-setups/vary` (body `{ pitch, source? }` → `{ pitch }`; 422 "Connect a model to vary a pitch." when offline); `POST /api/character-cards/:id/adapt` (body `{ draftId }` → `{ pc }`, reads the draft's proposal for the world).

- [x] **Step 1: Failing tests** — FakeProvider returns `propose_pitch` → `varyPitch` returns that text; bad tool output (pitch of 3 chars) → throws a readable error; `adaptCharacter` keeps the name even if the model returns another; the server routes return 422 offline.
- [x] **Step 2: Run** — FAIL.
- [x] **Step 3: Implement** with the existing structured-proposal helper the import extractor uses.
- [x] **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat(presets): vary a setup's pitch and adapt a card to a world`.

### Task 7: The chooser and save points (web)

**Files:**
- Create: `apps/web/src/CreationChooser.tsx`, `apps/web/src/chooser.css`
- Modify: `apps/web/src/NewCampaign.tsx`, `apps/web/src/CreationReview.tsx`, `apps/web/src/ImportPanel.tsx`, `apps/web/src/Menus.tsx`
- Test: `apps/web/test/chooser.test.tsx`, `e2e/presets-cards.e2e.ts`

**Interfaces:**
- `CreationChooser({ cards, setups, worlds, value, onChange, onBegin, onContinue, onManage })` where `value = { cardId: string | null; setup: WorldSetup | null; worldId: string | null }`.
- Flow: the New campaign dialog opens on the chooser. Row 1 "Who are you playing?": cards (initials avatar, title, Level, companions) + "Create new". Row 2 "Where?": the 8 starters with art, your setups, saved worlds + "Create new". Picking a setup prefills name, pitch, source and the rules; picking a saved world resumes its draft. **Continue** goes to the existing flow, prefilled. **Begin with these** generates, merges the setup's `review` over the GM's review, and starts the campaign with the card (or the quick path when no card is picked), showing the existing generation progress. **Vary it** (on a setup) replaces the pitch field. **Arrive as-is / Let the GM adapt** toggle on the review when a card is picked; adapt shows the proposed pc as editable fields before Begin.
- Manage (your own items only): rename, duplicate, delete with confirmation; built-ins offer Duplicate only.
- Save points: the review screen gets "Save as world setup" and "Save character as card"; the import review gets "Save as character card"; the Settings tab gets a "Keep this campaign" section with Save as world setup, Save this world, Save character as card, and Update card [select] from this campaign.

- [x] **Step 1: Failing unit test** — the chooser renders 8 starters with their art and a "Create new" in each row; a card shows "Level ∞"; built-ins show Duplicate and no Delete.
- [x] **Step 2: Failing e2e** — save Ari's campaign as a card, open New campaign, pick the card and "Space opera", Begin with these → the play screen shows the card's name and Level ∞ and Party lists Ari; Vary it changes the pitch (FakeProvider route in `e2e/server.ts`); delete a duplicated setup. Desktop and phone.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `bun test apps/web/test/chooser.test.tsx` and `WYRD_E2E_PORT=4799 bunx playwright test e2e/presets-cards.e2e.ts` — PASS; then the full sequential suite.
- [x] **Step 5: Commit** `feat(web): character and world chooser, Begin with these, save points`.

### Task 8: Docs and acceptance

**Files:**
- Modify: `docs/spec/12-campaign-settings.md` (creation section: chooser, setups, cards, saved worlds), `docs/milestones.md` (a "2.x Presets & Cards" acceptance list), `HANDOFF.md`.

- [x] **Step 1:** Add to `docs/milestones.md` and tick only what passes:
  - [x] Creation opens on a chooser of character cards and world setups (8 starters + own + saved worlds).
  - [x] A setup prefills creation; Begin with these starts a campaign with its rules in one click; Vary it rewrites the pitch.
  - [x] Cards save from creation, a campaign or an import, start campaigns with Level, abilities and loyal companions, adapt per campaign, and change only via Update card.
  - [x] Saved worlds start new campaigns in the same generated world.
- [x] **Step 2: Run** `bun run check` and the full sequential Playwright suite; record the counts in HANDOFF.md.
- [x] **Step 3: Commit** `docs: Presets & Cards spec, acceptance and handoff`.

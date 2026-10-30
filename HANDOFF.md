# Handoff notes

Working notes for whoever picks this up next. Read `AGENTS.md` first, then this file.

## Status (2026-10-30)

**M1–M7, W2 step 2, workstreams A (Levels/abilities), B (avatars/sealing), C (wiki lore), D (source creation/style/canon clocks), E (time skips/watch list) and F (companions/delegation), plus UI 2.0 U3, U4, U5 (home and creation) and U6 (presets and dials), plus 2.x Presets & Cards, are built.** Owner-only and remaining W2 checks stay unticked in `docs/milestones.md`.
The GM-with-tools turn (Tasks 1–8 of `docs/superpowers/plans/2026-10-29-w2-step2-gm-turn.md`) is on
`w2-gm-ui` and merges to `main`: one GM model runs a turn with engine tools, streams prose, shows
cards and choices, retcons with Undo, marks a backup model and runs a non-blocking structural check
with Fix/Dismiss. `bun run check` is green: typecheck → lint (warnings only) → **873 tests** →
`pack validate packs/fantasy-core`.

Owner-only checks still outstanding (need real hardware or keys):

- M2: ChatGPT plan sign-in end to end, and one 20-turn session on a real provider.
- M3: LAN/phone playtest from the Arch laptop and a phone.
- M5: a real-model world run and the NPC-knowledge eval.
- M8: media (images, TTS) has not been built.

## 2.x Presets & Cards (2026-10-30)

Built from [the plan](docs/superpowers/plans/2026-10-30-presets-and-cards.md) on `w2x-presets`; decisions D167, D174. Main through `10f90ea` is merged, including D173.

- App-store migration v4 adds validated world setups, character cards and saved worlds, with timestamps and last-write-wins saves. First Light's existence-based tables are retained.
- Creation opens on the character/world chooser. Eight original starters include generated 800×450 WebP banners under 150 KB each; prompts are in `apps/web/public/starters/PROMPTS.md`. Continue prefills the pitch/review; Begin with these skips to generation/start; Vary it changes only the in-progress pitch.
- Cards save from review, import and campaign Settings; carry ∞, abilities, signature gear, stats and loyal companions/voices; adapt per campaign; update explicitly. Card/adaptation choices survive draft resume; clearing a required field while editing keeps the last valid autosaved proposal. Saved worlds clone their original generated draft with a fresh ID and no old character.
- Settings → Keep this campaign provides all campaign save/update actions. Built-ins only duplicate; own library entries rename, duplicate and delete. Source metadata survives resumed saved-world previews. A no-draft campaign returns the specified 409 when asked to save its world.
- Review covered schema/API boundaries, built-in immutability, snapshot updates, skill portability, source resume, browser readiness, adaptation loading and invalid intermediate autosaves. Inverting the built-in guard makes the API regression test fail. Desktop and phone chooser axe checks pass; the UI detector reports no findings.
- Validation: final `bun run check` passes: typecheck, lint (14 warnings), **953 offline tests**, and fantasy-core pack validation. Build passes. Full sequential Playwright: **88 passed, 4 existing skips**, including the autosave regression and D173 vendor behavior. Tests use FakeProvider/fixtures, never real model or wiki calls. Browser runs use one worker on `WYRD_E2E_PORT=4799`.
- Deferred: independently verifying the plan-supplied Reverend Insanity wiki host, because this task forbids external network calls. Starter art is complete; no other build work is deferred.

- Ruling: `StartCard` lives beside `StartGeneratedCampaign` in world-generation.ts — importing it from presets.ts would create a runtime schema initialization cycle.
- Ruling: Starter “lethality high” maps to `brutal`; scarcity uses Simulation's inventory, money and survival toggles — those are the existing schema values; there is no separate scarcity switch.
- Ruling: The Reverend Insanity starter uses the wiki host supplied in the plan, pending owner verification — this task explicitly forbids network access, so the plan's external VERIFY cannot run here.
- Ruling: Card stats overlay a validated new-world base sheet before ActorCreated, with derived stats recomputed — an already-played card can exceed new-character point-buy budgets; IDs are checked against the combined core + pack skill catalogue.
- Ruling: Card PATCH edits the title only — character contents change through the explicit Update card route, as D167 requires.
- Ruling: The merge of main retains D173's removal of starting shops and merchant-presence gating, while preserving the card sheet overlay — choosing a setup or card must never reopen a vendor at campaign start.
- Ruling: New schema tests live in `packages/core/test/cards.test.ts` — `presets.test.ts` already covers rules presets; its existing regression coverage is preserved.
- Ruling: Explicitly injected routers may run Vary it/adapt in offline fixtures — this matches the existing creation-style injection and keeps production offline errors while allowing FakeProvider browser tests.
- Ruling: Saved worlds also have rename and duplicate endpoints — chooser management requires these actions for own entries, beyond the plan's minimum list/delete/clone interface.
- Ruling: Creation drafts persist the selected card and edited adaptation; saved-world copies remove both — otherwise closing creation loses the chosen character, or reusing a world carries the old PC.

## Vendors only when someone is selling (2026-10-30, D173)

New campaigns no longer open a starting shop at the opening scene (they kept starting "inside" it). `shopHere` hides template shops unless their merchant is present in the scene, so older campaigns' starting shops disappear too; vendors come from the GM's `open_shop`. Tests that used the starting shop now open a GM vendor (`withVendor` in m7-acceptance, the `vendor workflow` e2e fixture).

## 00 First Light (2026-10-30)

Built on `w2x-first-light` from [the plan](docs/superpowers/plans/2026-10-30-first-light.md); decisions D168, D172.

- `packages/media`: `AssetCache` (sha256, magic-byte sniffing, size cap), `ComfyUIProvider` (verified routes: POST /prompt, GET /history/{id}, GET /view; workflow `portrait.json` + `portrait.map.json` in `WYRD_HOME/media/workflows`), `portraitPrompt`, `resolveImage` (exact name → confident, search → candidates; people only from the source wiki; places fall back to Wikipedia).
- `MediaWikiClient.pageImage` / `fetchBytes`; `AssetAttached` → `flags.media` (`mediaOf`, `campaignWiki`); `CanonSourceSet` now records the wiki.
- `apps/server/src/media.ts`: `MediaWorker` (after turns and view loads, never mid-turn, hourly backoff) and routes (`/api/media/:id`, candidates/choose/regenerate, `/api/settings/media` + test). `main.ts` injects the real wiki client unless `--offline`.
- Web: `Portrait` + `MediaContext`, place banner, Codex picker, map thumbnails, Settings → Media.
- **Known limit:** Fandom's image CDN refuses honest non-browser requests (403), so DC / Reverend Insanity portraits need another route (owner decision).
- **Review fixes:** people are never fetched from Wikipedia/Wikimedia (even as a campaign's research wiki) and Wikipedia place matches are candidates only; choose re-checks for a turn after its download; downloads check type/length and stream under `maxBytes`; a picture whose file is gone is hidden and refetched; hosts that refuse us are remembered and those characters are generated; no attempt is recorded when no source could run, and saving media settings clears attempts; generated prompts use only facts the PC knows; the worker stops wiki calls when a turn starts.
- **Validation:** `bun run check` → 933 tests; full Playwright → 78 passed, 4 existing skips (`combat.e2e.ts` brawl failed once in one full run, then passed in four runs: watch it).

## Next: 2.0 finish, then 2.x and 3.0 (2026-10-30)

- **2.0:** the replay harness (W2 step 4 R) is being built by Codex; then the owner's 20-turn test.
- **Planned with the owner:** [W3 roadmap](docs/superpowers/plans/2026-10-30-w3-roadmap.md), decisions D167–D171. Next builds: **2.x Presets & Cards** and **00 First Light** (images, web-first). Write each one's TDD plan before building.

## Owner UI review fixes (2026-10-30)

Built on `fix-ui-nine` from the owner's playtest list; decisions D162–D165.

- **Choices:** clicking a GM choice sent it as a clarification answer, so the server returned 409 "That clarification is no longer current". `Passage` now has separate `onChoice(label)` and `onClarify(option, label)`.
- **Map / location:** the GM role never got the travel context (site ids, Roads), so journeys were narrated without `act travel` and the scene stayed put. GM prompt gm@3 includes Roads and rule 11. The map was redrawn: a "You are here" header from the real scene, region panels, curved same-column roads, 1:1 text, road list with danger, side panel.
- **Research / training:** one clock per topic (repeat continues, finished refused, only own research clocks), `ClockRemoved` + `DELETE /api/campaigns/:id/research/:clockId` to abandon; skills and teachers are dropdowns.
- **Shops (D163, D166):** `ShopOpened` stamps the scene location; `shopHere` gates the view and trade route (legacy shops fall back to the first scene; a present-person merchant must be in the scene). No menu trades: a "shop here" pill and the GM's `shop` card open `ShopWares` as a pop-up. GM tool `open_shop` (`gm/tools/shops.ts`, engine `openShop`) opens vendors with their own wares. `player:` creation gear can't be sold (`SIGNATURE_ITEM`); sales confirm.
- **UI:** one Settings tab (campaign rules + device/display/models; App passes the shared panel); Abilities list on the hotbar (K); `ChromeIcon` stroke icons for chrome; inventory redesigned; canon check folded into the margin rail.
- **Owner's DC campaign:** the ring and battery were sold at seq 426–430 through the old bag Sell button; the scene is still `location:opening` because of the travel bug. Not repaired in data — see the reply to the owner.
- **Validation:** `bun run check` green (885 tests); full sequential Playwright 74 passed, 4 existing skips.

## W2 E — Time skips and the god-game (2026-10-29)

Built test-first on `w2-skips`, merged to `main`. Plan: `docs/superpowers/plans/2026-10-29-w2-skips.md`; defaults: D161.

- `domains/skips.ts` / `reduce/skips.ts` own WatchAdded, WatchRemoved and SkipCompleted. Watches project to `flags.watchList`; the last safe digest to `flags.lastSkip`. Engine exports `runSkip`, `changeWatch`, `watchedIds`, `lastSkip`, `observableIds`, `skipFacts` and report-card helpers.
- `gm/tools/skips.ts` replaces core's old time_skip and observe, adds watch/unwatch, and registers through one index import. Duration accepts game minutes or unit text; `until` accepts task IDs, clock ID or fact equality. Legacy minutes works. Default limit is 365 days; month is 30 days; duration/report/watch/severity bounds live in tuning.skips.
- Skips exclude dead/inactive actors from NPC life events and call existing runTicks at every daily boundary (weekly every seventh calendar day), plus earlier task boundaries/final partial days. D's canon and F's task checks run through those ticks. They stop for watched major events (including completed faction goals), final pending canon segment, blocked tasks or death. Recorded/valid fact interventions permit averted canon resolution. Combat/dead campaigns cannot skip.
- Digests and one report per watched entity persist as report cards, including quiet spans. Summaries use typed event fields; no raw NPC minds or private payloads. Effective infinity observes unknown existing entities, learns public facts and may establish watches; finite/sealed observers remain knowledge-limited. Missing IDs fail.
- `PUT /api/campaigns/:id/watch/:entityId` takes `{watch: boolean}` for known targets, guards running turns and appends events. GameView projects safe watched identity/report fields. Codex controls edit watches; Cockpit shows watched entities outside the scene. GM prompts carry watch IDs and recent task metadata for future until conditions.
- Offline tests cover daily/monthly replay/RNG equivalence, every interruption, conditions/limits/validation, F/D integration, safe observation and reports, API/rebuild, and Cockpit/Codex on desktop/phone. Final validation after integrating current main (including ChatGPT import): `bun run check` passed with **873 offline tests**, typecheck, lint (existing warnings) and fantasy-core pack validation. Build passed; full sequential browser suite: **70 passed, 4 existing skips**, one worker and one browser at a time.

## W2 F — Companions, Ari and delegation (2026-10-29)

Built test-first on `w2-delegation`, merged to `main`. Plan: `docs/superpowers/plans/2026-10-29-w2-delegation.md`; defaults: D160.

- `domains/delegation.ts` owns CompanionBondSet and TaskAssigned/Progressed/Blocked/Ended; only `reduce/delegation.ts` handles them. Existing approval/milestone/departure handlers moved into that pair to enforce permanent loyalty on replay. Ordinary companions retain their approval rules; loyal ones ignore approval and cannot leave/betray (death remains possible).
- Companion `voiceProfile` is editable through Party and `PUT /api/campaigns/:id/companions/:companionId/bond`. The Party section under Character hides loyal numeric approval/meter, and GM/narrator prompts use the profile for speaker blocks. API/voice edits cannot turn loyalty off. No stock Ari is inserted into unrelated campaigns.
- `engine/delegation.ts` exports `assignTask`, `advanceDelegations(state, ctx, at?)`, `delegationTasks`, `nextDelegationBoundary`, `blockedTasks` and report-card helpers. Tasks live under `flags.delegation` and replay from their events. Due is an absolute future game minute; default duration is one day. Defaults live in `tuning.delegation`.
- `delegate` registers in `gm/tools/delegation.ts` with one index import. It accepts an active living companion ID, goal, optional due/opposition/skill/owned ability/exploit and taskId for retrying a blocked task. Task checks use A's seeded d20 level-gap rules even in d100 campaigns; results/RNG are recorded. Rolled outcomes end the task; impossible gaps/unavailable actors block and ask for help.
- Turns/world ticks and downtime advance tasks. F’s initial time_skip split at task boundaries/legal wait chunks and stopped when a task blocked. E now owns the full skip loop and reuses these hooks. Daily task/world RNG ordering agrees between long and split advances. Downtime previews clone state before folding legacy inventory events to avoid mutating input stacks.
- Task reports use the existing report card, are sent to the GM as tool results and persist on browser turns. Browser task projections omit opposition/private minds; secret-free output is tested. The hotbar says “Delegate to Ari” for Ari, or another loyal companion's actual name. Active companion IDs map to their known speaker names.
- Validation on current main (including B/D and U4–U6): `bun run check` passed with typecheck, lint (existing warnings), **846 offline tests** and fantasy-core pack validation. Build passed. Full sequential browser suite: **68 passed, 4 existing skips**; after the final companion-key fix, the strengthened Ari workflow passed again on desktop and phone. It verifies a single card, saved voice after reload, reports, speaker names and no approval meter. All tests use fixtures/FakeProvider, with no wiki or model network calls.

## W2 UI 2.0 U5 — Home and creation (2026-10-30)

Built on `w2-ui-home`, merged to `main`. Plan: `docs/superpowers/plans/2026-10-30-w2-ui-home.md`; decisions: D159.

- **Night Codex home.** Home and the creation dialog carry `data-preset="reader"`; every new rule lives in `apps/web/src/home.css`. Campaigns are ruled rows with character and last-played chrome, inline rename, archive/restore behind a disclosure, and delete with confirmation. `Play.tsx` was not touched.
- **Rename and archive.** `PATCH /api/campaigns/:id` takes `{name?, archived?}`. Rename appends the new `CampaignRenamed` event, so the card and the played title stay one truth (and rebuilds replay it). Archive is `web_campaigns.archived` in the app store: archived campaigns are hidden from the active list but still open and play; only Delete removes one. Store schema migrated to v3.
- **Draft library.** `creation_drafts` (migrated from the old `settings` draft keys) backs `GET /api/world-drafts`, `GET /api/world-drafts/:id` and `DELETE /api/world-drafts/:id`. The home page lists unfinished worlds with Continue and Discard; a started draft drops out of the list. Resume restores the generated world, review, sheet flag, pitch and source.
- **Creation.** The dialog now asks original world vs inside a source explicitly, shows the source fields and wiki, presents the GM's review (including the palette and style), and the style sample has a "More like…" revision loop with its own progress and error. Generation shows a step list, a progress bar and elapsed seconds; campaign start, sheet opening and suggestions show their own status. Model failures render a plain message, optional technical detail, Dismiss and Check model settings. The import review still ships with step 4's import.
- **Tests.** `apps/server/test/home.test.ts` covers rename/replay projection, archive/restore and draft list/resume/discard; `packages/storage/test/app-store.test.ts` covers drafts and archive; `packages/engine/test/reduce.test.ts` covers the rename reducer. `e2e/home.e2e.ts` covers management, draft resume, the source choice and a failed model revision on desktop and phone.
- **Validation.** `bun run check` green: typecheck, lint (existing warnings), **819 tests**, fantasy-core pack validation. Build passed. Full sequential Playwright after rebasing on U4, U6 and avatars: **66 passed, 4 existing skips**.

## W2 U6 — presets and dials (2026-10-29)

Built on `w2-ui-presets`; plan `docs/superpowers/plans/2026-10-29-w2-ui-presets.md`; decision D158.

- Cockpit (Qud Modern) and Chat (Lantern Glass) are CSS presets over the Reader components. `apps/web/src/cockpit.css` adds the dense one-line chrome strip, a right-hand passage log, a watch list of the PC and people present, square cards and 1px selection lines. `apps/web/src/chat.css` adds true black, borderless rounded cards, right-aligned player bubbles and a sticky pill composer.
- The preset and dials are device preferences (`wyrd-play-preferences`), validated field by field and switched live from the app Settings dialog. Dial attributes on `<html>` scale the shared tokens: text size, column width, density and motion; `prefers-reduced-motion` still wins.
- `Play.tsx` changes only the preset switch (`usePlayPreset` plus `data-preset`); both presets use the existing strip, story, choices, cards, composer, hotbar and menus.
- Public Sans, Inter and JetBrains Mono are bundled from npm for offline/LAN use. The server CSP now allows Vite's inlined `data:` font subsets.
- Validation: `bun run typecheck`, `bun run lint`, **813 tests**, `bun run build`, and the full sequential Playwright suite: **58 passed, 4 existing skips** on desktop/phone. Cockpit and Chat also pass axe WCAG AA on both projects.
- E now supplies persistent watched entities to the Cockpit rail.

## W2 A — Levels and abilities (2026-10-29)

Built test-first on `w2-levels`, merged to `main`. Plan: `docs/superpowers/plans/2026-10-29-w2-levels.md`; implementation defaults: D155.

- `core/schemas/domains/levels.ts` defines Level, Ability, proposals and the four events; `engine/reduce/levels.ts` alone handles them. Sheets default to Level 1 and empty abilities; optional effective levels are honored. Class levels remain separate.
- `engine/levels.ts`: effective levels/Δ, a native-d20 wrapper, no-roll infinity, power rating, proposal/acceptance helpers, ranked abilities, cumulative XP thresholds, breakthroughs and GM corrections. Every quantitative default is in `tuning.levels`.
- `checks.ts` applies the gap table, selected ability rank and cited exploit; opposed checks and d20 combat strikes pass actual opposition. Finite d100 checks retain their mechanics. Infinity never rolls even in legacy dice campaigns; infinite-vs-infinite stalemates. Large finite power ratings use magnitude labels instead of numeric infinity.
- `gm/tools/levels.ts` owns roll, propose_level_up, grant_ability, rank_ability, breakthrough and set_level (one index import). Explicit `/gm` gates set_level and records a Retcon with Undo. Milestones never silently grant a level.
- Lifetime XP awards in turns, chapter closes and GM changes emit every crossed level. Breakthrough success advances one configured step and applies the declared HP strain; failure keeps the level. The helper can be reused by future training/skip work.
- `POST /api/campaigns/:id/levels/:proposalId/accept` rejects stale/double acceptance, hidden actors and running-turn conflicts. GameView exposes party proposals and power rating. Strip shows Level/∞, Sheet shows abilities/ranks/costs and power, and hotbar abilities prefill the composer.
- Offline engine, tool, server, replay and render tests cover the rules and flow. Combat goldens were deliberately regenerated; only ActorCreated hashes changed for default sheet fields, with all combat outcomes unchanged.
- Validation: `bun run check` passed: typecheck, lint (existing warnings), **771 tests**, and fantasy-core pack validation. `bun run build` also passed.
- Browser verification: dedicated Levels workflow passes desktop and phone. Full `bun run test:e2e`: **45 passed, 3 existing skips**, sequential with one worker/browser at a time. Browser install/build outputs are not committed.

## W2 B — Avatars and sealing (2026-10-29)

Built test-first on `w2-avatars`, merged to `main`. Plan: `docs/superpowers/plans/2026-10-29-w2-avatars.md`; implementation defaults: D156.

- `core/schemas/domains/avatars.ts` defines `AvatarCreated`, `AvatarRunEnded`, `SealSet` and `SealBroken` plus the run projection type; `engine/reduce/avatars.ts` alone handles them. `avatarRuns`/`activeAvatarRuns`/`runForSovereign`/`endAvatarRun` in `engine/avatars.ts` read the log.
- `create_avatar` (infinite sovereign only) builds a finite actor at the chosen Level, joins it under manual control, and starts a run. An infinite avatar is refused so every avatar rolls real dice through A's Level rules.
- `ActorDied` now lives in the avatars domain: an active avatar run closes with `reason: died` and the avatar is marked dead; a linked sovereign is never marked dead. `AvatarRunEnded {completed|unsealed}` closes other runs.
- `seal` writes `effectiveLevel` and `unseal` removes it, so A's gap table and infinity rule apply while sealed. Any player-acted GM tool naming the sovereign during an active run appends `AvatarRunEnded{unsealed}`; the play screen asks for confirmation first.
- GameView carries avatar runs (id/name/Level/status), and an ∞ character's hotbar shows Seal and Send avatar. Finite characters do not see those actions.
- Offline engine/tool/render tests cover creation, real dice, death, sovereign safety, unsealing, sealing and breaking a seal.
- Validation: `bun run check` passed (typecheck, lint with existing warnings, **795 tests**, fantasy-core pack validation). `bun run build` passed. Focused Playwright (`play`, `levels`) passed sequentially on desktop and phone with one worker.

## W2 D — Source creation, style and canon clocks (2026-10-29)

Built test-first on `w2-source`; merged to `main`. Plan: `docs/superpowers/plans/2026-10-29-w2-source.md`.

- Creation optionally runs inside a named source/wiki. `llm/src/source-creation.ts` reuses C's `LoreLookup`/`LoreResearch` and global summary cache to build a source bible, starting abilities, canon NPC routines and iconic timeline events. Confidence/URL evidence is retained as lore facts and a lore record; downloaded passages never enter campaign logs.
- `Clock` supports `kind: "canon"` with an elapsed-time plan and intervention predicate. New events live only in `domains/canon-clocks.ts`, with handlers only in `reduce/canon-clocks.ts`. `engine/src/canon-clocks.ts` resolves each clock once, asserting an outcome or recording that an intervention averted it. World-mismatched, retracted and superseded evidence is excluded.
- Daily `runTicks` advances canon and records in-character NPC activity facts and private memories. Dead/inactive characters stop, and canon characters bypass random generic life events. Source clocks also advance during API downtime. E can reuse `runTicks` for full daily skips; absolute clock progress catches up across the existing daily-tick cap.
- `gm/tools/source.ts` owns `source_timeline` and `intervene_canon` (one index import). Accepted earlier-in-turn fact drafts are available for intervention validation before storage projections commit. Behind-screen timeline details stay out of GameView; witnessed outcomes gain knowledge normally.
- `CampaignSettings.style = {source, playerWords, sample}` persists through events/rebuild and enters GM instructions (`gm@2`), with `prompts/house-style.md` as the default voice. Creation shows a generated sample, editable fields and a “More like…” revision loop; Settings edits all three later.
- The GM proposes all subsystem toggles, an optional light/dark theme palette, dice, hardcore/lethality/companion death and starting Level. Every field can be overridden; starting powers use A's `AbilityGained`. Existing hunger/thirst use survival, exposure uses weather, and encumbrance uses inventory mode. Legacy explicit preset/dice/death selections keep their meaning.
- UI remains functional in the current layout for U5. Theme overrides use a validated JSON palette editor for now. Missing review/sample generation is labelled and recoverable; offline preview permits direct style edits and requires a connected model for source research or sample revision.
- Offline tests use FakeProvider plus C's recorded wiki fixture. Coverage includes clocks/interventions/world isolation/replay, NPC actions, source research, apocalypse/cosmic review proposals, style instructions, same-turn evidence, creation/settings/downtime/rebuild and desktop/phone creation flows.
- Validation: `bun run check` passed: typecheck, lint (existing warnings), **781 tests**, and fantasy-core pack validation. Build passed; full sequential Playwright: **47 passed, 3 existing skips** on desktop/phone. Combat goldens changed only the `CampaignCreated` hashes for the new default settings fields; combat outcomes are unchanged.

## W2 UI U4 — the status screen (2026-10-30)

Built on `w2-ui-menus`; plan `docs/superpowers/plans/2026-10-29-w2-ui-menus.md`, decision D157.

- One full-screen status screen replaces the separate panels: Character, Inventory, Quests, Journal, Codex, Map, Timeline and Settings. C/I/Q/J/M open it on that tab; Esc, the close control and a Back to the story button return. The tablist supports arrows, Home and End, and keeps key hints as hints rather than names.
- Inventory is a paper doll (main hand, off hand, worn armour) plus a sortable bag grid. Every item opens the same `ItemCard` the story uses. Equip, stow and sort are instant; Use, Give, Throw and Drop compose one story turn. Selling stays a shop action.
- `moveEquipment` is the new engine rule: one validated `EquipmentChanged`, with carried quantities synced from the item stacks. `POST /api/campaigns/:id/inventory/move` serves the instant actions, and GameView derives each item's location from the sheet so the bag and card agree.
- Styles are in `apps/web/src/menus.css`; item and chrome icons come from game-icons.net (CC BY 3.0), credited per icon in `NOTICE`.
- Validation: `bun run check` passed (typecheck, lint warnings only, **803 tests**, fantasy-core pack validation). Build passed. Full sequential Playwright with one worker: **54 passed, 4 existing skips**; the new menus workflow passes desktop and phone including axe WCAG A/AA.
- U5 (home and creation) remains; U6 (Cockpit/Chat presets and dials) is done below.

## W2 C — Lore from wikis (2026-10-29)

Built test-first on `w2-lore`; merged to `main`. Plan: `docs/superpowers/plans/2026-10-29-w2-lore.md`.

- `llm/src/lore/mediawiki.ts`: injected-fetch MediaWiki search, Wikipedia extracts and Fandom wikitext parsing; shared 1 request/s queue and versioned user agent. `defaultTuning.lore` owns limits.
- `storage/src/lore-cache.ts`: global `WYRD_HOME/lore-cache/<wiki>/<title-hash>.json`, summaries only, no expiry/pruning. Corrupt entries recover on the next write.
- `llm/src/lore/{summarise,research}.ts`: worldGen structured summaries, copying guard (including fallback), cache/search/fetch, low-confidence model fallback without fake citations. IO/provider errors are sanitized.
- `gm/tools/lore.ts` owns `lookup_lore` (one index import). Registry/dispatcher/loop now await async tools; research progress arrives before IO. Server enables research outside offline preview and provides a fixture-injection boundary.
- Known/public current-world canon wins, including player corrections through research aliases. Summaries become `source: "lore"` facts with confidence and source-URL evidence, plus knowledge events. Only `domains/lore.ts` / `reduce/lore.ts` define/handle the new `LoreRecorded` event; replay retains world-scoped provenance in `flags.loreRecords`.
- Codex includes researched concepts and editable notes. Source/confidence metadata lives on stored facts and tool results; dedicated citation UI can follow later.
- Tests are offline: sanitized recorded Wikipedia envelope, documented Fandom/search shapes with original fixture prose, FakeProvider, fake clock, temporary cache directories, and server/GM/Codex/rebuild coverage. Live Wikipedia worked during fixture recording; live Fandom returned HTTP 402 here, so real Fandom success still needs checking on the owner's host.
- Validation: `bun run check` passed (typecheck, lint with existing warnings, **749 tests**, fantasy-core pack validation).
- Architecture checks now resolve relative imports against package roots; nested imports within llm pass, actual package escapes still fail. No browsers were launched.

## What M7 added (breadth)

- **Settings and presets** (`core/presets.ts`, `apps/server/src/campaign-settings.ts`,
  `apps/web/src/CampaignSettings.tsx`): Story/Standard/Simulation/Custom, live subsystem toggles,
  locked dice/progression refused with 409 and greyed in the UI.
- **Classes and all four progression modes** (`core/schemas/classes.ts`, `engine/classes.ts`,
  `packs/fantasy-core/classes.yaml`; six classes × ten levels).
- **d20 legibility**: `MechanicsLine.roll` + `GameView.resolution`; d20 campaigns read
  die + modifier vs DC, d100 text is unchanged.
- **Living World and downtime** (`engine/world/ticks.ts`, `engine/downtime.ts`): weekly faction
  goals and news, NPC life events, festivals, job board; train/craft/work/research/carouse/recover
  through `POST /api/campaigns/:id/downtime`.
- **Spellcasting plugin** (`core/schemas/spellcasting.ts`, `engine/plugins/spellcasting.ts`,
  30 spells in `packs/fantasy-core/spells.yaml`): strain, school checks, effects, miscasts, parser
  spell list, sheet display.
- **Injury completion** (`engine/injury/healing.ts`): healing over days, infection, fracture
  setting, permanent injuries, short/long rests; every toggle respected.
- **Inventory and money** (`engine/inventory.ts`, `engine/economy.ts`, `apps/web/src/Inventory.tsx`):
  encumbrance bands, equip/worn slots, ammo spending/recovery, durability, a starting shop with
  buy/sell/haggle, 50-coin purse.
- **Content floor**: 44 talents, 30 weapons, 12 armour, 82 gear, 35 creatures, 30 spells, six
  classes; guarded by `packages/packs/test/content-floors.test.ts`.
- **History**: Timeline tab, rewind/fork, branches, named saves, `.wyrd` export/import and daily
  backups (`packages/storage/{history,export,backups}.ts`, `apps/server/src/history.ts`).
- **Content dials** injected into every prose role and enforced by the canon guard.
- **Pack themes**: `packs/fantasy-core/theme.yaml` → `GameView.theme` → CSS variables, light/dark,
  contrast-tested.
- **Acceptance tests**: `apps/server/test/m7-acceptance.test.ts`, `packages/engine/test/m7-toggles.test.ts`,
  `packages/engine/test/living.test.ts`, `packages/engine/test/{spellcasting,injury-healing,inventory,downtime}.test.ts`.

## Map of the code

| Package | What's there |
|---|---|
| `packages/core` | RNG/IDs/stable JSON, `tuning.ts` (every number), zod schemas: settings, sheet, events (domain modules under `schemas/domains/`), pack content, spells, inventory, survival, history, web views, calendar, downtime, recipes |
| `packages/engine` | checks and d100/d20 resolution, reducer (`reduce.ts` + `reduce/<domain>.ts`), combat and injury, progression and classes, exploration/travel, world ticks, survival, downtime, inventory/economy, spellcasting |
| `packages/storage` | campaign.db, event store, branches/rewind/saves, snapshots, rebuild, `.wyrd` export/import, daily backups |
| `packages/packs` | YAML loader → namespaced `CompiledPack` (spells, classes, recipes, economy, theme, calendar, loot, naming), lints, scaffold |
| `packages/llm` | parser/narrator/guard prompts, content-policy assembly, Pipeline, providers, offline stand-ins |
| `packages/memory` | context assembler, retrieval, summaries, canon guard and content-dial enforcement |
| `apps/server` | Hono API: auth, creation, turns/SSE, settings, timeline/history, downtime, shop, party, world journal/codex/map, providers |
| `apps/web` | React client: Play, Sheet, Inventory, Party, Combat, Journal, Codex, Map, Timeline, Campaign settings |
| `apps/cli` | `bun run wyrd …` |
| `packs/fantasy-core` | full content floor, spells, classes, economy, recipes, theme, two worlds |

## How to add things

- **A new event:** add the payload to the matching `core/schemas/domains/<domain>.ts`, then its
  handler to `engine/src/reduce/<domain>.ts`. The domain modules are spread into `events.ts` and
  `reduce.ts`; a missing handler is a compile error and a registry test keeps them in sync.
- **A tuning number:** `Tuning` + `defaultTuning` in `core/src/tuning.ts`.
- **A condition:** `engine/src/conditions.ts`.
- **A pack file:** add it to `CONTENT_FILES` in `packages/packs/src/loader.ts` (list-of-entries) or
  load it like `theme.yaml`/`economy.yaml` (single object).
- **Golden fixtures:** change only on purpose with
  `WYRD_UPDATE_GOLDEN=1 bun test packages/packs/test/combat/golden.test.ts`, then review the diff.

## Known gaps (deliberate, recorded in `docs/decisions.md`)

- Wealth-level auto-purchases and seasonal price drift are data-ready but only haggling is
  enforced (D118).
- Spirit casting is wired in exploration; a dedicated combat `cast` action is not in the combat
  action union yet (D116).
- Only the pack's first shop opens (at campaign start); per-settlement shop generation is future
  work (D118).
- Themes exist for fantasy-core; other packs still use the app default palette (D119).
- The Playwright e2e suite (`bun run test:e2e`) is not part of `bun run check`; run it separately after UI changes. The current full run passes 70 tests with 4 existing skips (one worker; desktop then phone).

## Next milestone

**W2 — Wyrd 2.0** (before M8). The owner played M7 and found it lacking next to their own ChatGPT RPG sessions, and a 72-question interview on 2026-10-29 redesigned the game.

Step 2 and step 3 A/B/C/D/E/F are done, and UI 2.0 U3–U6 are built. Step 4 I (ChatGPT share import) has also landed on main. Next: the replay/owner evaluation. A exports level/check/breakthrough helpers, C exports `LoreResearch`, D exports canon-clock advancement, and F exports delegation advancement/boundary/blocked-task helpers. E now owns the full skip loop and infinity observation.

Read these first:
- the spec: `docs/superpowers/specs/2026-10-29-wyrd-2-design.md`
- the decisions: D129–D144 in `docs/decisions.md`
- the plans in `docs/superpowers/plans/`:
  - `2026-10-29-w2-roadmap.md`: order, owners and workstreams
  - `2026-10-29-w2-step1-fixes.md`: detailed, ready to execute
  - `2026-10-29-w2-step2-gm-turn.md`: detailed, ready to execute (Claude builds it)

In short:
- One GM model runs each turn and calls engine tools.
- Source-story campaigns are researched from wikis.
- A cosmic Level scale (1–20 plus ∞) with avatars and sealing.
- Time skips with a watch list, and Ari as a loyal companion with delegation.
- UI 2.0 follows Caves of Qud's modern UI plus ChatGPT-style cards.
- "Done" is the owner's 20-turn test on their imported Ethan Hunt + Ari campaign.

**Machine limit:** run only one browser or Playwright process at a time; the owner's 12 GB laptop crashed running several.

## Model setup for Wyrd 2.0 (owner)

1. Sign in with ChatGPT on the host PC: **Settings → Models → Connection → Continue with ChatGPT**
   (the redirect goes to `127.0.0.1`, so it must happen on the PC running the server).
2. List the plan's model ids with `bun run wyrd models chatgpt-plan`, then put the id you want in
   the **ChatGPT plan (prose)** slot in Settings → Models — that is `models.plan` in the provider
   config: `{ "provider": "chatgpt-plan", "model": "<id>" }`.
3. Set the routing preset from **One model for everything** to **Balanced**. Prose roles (narrator,
   npcDialogue, worldGen, sessionZero) then prefer the plan; parser, guard and summarizer prefer
   DeepSeek (see `presetRouting` in `packages/llm/src/router.ts`).
4. Restart the server (`bun run start`).

`ModelServices.ready()` (`apps/server/src/models.ts`) rejects any route whose model starts with
`PICK-WITH`, so save only after a real model id is chosen.

After W2: **M8 — Media** (see `docs/spec/10-media.md`): image adapters (ComfyUI/Qwen-Image 2.1, OpenAI), portraits and scene-art consistency, TTS adapters (local, Deepgram), voice casting, segment playback and the GPU mutex.

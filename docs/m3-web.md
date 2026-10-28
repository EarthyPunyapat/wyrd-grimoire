# Web client v1

## Run

Use Bun 1.4.4 or compatible. From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run start
```

Open `http://localhost:4777` on the host PC. First run asks for a passcode of at least 12 characters.
Every device, including the host, signs in; there is no implicit loopback authentication bypass.
Sessions use HttpOnly, SameSite=Strict cookies. HTTPS requests also get Secure cookies.
Mutations require a matching Origin when supplied and `X-Wyrd: 1`; login is rate-limited.
Account connection and key entry require both a loopback socket peer and a localhost/loopback hostname.

The server binds `0.0.0.0:4777` by default. Set `WYRD_HOST`, `WYRD_PORT` and `WYRD_HOME` to override it.
For LAN play, open `http://<host-ip>:4777` from the laptop or phone and enter the same passcode.
Allow the host's game-server port through the local firewall if necessary. Physical LAN/device
acceptance remains pending; desktop, phone, tablet and 320px layouts are tested in Playwright.

## Isolated offline preview

The offline provider makes no real model calls. Keep its files separate from a running CLI playtest.
For example, in a fresh PowerShell terminal:

```powershell
$env:WYRD_HOME = Join-Path (Get-Location) 'wyrd-data/web-preview'
$env:WYRD_HOST = '127.0.0.1'
$env:WYRD_PORT = '4788'
bun run start --offline
```

Exit that terminal to discard those environment overrides. Browser-created campaigns live under
`WYRD_HOME/campaigns/<id>/campaign.db`. Existing CLI campaign files remain independent; portable
campaign import/export is scheduled for M7. No existing campaign is reset to create the preview.

## Models and connection

Settings → Models configures preset slots and per-role primary/fallback overrides. Model IDs are
chosen by the player; List models fetches the provider's current list. Endpoint edits are saved before
listing. A turn captures its router when it starts; saved changes apply to later turns.

Settings → Connection shows ChatGPT status, starts a host-only sign-in, and accepts replacement API
keys in password fields. Existing keys and tokens are never returned to the browser. Sign-in returns
an authorization link; after completing it, refresh connection status. Offline preview disables real
account changes. Provider settings accept credential filenames, not inline keys or URL credentials.

At startup the server imports a valid existing `config.json` when app.db has no provider settings,
and imports valid `usage.jsonl` records without duplicates. It leaves those CLI files in place.
Thereafter browser configuration and usage are stored in app.db. Prices are config data; usage
estimates are not billing statements. Settings → Usage groups the latest 1,000 records by provider,
role or model, and filters by starting date. No costs or token counters appear in the story view.

## Play and recovery

New campaign starts with blank names and your adventure/world description. Character name is optional.
The worldGen role creates a premise, one starting location with connected zones and people, and
setting-appropriate origins/species and backgrounds. Review the generated options, choose your
starting training and begin. A blank character name uses the suggestion shown on review. Code
allocates the existing creation budgets and validates the sheet; content is frozen with the campaign.
Generation errors preserve the form for retry, and drafts persist server-side across restarts.
Offline preview explicitly uses a fixed sci-fi example; it does not call an AI. The authored Ashford
fixture remains at `POST /api/campaigns/quick-start` for tests. Full multi-region/lazy world generation
and the session-zero interview remain M5/M6. Seven attributes display in full rows of three and four.

Suggestion chips
fill the composer; Enter sends and Shift+Enter inserts a newline. Sheet opens on phones; `C` opens the
expanded sheet. Clarification choices accept clicks or number keys outside text fields. Reading theme
and text size are per-device preferences. Dialogue markup is rendered as text and named speech,
never arbitrary HTML. Media, combat, Journal, Map, Inventory and Party follow their later milestones.

The API deduplicates turns by clientTurnId, serializes work per campaign, and journals SSE messages
with numbered cursors. The browser resumes interrupted connections and remembers an in-flight
stream across reloads; its URL remembers the active campaign. Mechanics arrive before final guarded
narration. A narration reroll reuses the original resolution and does not reroll dice or advance time.

After a process restart, interrupted requests are marked done with a recovery message. Refreshing the
GameView shows any turn already committed to the campaign log; resubmitting the same clientTurnId
does not execute it again. Narration failures retain the engine result with a mechanical summary.
Canon flags support Keep canon & regenerate via reroll. Retcon/edit needs the later canon-editing
events; it is not implemented as a direct state mutation.

GameView exposes the PC sheet, effective skills, public world name/opening, current location and
same-zone names, plus player turn history. It never serializes the full world bible, NPC sheets,
private facts, raw canon records or engine RNG. Generated NPC secrets stay out of the draft preview.
The M2 guard remains v1; full secret/witness guarding is M5.

## Verify

```sh
bun run check
bun run build
bunx playwright install chromium
bun run test:e2e
bun audit
```

The browser suite uses an isolated temporary WYRD_HOME and a scripted FakeProvider. It covers
desktop/phone play, clarification, guard regeneration, rerolls, refresh, model settings, usage,
keyboard-accessible sheets, narrow layouts, clean browser console and automated WCAG checks.
Styles injected by dialog primitives use a fresh per-page CSP nonce. CI builds on Windows and Linux
and runs the browser suite on Linux. Real provider calls never run in CI.

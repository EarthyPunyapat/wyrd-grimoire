# UI 2.0 U6 — presets and dials (2026-10-29)

Spec: [Wyrd 2.0 design](../specs/2026-10-29-wyrd-2-design.md) §12. Decision: D150, D158.
Roadmap: [W2 roadmap](2026-10-29-w2-roadmap.md) U6.

## Scope

Cockpit (Qud Modern) and Chat (Lantern Glass) join Reader on the same play components. A device
preference selects the preset and four dials: text size, column width, density and motion. The
switch lives in Settings and applies immediately, including mid-campaign. Play.tsx changes only the
`data-preset` switch.

## Design

- **Storage:** `wyrd-play-preferences` in localStorage, validated field by field. Unknown values
  fall back to Reader / Standard / Comfortable / Full. Presets are device preferences like the
  existing theme and print size; the event log does not change.
- **Settings:** `PlayPreferencesPanel` in the app Settings dialog. Preset buttons use
  `aria-pressed`; dials are labelled selects. A disabled "Visual Novel" slot reserves M8's preset.
- **Play:** `usePlayPreset()` subscribes to one custom event and the `storage` event; Play sets
  `data-preset` on `<main>` and `<html>` while mounted.
- **Dials:** `data-text-size`, `data-column`, `data-density`, `data-motion` on `<html>`. They
  scale `--text-scale`, `--measure-scale` and `--density-scale` in `tokens.css`; motion sets the
  motion tokens and disables animations for `none`. `prefers-reduced-motion` always wins.
- **Cockpit:** `cockpit.css`. One dense chrome strip, a grid whose right column is the passage
  log, a watch list of the PC and people present, square cards, 1px selection lines. The log folds
  under the passage below 1000px.
- **Chat:** `chat.css`. True black, no card borders, 14px cards and 12px controls, player input as
  a right-aligned bubble, composer as a sticky pill at the bottom, rounded hotbar actions.
- **Fonts:** Public Sans (Cockpit prose), Inter (Chat prose) and JetBrains Mono (both chrome) are
  bundled from npm for offline/LAN use. Vite inlines the smallest subsets, so the CSP allows
  `data:` fonts.

## Tests (red → green)

1. `apps/web/test/presets.test.ts`: defaults, per-field fallback, storage round-trip, blocked
   storage, dial data attributes, distinct option lists.
2. `apps/web/test/play-preferences.test.tsx`: all three presets, pressed state, four dials,
   Visual Novel placeholder, hints.
3. `apps/server/test/app.test.ts`: CSP allows bundled font data.
4. `e2e/presets.e2e.ts`: switch Cockpit mid-campaign; right-hand log and watch list; 1px menu
   selection line; switch Chat; true black and 999px bubble; switch back and reload; all dials
   change the story/measure and persist; axe on Cockpit and Chat on desktop and phone.
5. Existing design-token tests keep every preset's palette and contrast honest.

## Validation

`bun run typecheck`, `bun run lint`, `bun test` (790), `bun run build`, and the full Playwright
suite sequentially with one worker: 51 passed, 3 existing skips.

## Deliberate limits

- The watch list shows the PC and people currently in the scene. Workstream E's `WatchAdded`
  entities can replace the source later without changing the component's place in the rail.
- Light/dark is the existing appearance setting; the presets are dark by design. The four dials
  requested by §12 are text size, column width, density and motion.

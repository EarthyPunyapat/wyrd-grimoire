---
name: Wyrd Grimoire
description: A solo, AI-narrated RPG read in long night sessions.
colors:
  void-ink: "#0d0e10"
  page: "#131417"
  page-raised: "#181a1e"
  rule: "#23252a"
  rule-strong: "#3a3d44"
  rule-gold: "#3a3221"
  moonpaper: "#ecebe6"
  marginal-grey: "#9a9a96"
  faint-grey: "#77776f"
  lantern-green: "#3ddc97"
  lantern-gold: "#f2b33d"
  lantern-red: "#e5566f"
  lantern-cyan: "#5cc8e0"
  ari-gold: "#e2b552"
  gold-deep: "#a88a4a"
  canon-red: "#e5566f"
  signal-cyan: "#5cc8e0"
  link-hover: "#8fdcec"
  speaker-blue: "#b3c8ff"
  atlas-sand: "#e3cda4"
typography:
  display:
    fontFamily: "Newsreader, Iowan Old Style, Georgia, serif"
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "0em"
  chapter-numeral:
    fontFamily: "Newsreader, Iowan Old Style, Georgia, serif"
    fontSize: "56px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0em"
  reading:
    fontFamily: "Newsreader, Iowan Old Style, Georgia, serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0em"
  chrome:
    fontFamily: "IBM Plex Mono, Cascadia Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.01em"
  choice:
    fontFamily: "Newsreader, Iowan Old Style, Georgia, serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0em"
  speaker:
    fontFamily: "Newsreader, Iowan Old Style, Georgia, serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0em"
  result:
    fontFamily: "IBM Plex Mono, Cascadia Mono, ui-monospace, monospace"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0em"
  item:
    fontFamily: "Newsreader, Iowan Old Style, Georgia, serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  key:
    fontFamily: "IBM Plex Mono, Cascadia Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0em"
  input:
    fontFamily: "Newsreader, Iowan Old Style, Georgia, serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0em"
rounded:
  none: "0px"
  card: "14px"
  control: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "22px"
  xxl: "32px"
  xxxl: "40px"
  xxxxl: "56px"
components:
  status-strip:
    backgroundColor: "{colors.void-ink}"
    textColor: "{colors.marginal-grey}"
    typography: "{typography.chrome}"
    padding: "12px 40px"
    height: "44px"
  chapter-numeral:
    textColor: "{colors.lantern-green}"
    typography: "{typography.chapter-numeral}"
  speaker-block:
    textColor: "{colors.speaker-blue}"
    typography: "{typography.reading}"
    padding: "0 0 0 20px"
  margin-note:
    backgroundColor: "{colors.void-ink}"
    textColor: "{colors.marginal-grey}"
    typography: "{typography.chrome}"
    padding: "10px 0 0"
    width: "240px"
  choice:
    backgroundColor: "{colors.void-ink}"
    textColor: "{colors.moonpaper}"
    typography: "{typography.choice}"
    rounded: "{rounded.none}"
    padding: "10px 0"
    height: "44px"
  composer:
    backgroundColor: "{colors.void-ink}"
    textColor: "{colors.moonpaper}"
    typography: "{typography.input}"
    height: "44px"
  hotbar:
    backgroundColor: "{colors.void-ink}"
    textColor: "{colors.moonpaper}"
    typography: "{typography.chrome}"
    padding: "10px 40px 14px"
    height: "64px"
  item-card:
    backgroundColor: "{colors.page}"
    textColor: "{colors.moonpaper}"
    typography: "{typography.reading}"
    rounded: "{rounded.none}"
    padding: "14px"
---

# Design System: Wyrd Grimoire

## Overview

**Creative North Star: "The Night Codex."**

Wyrd is read, not watched. The screen is a lit page in a dark room: near-black paper, bone-coloured ink, one lantern hue, and thin ruled lines instead of boxes. The story takes the reading column; every piece of machinery — the status strip, rolls, clocks, key hints, item metadata — takes the monospace chrome column. That split is the identity. It is why the same play screen can feel like a book, a terminal, or a chat without becoming three different products.

The system comes from the owner-picked Night Codex mockup (D150). All three presets — Reader (default), Cockpit and Chat — share one shell, one set of meaning-bearing accents and one per-campaign hue. They change only ground, type, measure, rhythm and corner shape. Reader is the precedence: if a decision is unclear, resolve it as the book page.

**Key Characteristics:**

- One campaign hue, three fixed signal accents, zero decorative colour.
- A reading-font slot and a monospace chrome slot; the roles never swap.
- 1px rules and flat surfaces; no shadows, glass or glow.
- A 660px reading column with margin notes as annotations, not a sidebar.
- 44px targets, keyboard-first hints, and text that stays above WCAG AA.

## Colors

A near-black ground, warm bone ink, and a small set of colours that each carry one meaning.

### Primary

- **Lantern Green** (#3ddc97): the default campaign hue. It marks the chapter numeral, the level numeral, choice numbers, success, the active selection, the caret and the focus ring. The other sanctioned hues are **Lantern Gold** (#f2b33d), **Lantern Red** (#e5566f) and **Lantern Cyan** (#5cc8e0). A campaign picks exactly one; the CSS slot is `--hue`.
- **Campaign hue** is the only colour that changes between campaigns. Everything else is fixed.

### Secondary

- **Ari Gold** (#e2b552): companions, artifacts and items, delegated actions, and critical results. In the mockup it is Ari's name, the AXIOM PRIME card and the Delegate action. It is never used for danger. **Gold Deep** (#a88a4a) is its pressed and secondary-on-dark step.
- **Canon Red** (#e5566f): harm, danger, hostile factions, failed states and canon clocks. Canon clocks are red because they are moving without the player.
- **Signal Cyan** (#5cc8e0): links, cross-references and faction tint. It is the "this opens something" colour, not a success colour. **Link Hover** (#8fdcec) is its hover step.

### Neutral

- **Void Ink** (#0d0e10): Reader's ground. Chat uses true black (#000000); Cockpit uses a cool near-black (#101314).
- **Page** (#131417): a raised surface one step above Void Ink. **Page Raised** (#181a1e) is the second step.
- **Rule** (#23252a): every ordinary 1px division. **Rule Strong** (#3a3d44) is the composer underline and other interactive rules. **Rule Gold** (#3a3221) is the tinted rule around an artifact note.
- **Moonpaper** (#ecebe6): prose and primary labels. **Marginal Grey** (#9a9a96): chrome, metadata, annotations. **Faint Grey** (#77776f): disabled and tertiary text, never body copy.
- **Speaker Blue** (#b3c8ff): people and speakers. **Atlas Sand** (#e3cda4): places. Items and companions use Ari Gold; factions use Signal Cyan.

### Named Rules

**The One Lantern Rule.** A campaign has exactly one hue. It is the only variable colour on the screen; adding a second accent is a redesign, not a customisation.

**The Signal Trio Rule.** Gold means companion or item, red means danger or canon, cyan means link or faction. Never reassign a signal to make a layout prettier.

**The Type Is Named Rule.** Entity tint is never the only cue. Every reference also carries a type in its card and a dotted underline, so a player who cannot distinguish the hues still knows what they are looking at.

## Typography

**Display Font:** Newsreader (with Iowan Old Style, Georgia, serif)
**Body Font:** Newsreader (same stack)
**Chrome / Label Font:** IBM Plex Mono (with Cascadia Mono, ui-monospace, monospace)

**Character:** A book face carries the story; a terminal face carries the machinery. The pairing is the product: mythic prose on one line, an exact d20 result on the next. The chrome face is not a costume for "technical" — it is used for numbers, keys, times, rolls, clocks, metadata and anything that must align in a column.

### Hierarchy

- **Chapter numeral** (400, 56px, line-height 1): the hue-coloured Roman or Arabic numeral at the head of a chapter. Reader only.
- **Chapter title** (400 italic, 34px, line-height 1.1): the passage or scene title. Sentence case, no tracking.
- **Reading** (400, 20px, line-height 1.7, 660px measure): all prose and dialogue. 65–75 characters per line.
- **Speaker** (400 italic, 16px): the name above a speaker block, tinted by speaker type.
- **Choice** (400, 18px, line-height 1.4): the player's next move; the consequence is italic and muted on the same line.
- **Chrome** (400, 12px, line-height 1.6): status strip, margin notes, hotbar, key hints, item metadata. Use `font-variant-numeric: tabular-nums` on every changing number.
- **Result** (400, 22px, line-height 1.2): the large number in a roll note, in Moonpaper. It is the one chrome size that may jump.
- **Item** (400, 15px, line-height 1.5): the one-sentence description inside an item card, in the reading slot.
- **Key** (400, 13px, line-height 1.4): the letter or digit inside a choice, hotbar action or menu hint.
- **Input** (400 italic, 19px): the composer's text. The placeholder is the only italic chrome-adjacent reading text.

The reading-font slot is `--font-read`; the chrome slot is `--font-chrome`. Cockpit swaps them to Public Sans and JetBrains Mono; Chat swaps them to Inter and JetBrains Mono. The roles do not change.

### Named Rules

**The Two Faces Rule.** Story text uses the reading slot; every number, key, clock, roll and label uses the chrome slot. Never set body prose in monospace, and never set a roll result in the serif.

**The Tabular Rule.** Any number that can change — level, roll, clock segment, time, HP, currency — uses tabular figures. Proportional figures make a living character sheet twitch.

**The No Kicker Rule.** A heading carries its own weight. No eyebrow, no category label, no all-caps kicker above a chapter title.

## Layout

Reader is a centred page inside fixed chrome. The status strip is a 44px full-width band. The story area is a 660px reading column plus a 240px margin-note rail, separated by 40px and centred with 40px outer gutters. Vertical rhythm is 22px. The composer sits under the reading column and the 64px hotbar is pinned to the bottom. The story scrolls between the two fixed bands; the chrome never scrolls away.

Margin notes annotate the passage beside them: a roll note, an item note, a watch list. They stack with 1px rules and align to the top of the passage, not to the page. On a narrow window the rail folds under the passage as a margin strip; it never becomes a competing column. At phone width the status strip wraps, the hotbar scrolls horizontally, and every control keeps a 44px target.

| Preset | Ground | Reading column | Rail | Rhythm | Gutter |
|---|---|---|---|---|---|
| **Reader** (default) | #0d0e10 | 660px | 240px margin notes | 22px | 40px |
| **Cockpit** | #101314 | 720px | 300px log + watch | 18px | 32px |
| **Chat** | #000000 | 720px | none | 16px | 28px |

All presets share the status strip, composer, choice list, cards, hotbar and keyboard map. Only layout, fonts and spacing change (D150).

### Named Rules

**The 66-Character Rule.** Reader prose is 660px wide — about 66 characters at 20px. Never full-bleed the story to gain density; density belongs to Cockpit.

**The Fixed Chrome Rule.** The status strip and hotbar are fixed chrome. The story scrolls between them; the page does not scroll the chrome out of reach.

**The One Column Rule.** Reader has one reading column. Margin notes are annotations. A second content column is a different preset, not a Reader layout.

## Elevation & Depth

There are no shadows. Every surface is flat at rest, on hover and in a dialog. Reader and Cockpit divide with 1px rules; Chat divides with lightness steps only (#000000 ground, #111111 card, #1c1c1c nested control) and rounded corners. Depth is never communicated by a shadow, a glow, a coloured halo or a backdrop blur. A dialog may sit on a single dark scrim; that scrim is opaque enough to separate, not glassy.

### Named Rules

**The No Shadow Rule.** If an element needs to separate, use a rule, a lightness step or spacing. A `box-shadow` is a bug in this system.

**The No Glass Rule.** No `backdrop-filter`, no frosted panels, no gradient text. "Lantern Glass" is a flat true-black preset, not a glassmorphism theme.

## Shapes

Reader and Cockpit are square: 0px cards, 0px controls, 1px rules. Chat is the only rounded preset: 14px cards, 12px controls, 999px pills and a 999px composer. Avatars follow the preset: square monograms in Cockpit, circles in Chat, no portrait in Reader (the italic speaker name is the portrait).

No double borders: a card is either a rule or a fill, never both. No coloured `border-left` above 1px. No nested cards.

### Named Rules

**The One Border Rule.** One 1px rule per division. A filled surface does not also get a border; a bordered surface does not also get a shadow.

## Components

### Status Strip

The signature component: a 44px band of 12px monospace, tabular figures, and no fill beyond the ground. Left to right: the wordmark, the character's name and level, location, game time, then the companion clock and the menu hints. It wraps rather than truncating on a phone. `C I Q J M` are keyboard hints with accessible labels, never the only name of a menu.

- **Shape:** 1px bottom rule, 0px radius, 44px height.
- **Colour:** Marginal Grey for chrome; Moonpaper for the name; the campaign hue for the level numeral; Ari Gold for a companion clock.
- **State:** the active menu hint takes a 1px hue underline on the nearest edge.

### Chapter Heading (Reader)

A 56px hue numeral, a 34px italic title, and a 12px mono locator on a shared baseline. The numeral is the chapter's index; it is not decoration and it must be the actual chapter number. The title is sentence case; the locator names place and time of day.

- **Shape:** no box, no rule above; the numeral and title share a baseline.
- **Colour:** numeral in the campaign hue; title in Moonpaper; locator in Marginal Grey.

### Speaker Block

Dialogue is indented 20px with a 16px italic speaker name above the line. The name is tinted by type: Speaker Blue for people, Ari Gold for companions, Canon Red for hostile speakers. The name is also the accessible label for the block; do not rely on the tint alone.

- **Shape:** no avatar in Reader; a 32px square monogram in Cockpit; a 36px circle in Chat.
- **Colour:** speaker name in the type tint; dialogue in Moonpaper.
- **State:** the block is static; a speaker is not a button unless the name opens a reference card.

### Margin Note

The Reader's card substitute. A 240px annotation with a 1px top rule, 12px chrome and 10px of air. Three variants share the anatomy: **roll** (label, big result, die + modifier vs target, one-line outcome), **item** (icon, gold name, type line, one-sentence description) and **watch** (label, one or two entities, a red canon clock). The item variant uses Rule Gold; the others use Rule.

- **Shape:** 0px radius, 1px top rule, no fill in Reader.
- **Colour:** labels in Marginal Grey; numbers in Moonpaper; outcomes in the campaign hue; danger in Canon Red; items in Ari Gold.
- **State:** an item note is a button; hover and focus darken it to Page and move the rule to Ari Gold.

### Choice List

One column, one choice per row, separated by 1px rules. A hue number, a Moonpaper label, and an italic Marginal Grey consequence. The row is 44px minimum and the whole row is the target. Choices never become filled pills in Reader.

- **Shape:** 0px radius; 1px top rule, 1px bottom rule on the last row; 10px vertical padding.
- **Colour:** number in the campaign hue; label in Moonpaper; consequence in Marginal Grey.
- **State:** hover and focus use Page as a background, move the rule to the hue, and keep the 2px hue focus ring. Disabled rows drop to Faint Grey and lose the pointer.

### Composer

A label and a single underline. 12px chrome label, 19px italic reading input, 44px minimum. The underline uses Rule Strong at rest and the campaign hue on focus. `/` focuses it; the placeholder names `/gm`. No box, no send button in Reader — Enter sends.

- **Shape:** 0px radius, 0px side and top borders, 1px bottom border.
- **Colour:** Moonpaper text, Marginal Grey label and placeholder, hue focus underline.
- **State:** focus is the hue underline plus the global 2px hue ring; busy state keeps the text and adds a chrome line below, never a spinner that shifts layout.

### Hotbar

A 64px band of 12px chrome, centred, with 44px targets and 28px gaps. Each action is a letter hint plus its name; the letter is muted and the name is Moonpaper. The companion action (Delegate to Ari) uses Ari Gold and Rule Gold. The hotbar scrolls horizontally on a phone rather than wrapping into a second row.

- **Shape:** 1px top rule, 0px radius, 64px height.
- **Colour:** hint in Marginal Grey; action in Moonpaper; companion action in Ari Gold.
- **State:** hover and focus underline the action in the campaign hue; disabled actions drop to Faint Grey. A key hint is never the accessible name.

### Item Card

The same anatomy in every preset: icon, name, type line, description. Reader shows it as a margin note; Cockpit and Chat show it as a card. The type line always prints the type (`Artifact · worn · ∞`), so the gold tint is not the only information.

- **Shape:** 0px radius in Reader and Cockpit; 14px in Chat.
- **Colour:** name in Ari Gold; type and metadata in Marginal Grey; description in Moonpaper.
- **State:** hover and focus lift the rule or the lightness step; the card itself is the target.

### Entity Reference

A tinted name with a dotted underline. Hover or focus opens the same Item Card anatomy for people, places, items, factions and companions. The card names the type; the reference has an accessible description; the tint never carries meaning alone.

## Do's and Don'ts

### Do:

- **Do** keep exactly one campaign hue and the three fixed signals; put the hue in `--hue` and use `var(--accent)`.
- **Do** keep prose at 660px in Reader and 20px/1.7; let Cockpit carry the density.
- **Do** use 1px rules, lightness steps and spacing for separation; there is no shadow.
- **Do** give every interactive element a 44px target, a visible hover state and a 2px hue focus ring.
- **Do** use tabular figures for every changing number and monospace for every piece of chrome.
- **Do** theme selection, caret, scrollbars and focus rings from the palette; they are part of the screen.
- **Do** print the entity type in every reference card and keep the dotted underline, so colour is never the only cue.
- **Do** reserve motion for big moments: a d20 tumble, a level flare, an artifact flip, a crit pulse. Respect `prefers-reduced-motion`.
- **Do** check the laptop first, then the phone, at real copy lengths; one browser at a time.

### Don't:

- **Don't** add a second accent, a gradient, a glow or a coloured halo.
- **Don't** use Ari Gold for danger or Canon Red for a companion; the signals are fixed.
- **Don't** use hue as decoration on large fills; it is a line, a numeral, a word or a focus ring.
- **Don't** put a card inside a card, or a shadow on a bordered surface.
- **Don't** round Reader or Cockpit cards; the book page is square.
- **Don't** set long prose in monospace or rolls in the serif.
- **Don't** use all-caps tracking as a default label style; sentence case is the voice.
- **Don't** make a menu hint the only label for a control.
- **Don't** animate every passage or every hover; motion is a punctuation mark, not a texture.
- **Don't** let a secondary panel compete with the reading column in Reader.

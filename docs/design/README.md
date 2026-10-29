# Design targets

Two visual targets live here. The Wyrd 2.0 design system is documented in [`DESIGN.md`](../../DESIGN.md) and implemented as tokens in [`apps/web/src/tokens.css`](../../apps/web/src/tokens.css). Set `data-preset="reader" | "cockpit" | "chat"` on the play shell, and set the campaign's `--hue` on the same element (or an ancestor); `--accent` follows it. U3 applies the Reader preset to the play screen; U6 adds the other two.

- [`night-codex.html`](night-codex.html) is the owner-picked **Reader / Night Codex** mockup from W2 (D150): book serif prose, chapter numerals, rolls and items as margin notes. It is the default preset and the precedence for U3. The live canvas is `QqntzRCbefQp8qGs6PfETf`; this file is the self-contained copy.
- [`play-and-combat.html`](play-and-combat.html) is the older, static mockup of the play screen in the `fantasy-core` theme. Open it in a browser; switch between the **Exploration** and **Combat** views with the toggle at the top, and narrow the window below 768 px to see the phone layout.

The older `play-and-combat` mockup fixed this for milestone 3 onward:

- **Layout:** top bar; a narration column of about 68 characters with the composer (suggestion chips + input) pinned beneath it; a 360 px right panel with tabs. On phones the panel becomes a bottom sheet opened from a tab bar, and combat adds an initiative strip above the input.
- **Narration:** player input echoed as a muted line; prose in a book face; dialogue lines with speaker name and portrait; per-passage Play and Reroll; a collapsible mechanics log in monospace with a glyph *and* a word for every degree.
- **Clarification card** with numbered options.
- **Combat panel:** initiative strip, zone diagram with tokens and engagement lines, AP pips, legal action chips with AP costs (illegal ones disabled with a reason), target card with a wound silhouette.
- **Sheet:** HP bar showing the max-HP reduction from unhealed wounds, Luck pips, wound silhouette, attributes, skills, quests.
- **Theme tokens** for `fantasy-core` (stone vellum, iron-gall ink, verdigris accent, gilt for criticals and the PC, oxblood for harm), in light and dark.

The mockup's numbers follow the rules in the spec (d100, HP = 10 + END × 2, WT = END + ⌊STR/2⌋, hit locations, opposed checks). Where the mockup and the spec disagree, **the spec wins**; fix the mockup.

Images in the mockup are placeholders. In the app, scene art and portraits come from the media pipeline ([10-media.md](../spec/10-media.md)).

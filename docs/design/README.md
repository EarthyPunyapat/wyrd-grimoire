# Design targets

[`play-and-combat.html`](play-and-combat.html) is a static, self-contained mockup of the play screen in the `fantasy-core` theme. Open it in a browser; switch between the **Exploration** and **Combat** views with the toggle at the top, and narrow the window below 768 px to see the phone layout.

What it fixes as the visual target for milestone 3 onward:

- **Layout:** top bar; a narration column of about 68 characters with the composer (suggestion chips + input) pinned beneath it; a 360 px right panel with tabs. On phones the panel becomes a bottom sheet opened from a tab bar, and combat adds an initiative strip above the input.
- **Narration:** player input echoed as a muted line; prose in a book face; dialogue lines with speaker name and portrait; per-passage Play and Reroll; a collapsible mechanics log in monospace with a glyph *and* a word for every degree.
- **Clarification card** with numbered options.
- **Combat panel:** initiative strip, zone diagram with tokens and engagement lines, AP pips, legal action chips with AP costs (illegal ones disabled with a reason), target card with a wound silhouette.
- **Sheet:** HP bar showing the max-HP reduction from unhealed wounds, Luck pips, wound silhouette, attributes, skills, quests.
- **Theme tokens** for `fantasy-core` (stone vellum, iron-gall ink, verdigris accent, gilt for criticals and the PC, oxblood for harm), in light and dark.

The mockup's numbers follow the rules in the spec (d100, HP = 10 + END × 2, WT = END + ⌊STR/2⌋, hit locations, opposed checks). Where the mockup and the spec disagree, **the spec wins**; fix the mockup.

Images in the mockup are placeholders. In the app, scene art and portraits come from the media pipeline ([10-media.md](../spec/10-media.md)).

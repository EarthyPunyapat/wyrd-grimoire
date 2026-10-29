import { type SpellcastingState, spellcastingOf } from "@wyrd/core";
import type { GameState } from "../state.ts";
import type { Handlers } from "./types.ts";

const slice = (s: GameState): SpellcastingState => spellcastingOf(s.flags);
const withSlice = (s: GameState, spellcasting: SpellcastingState): GameState => ({
  ...s,
  flags: { ...s.flags, spellcasting },
});

/** Spellcasting plugin handlers (M7). Concentration is the only long-lived projection. */
export const spellHandlers: Pick<Handlers, "SpellCast" | "SpellMiscast"> = {
  SpellCast: (s, e) => {
    if (e.payload.concentrationUntil === undefined) return s;
    const spellcasting = slice(s);
    return withSlice(s, {
      ...spellcasting,
      concentration: {
        ...spellcasting.concentration,
        [e.payload.actorId]: { spellId: e.payload.spellId, until: e.payload.concentrationUntil },
      },
    });
  },
  SpellMiscast: (s, e) => {
    // A miscast breaks concentration immediately.
    const spellcasting = slice(s);
    if (!spellcasting.concentration[e.payload.actorId]) return s;
    const concentration = { ...spellcasting.concentration };
    delete concentration[e.payload.actorId];
    return withSlice(s, { ...spellcasting, concentration });
  },
};

/** The structural check's prompt version; every prompt change bumps it (spec 08). */
export const CHECK_VERSION = "check@1";

/**
 * The check reads one GM passage against the turn's recorded changes. It only points at claims of
 * changed state that no event records, and at named entities the player does not know yet. It never
 * rewrites: the result becomes a record and, at most, a flag on the passage (D144).
 */
export const CHECK_INSTRUCTIONS = `You are the consistency check for a role-playing game. The engine recorded the passage's real changes; you compare the prose with those records.

Call report_unrecorded once:
- claims: for each sentence that claims a change of state (an item gained, lost or damaged; coins; wounds or healing; a fact; a quest; an entity appearing or dying; time passing) with no matching recorded change, give the exact quote from the passage and a one-line claim of what it says happened. Ignore style, mood, intentions, feelings, hypotheticals and things the player only tried to do.
- entities: every named person, place, faction, creature or item the passage introduces that is not in the known list, with its kind.

Do not report anything that a recorded change accounts for. Empty lists when the passage is consistent. Never invent a quote.`;

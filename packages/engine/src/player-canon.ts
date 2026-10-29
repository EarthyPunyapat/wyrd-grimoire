import { type CharacterSheet, draft, type EventDraft, Fact, type PlayerGear } from "@wyrd/core";

const hasAppearance = (a: CharacterSheet["identity"]["appearance"]): boolean =>
  a.marks.length > 0 || Boolean(a.build || a.hair || a.eyes || a.skin || a.clothingStyle);

/**
 * The player's own creation writing as canon: gear, background, backstory, appearance and the
 * campaign pitch. Every fact is `source: "player"`, importance 5, and pinned so no trimmer or
 * retcon can quietly drop it (D147).
 */
export function playerCanonEvents(o: {
  pcId: string;
  sheet: CharacterSheet;
  gear: PlayerGear[];
  pitch?: string;
  newId: () => string;
}): EventDraft[] {
  const facts: Array<{ entityId: string; predicate: string; value: string }> = [];
  for (const gear of o.gear) {
    const name = gear.name.trim();
    if (!name) continue;
    facts.push({
      entityId: o.pcId,
      predicate: "carries",
      value: gear.description.trim() ? `${name}: ${gear.description.trim()}` : name,
    });
  }
  const identity = o.sheet.identity;
  if (identity.background.trim())
    facts.push({ entityId: o.pcId, predicate: "background", value: identity.background.trim() });
  if (identity.backstory.trim())
    facts.push({ entityId: o.pcId, predicate: "backstory", value: identity.backstory.trim() });
  if (hasAppearance(identity.appearance))
    facts.push({
      entityId: o.pcId,
      predicate: "appearance",
      value: JSON.stringify(identity.appearance),
    });
  if (o.pitch?.trim())
    facts.push({ entityId: "concept:world-bible", predicate: "pitch", value: o.pitch.trim() });

  return facts.flatMap((f) => {
    const fact = Fact.parse({
      id: o.newId(),
      entityId: f.entityId,
      predicate: f.predicate,
      value: f.value,
      source: "player",
      visibility: "public",
      importance: 5,
    });
    return [
      draft("FactAsserted", { fact }, "player"),
      draft("FactPinned", { factId: fact.id, pinned: true }, "player"),
    ];
  });
}

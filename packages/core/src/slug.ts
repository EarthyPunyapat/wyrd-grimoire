/**
 * A lowercase ASCII slug for a player- or GM-written name (D146/D149). Everything that is not an
 * ASCII letter or digit collapses to a hyphen; a name with nothing usable falls back.
 */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export type PlayerGearEntry = { id: string; name: string; qty: number };

/**
 * Stable ids for player-written gear: one per case-insensitive name, with duplicate names summed
 * into one quantity. Non-Latin-only names fall back to `item-<first index + 1>`.
 */
export function playerGearIds(gear: { name: string }[]): PlayerGearEntry[] {
  const out: PlayerGearEntry[] = [];
  const byName = new Map<string, PlayerGearEntry>();
  gear.forEach((g, i) => {
    const name = g.name.trim();
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.qty++;
      return;
    }
    const entry = { id: `player:${slugify(name, `item-${i + 1}`)}`, name, qty: 1 };
    byName.set(key, entry);
    out.push(entry);
  });
  return out;
}

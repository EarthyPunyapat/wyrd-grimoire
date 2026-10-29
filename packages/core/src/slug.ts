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

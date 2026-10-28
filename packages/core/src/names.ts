/**
 * Name registry helpers (spec 06, Names): duplicates and near-duplicates across canon are refused,
 * using a normalised edit distance so "Aldric Vane" and "Aldrick Vane" count as the same name.
 */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** True when two names are the same or too close to tell apart (normalised distance ≤ 0.15). */
export function namesClash(a: string, b: string): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return levenshtein(x, y) / Math.max(x.length, y.length) <= 0.15;
}

/** Every name in `names` that clashes with an earlier one or with `taken`. */
export function nameClashes(names: readonly string[], taken: readonly string[] = []): string[] {
  const seen = [...taken];
  const clashes: string[] = [];
  for (const n of names) {
    if (seen.some((s) => namesClash(s, n))) clashes.push(n);
    seen.push(n);
  }
  return clashes;
}

/** Minimal semver range check for pack manifests: space-separated comparators, e.g. ">=1.0.0 <2.0.0". */

type Version = [number, number, number];

export function parseVersion(v: string): Version | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Returns true/false, or null when the range is malformed. */
export function satisfies(version: string, range: string): boolean | null {
  const v = parseVersion(version);
  if (!v) return null;
  const parts = range.trim().split(/\s+/);
  for (const part of parts) {
    const m = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(part);
    if (!m) return null;
    const target = parseVersion(m[2]!)!;
    const c = compare(v, target);
    const ok =
      m[1] === ">=" ? c >= 0 : m[1] === "<=" ? c <= 0 : m[1] === ">" ? c > 0 : m[1] === "<" ? c < 0 : c === 0;
    if (!ok) return false;
  }
  return true;
}

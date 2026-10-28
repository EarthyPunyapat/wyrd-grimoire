/**
 * ULIDs: 48-bit millisecond timestamp + 80 random bits, Crockford base32, lexicographically sortable.
 *
 * `core` does no IO, so the clock and entropy source are injected. Callers outside the engine
 * (storage, server, CLI) build a factory with `Date.now` and `crypto.getRandomValues`.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export type UlidSources = {
  now: () => number;
  random: (bytes: number) => Uint8Array;
};

export function createUlidFactory(sources: UlidSources): () => string {
  let lastTime = -1;
  let lastRandom: number[] = [];

  return () => {
    const time = sources.now();
    if (time === lastTime) {
      lastRandom = incrementBase32(lastRandom);
    } else {
      lastTime = time;
      const bytes = sources.random(16);
      lastRandom = Array.from({ length: 16 }, (_, i) => (bytes[i] ?? 0) % 32);
    }
    return encodeTime(time) + lastRandom.map((d) => ALPHABET[d]).join("");
  };
}

function encodeTime(time: number): string {
  if (!Number.isInteger(time) || time < 0 || time > 2 ** 48 - 1) {
    throw new RangeError(`ULID time out of range: ${time}`);
  }
  let out = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

/** Monotonic increment of the random part; overflow is astronomically unlikely and is an error. */
function incrementBase32(digits: number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i--) {
    const d = next[i] ?? 0;
    if (d < 31) {
      next[i] = d + 1;
      return next;
    }
    next[i] = 0;
  }
  throw new Error("ULID random component overflowed within one millisecond");
}

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}

export function decodeUlidTime(id: string): number {
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}

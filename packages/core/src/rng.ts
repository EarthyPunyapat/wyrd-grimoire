/**
 * Seeded PRNG: xoshiro128** (32-bit words, period 2^128 − 1).
 *
 * The state is four uint32 words and lives in game state, so a campaign's dice are reproducible.
 * Every roll is also recorded in its event: replay re-applies results and never re-rolls.
 */

export type RngState = readonly [number, number, number, number];

/** Expands a seed into a full xoshiro state with splitmix32, so similar seeds give unrelated streams. */
export function seedRng(seed: number | string): RngState {
  let x = typeof seed === "number" ? seed >>> 0 : hashString(seed);
  const next = (): number => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const state: [number, number, number, number] = [next(), next(), next(), next()];
  // An all-zero state would lock the generator at zero forever.
  if (state.every((w) => w === 0)) state[0] = 1;
  return state;
}

/** FNV-1a, enough to turn a string seed into 32 bits. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(state: RngState) {
    [this.s0, this.s1, this.s2, this.s3] = state;
  }

  /** A copy of the current state, safe to store in game state or an event. */
  get state(): RngState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform integer in [min, max], inclusive, without modulo bias. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Rng.int: invalid range [${min}, ${max}]`);
    }
    const span = max - min + 1;
    if (span > 0x100000000) throw new RangeError("Rng.int: range wider than 2^32");
    // Reject the top slice of the 32-bit range that doesn't divide evenly by span.
    const limit = 0x100000000 - (0x100000000 % span);
    let v = this.nextU32();
    while (v >= limit) v = this.nextU32();
    return min + (v % span);
  }

  /** Roll one die with the given number of sides: 1..sides. */
  die(sides: number): number {
    return this.int(1, sides);
  }
}

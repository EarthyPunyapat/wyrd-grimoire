import { describe, expect, test } from "bun:test";
import { Rng, seedRng } from "../src/rng.ts";

describe("seedRng", () => {
  test("same seed gives the same state", () => {
    expect(seedRng(42)).toEqual(seedRng(42));
    expect(seedRng("campaign-a")).toEqual(seedRng("campaign-a"));
  });

  test("different seeds give different states", () => {
    expect(seedRng(1)).not.toEqual(seedRng(2));
    expect(seedRng("a")).not.toEqual(seedRng("b"));
  });

  test("state is never all zero", () => {
    expect(seedRng(0).some((w) => w !== 0)).toBe(true);
  });
});

describe("Rng", () => {
  test("is deterministic for a given state", () => {
    const a = new Rng(seedRng(7));
    const b = new Rng(seedRng(7));
    const xs = Array.from({ length: 50 }, () => a.nextU32());
    const ys = Array.from({ length: 50 }, () => b.nextU32());
    expect(xs).toEqual(ys);
  });

  test("resuming from an exported state continues the same sequence", () => {
    const a = new Rng(seedRng(99));
    for (let i = 0; i < 10; i++) a.nextU32();
    const resumed = new Rng(a.state);
    const fromA = Array.from({ length: 20 }, () => a.nextU32());
    const fromResumed = Array.from({ length: 20 }, () => resumed.nextU32());
    expect(fromResumed).toEqual(fromA);
  });

  test("exported state is a copy, not a live view", () => {
    const rng = new Rng(seedRng(3));
    const before = rng.state;
    rng.nextU32();
    expect(rng.state).not.toEqual(before);
  });

  test("nextU32 stays in the unsigned 32-bit range", () => {
    const rng = new Rng(seedRng(5));
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextU32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  test("int is inclusive and covers the whole range", () => {
    const rng = new Rng(seedRng(11));
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("die(100) is roughly uniform under a fixed seed", () => {
    const rng = new Rng(seedRng(2026));
    const counts = new Array(100).fill(0);
    const n = 200_000;
    for (let i = 0; i < n; i++) counts[rng.die(100) - 1]++;
    for (const c of counts) expect(Math.abs(c - n / 100)).toBeLessThan(n / 100 / 5);
  });

  test("rejects invalid ranges", () => {
    const rng = new Rng(seedRng(1));
    expect(() => rng.int(5, 4)).toThrow();
    expect(() => rng.int(1.5, 4)).toThrow();
    expect(() => rng.die(0)).toThrow();
  });
});

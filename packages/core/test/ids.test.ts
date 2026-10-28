import { describe, expect, test } from "bun:test";
import { createUlidFactory, decodeUlidTime, isUlid } from "../src/ids.ts";

const fixedRandom = (fill: number) => (n: number) => new Uint8Array(n).fill(fill);

describe("ULIDs", () => {
  test("are 26 Crockford base32 characters", () => {
    const ulid = createUlidFactory({ now: () => 1_700_000_000_000, random: fixedRandom(7) });
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  test("encode the timestamp in the first 10 characters", () => {
    const ulid = createUlidFactory({ now: () => 1_700_000_000_000, random: fixedRandom(0) });
    expect(decodeUlidTime(ulid())).toBe(1_700_000_000_000);
  });

  test("sort by time", () => {
    let t = 1_000;
    const ulid = createUlidFactory({ now: () => t, random: fixedRandom(200) });
    const a = ulid();
    t = 2_000;
    const b = ulid();
    expect(a < b).toBe(true);
  });

  test("are monotonic within the same millisecond", () => {
    const ulid = createUlidFactory({ now: () => 5_000, random: fixedRandom(100) });
    const ids = Array.from({ length: 5 }, () => ulid());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(5);
  });

  test("isUlid rejects malformed strings", () => {
    expect(isUlid("not-a-ulid")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAU")).toBe(false); // contains U
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
  });
});

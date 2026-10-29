import { describe, expect, test } from "bun:test";
import { slugify } from "../src/slug.ts";

describe("slugify", () => {
  test("lowercases and joins ASCII words with a hyphen", () => {
    expect(slugify("Yellow lantern ring", "item-1")).toBe("yellow-lantern-ring");
    expect(slugify("  A--B  ", "x")).toBe("a-b");
  });

  test("falls back when nothing ASCII is left", () => {
    expect(slugify("雷の指輪", "item-1")).toBe("item-1");
  });
});

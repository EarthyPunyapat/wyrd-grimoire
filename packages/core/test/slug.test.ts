import { expect, test } from "bun:test";
import { slugify } from "../src/slug.ts";

test("slugify keeps ascii words", () => {
  expect(slugify("Yellow lantern ring", "item-1")).toBe("yellow-lantern-ring");
});

test("slugify falls back for non-latin names", () => {
  expect(slugify("雷の指輪", "item-1")).toBe("item-1");
});

test("slugify collapses runs and trims", () => {
  expect(slugify("  A--B  ", "x")).toBe("a-b");
});

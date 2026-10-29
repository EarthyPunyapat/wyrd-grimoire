import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadPack } from "../src/loader.ts";

/**
 * The starter pack's content floors (spec 05, M7). These are product guarantees: a pack that
 * slips below them is incomplete, so the counts are asserted rather than left to review.
 */
const FANTASY = join(import.meta.dir, "../../../packs/fantasy-core");

describe("fantasy-core content floors", () => {
  const pack = loadPack(FANTASY).pack!;
  const count = (table: Record<string, unknown> | undefined) => Object.keys(table ?? {}).length;

  test("talents: at least 40 across three tiers", () => {
    expect(count(pack.talents)).toBeGreaterThanOrEqual(40);
    expect(new Set(Object.values(pack.talents).map((t) => t.tier))).toEqual(new Set([1, 2, 3]));
  });

  test("weapons: at least 25", () => {
    expect(count(pack.items.weapons)).toBeGreaterThanOrEqual(25);
  });

  test("armour: at least 10", () => {
    expect(count(pack.items.armor)).toBeGreaterThanOrEqual(10);
  });

  test("gear: at least 60", () => {
    expect(count(pack.items.gear)).toBeGreaterThanOrEqual(60);
  });

  test("creatures: at least 30", () => {
    expect(count(pack.creatures)).toBeGreaterThanOrEqual(30);
  });

  test("classes: six classes with ten levels each", () => {
    const classes = Object.values(pack.classes);
    expect(classes.length).toBeGreaterThanOrEqual(6);
    for (const c of classes) expect(c.levels.length).toBeGreaterThanOrEqual(10);
  });
});

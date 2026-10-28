import { describe, expect, test } from "bun:test";
import { defaultTuning } from "@wyrd/core";
import { deriveStats } from "../src/derived.ts";
import { CORE_SKILLS, governingAttribute, skillValue } from "../src/skills.ts";
import { attrs, catalog } from "./fixtures.ts";

describe("derived stats", () => {
  test("average human", () => {
    const d = deriveStats(attrs({}), defaultTuning);
    expect(d).toEqual({ hpMax: 20, wt: 7, carryKg: 25, initiative: 50, composure: 20 });
  });

  test("formulas follow the spec", () => {
    const d = deriveStats(attrs({ str: 7, end: 6, agi: 8, awa: 4, wil: 3 }), defaultTuning);
    expect(d.hpMax).toBe(10 + 6 * 2);
    expect(d.wt).toBe(6 + Math.floor(7 / 2));
    expect(d.carryKg).toBe(35);
    expect(d.initiative).toBe(8 * 5 + 4 * 5);
    expect(d.composure).toBe(10 + 3 * 2);
  });
});

describe("skills", () => {
  test("core skill catalog has every spec skill under the core namespace", () => {
    const ids = CORE_SKILLS.map((s) => s.id);
    for (const id of [
      "core:melee",
      "core:dodge",
      "core:stealth",
      "core:perception",
      "core:lore",
      "core:language",
    ]) {
      expect(ids).toContain(id);
    }
    expect(ids).toHaveLength(25);
    expect(CORE_SKILLS.find((s) => s.id === "core:lore")?.field).toBe(true);
  });

  test("untrained value is governing attribute × 3", () => {
    expect(
      skillValue({ attributes: attrs({ agi: 6 }), skills: {} }, "core:stealth", catalog, defaultTuning),
    ).toBe(18);
  });

  test("trained value adds trained points", () => {
    const sheet = { attributes: attrs({ agi: 6 }), skills: { "core:stealth": { trained: 40 } } };
    expect(skillValue(sheet, "core:stealth", catalog, defaultTuning)).toBe(58);
  });

  test("two governing attributes use the higher", () => {
    const sheet = { attributes: attrs({ str: 4, agi: 7 }), skills: {} };
    expect(governingAttribute(sheet.attributes, catalog["core:melee"]!)).toBe("agi");
    expect(skillValue(sheet, "core:melee", catalog, defaultTuning)).toBe(21);
  });

  test("never exceeds 99", () => {
    const sheet = { attributes: attrs({ agi: 10 }), skills: { "core:stealth": { trained: 90 } } };
    expect(skillValue(sheet, "core:stealth", catalog, defaultTuning)).toBe(99);
  });

  test("field skills resolve through their base skill", () => {
    const sheet = { attributes: attrs({ int: 6 }), skills: { "core:lore/history": { trained: 10 } } };
    expect(skillValue(sheet, "core:lore/history", catalog, defaultTuning)).toBe(28);
    expect(skillValue(sheet, "core:lore/herbs", catalog, defaultTuning)).toBe(18);
  });

  test("unknown skills and missing field specialisations throw", () => {
    const sheet = { attributes: attrs({}), skills: {} };
    expect(() => skillValue(sheet, "core:nope", catalog, defaultTuning)).toThrow(/unknown skill/i);
    expect(() => skillValue(sheet, "core:lore", catalog, defaultTuning)).toThrow(/specialisation/i);
    expect(() => skillValue(sheet, "core:stealth/quiet", catalog, defaultTuning)).toThrow(
      /not a field skill/i,
    );
  });
});

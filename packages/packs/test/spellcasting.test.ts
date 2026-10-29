import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SPELL_SCHOOLS } from "@wyrd/core";
import { loadPack } from "../src/loader.ts";

const FANTASY = join(import.meta.dir, "../../../packs/fantasy-core");

describe("fantasy-core spellcasting plugin", () => {
  const loaded = loadPack(FANTASY);
  const pack = loaded.pack!;

  test("the pack loads without errors", () => {
    expect(loaded.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(pack).not.toBeNull();
  });

  test("the manifest lists the spellcasting plugin", () => {
    expect(pack.manifest.plugins.map((p) => p.id)).toContain("spellcasting");
  });

  test("there are at least 30 spells across all four schools", () => {
    const spells = Object.values(pack.spells ?? {});
    expect(spells.length).toBeGreaterThanOrEqual(30);
    expect(new Set(spells.map((s) => s.school))).toEqual(new Set(SPELL_SCHOOLS));
    for (const spell of spells) {
      expect(spell.id.startsWith("fantasy-core:")).toBe(true);
      expect(spell.effects.length).toBeGreaterThan(0);
      expect(spell.tier).toBeGreaterThanOrEqual(1);
      expect(spell.tier).toBeLessThanOrEqual(3);
    }
  });

  test("every spell's school skill resolves to a field of the pack's spellcasting skill", () => {
    for (const spell of Object.values(pack.spells ?? {})) {
      if (!spell.check) continue;
      expect(spell.check.skill.startsWith("fantasy-core:spellcasting/")).toBe(true);
    }
  });
});

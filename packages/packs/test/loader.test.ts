import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCampaignSettings, defaultTuning } from "@wyrd/core";
import { buildSheet, validateCreation } from "@wyrd/engine";
import { creationContent } from "../src/content.ts";
import { loadPack } from "../src/loader.ts";
import { scaffoldPack } from "../src/scaffold.ts";

const FANTASY = join(import.meta.dir, "../../../packs/fantasy-core");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wyrd-pack-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A copy of fantasy-core we can break. */
function copy(): string {
  const d = join(dir, "pack");
  cpSync(FANTASY, d, { recursive: true });
  return d;
}
const edit = (d: string, file: string, fn: (s: string) => string) =>
  writeFileSync(join(d, file), fn(readFileSync(join(d, file), "utf8")));
const errorCodes = (d: string) =>
  loadPack(d)
    .issues.filter((i) => i.severity === "error")
    .map((i) => i.code);

describe("fantasy-core", () => {
  const { pack, issues } = loadPack(FANTASY);

  test("validates with no errors or warnings", () => {
    expect(issues).toEqual([]);
    expect(pack).not.toBeNull();
  });

  test("has the M1 minimum content", () => {
    expect(Object.keys(pack!.ancestries).sort()).toEqual([
      "fantasy-core:dwarf",
      "fantasy-core:elf",
      "fantasy-core:halfling",
      "fantasy-core:human",
    ]);
    expect(Object.keys(pack!.archetypes)).toHaveLength(6);
    expect(Object.keys(pack!.skills).sort()).toEqual([
      "fantasy-core:arcana",
      "fantasy-core:faith",
      "fantasy-core:spellcasting",
    ]);
  });

  test("namespaces IDs and resolves references to core and pack skills", () => {
    const wizard = pack!.archetypes["fantasy-core:hedge-wizard"]!;
    expect(wizard.talent).toBe("fantasy-core:hedge-lore");
    expect(wizard.skills).toHaveProperty("fantasy-core:spellcasting/elemental", 70);
    expect(wizard.skills).toHaveProperty("core:lore/history", 30);
    expect(wizard.kit[0]?.item).toBe("fantasy-core:dagger");
    expect(pack!.items.weapons["fantasy-core:shortbow"]?.skill).toBe("core:ranged");
    expect(pack!.talents["fantasy-core:silver-tongue"]?.prerequisites.skills).toEqual({
      "core:persuasion": 40,
    });
  });

  test("the hash is stable and changes with content", () => {
    expect(loadPack(FANTASY).pack!.hash).toBe(pack!.hash);
    const d = copy();
    edit(d, "items/gear.yaml", (s) => s.replace("price: 1,", "price: 2,"));
    expect(loadPack(d).pack!.hash).not.toBe(pack!.hash);
  });

  test("every archetype builds a legal character", () => {
    const content = creationContent([pack!]);
    const settings = defaultCampaignSettings();
    for (const a of Object.values(pack!.archetypes)) {
      const sheet = buildSheet(
        {
          id: "pc",
          identity: { name: a.name, ancestry: "fantasy-core:human" },
          bodyPlan: pack!.ancestries["fantasy-core:human"]!.bodyPlan,
          archetypeId: a.id,
          attributes: a.suggestedAttributes,
          skills: Object.fromEntries(Object.entries(a.skills).map(([k, v]) => [k, { trained: v }])),
          talents: [a.talent],
        },
        settings,
        defaultTuning,
      );
      const errors = validateCreation(sheet, content, settings, defaultTuning).filter(
        (i) => i.severity === "error",
      );
      expect({ archetype: a.id, errors }).toEqual({ archetype: a.id, errors: [] });
    }
  });
});

describe("pack validate errors", () => {
  test("missing manifest", () => {
    expect(errorCodes(dir)).toEqual(["FILE_MISSING"]);
  });

  test("YAML syntax errors", () => {
    const d = copy();
    edit(d, "skills.yaml", (s) => `${s}\n  - : : [`);
    expect(errorCodes(d)).toContain("YAML_SYNTAX");
  });

  test("schema errors name the file and path", () => {
    const d = copy();
    edit(d, "items/weapons.yaml", (s) => s.replace("damage: 1d4", "damage: lots"));
    const issue = loadPack(d).issues.find((i) => i.code === "SCHEMA");
    expect(issue).toMatchObject({ file: "items/weapons.yaml", path: "0.damage" });
  });

  test("broken references", () => {
    const d = copy();
    edit(d, "archetypes.yaml", (s) => s.replace("talent: line-veteran", "talent: no-such-talent"));
    edit(d, "items/weapons.yaml", (s) => s.replace("skill: ranged", "skill: archery"));
    edit(d, "archetypes.yaml", (s) => s.replace("lore/history: 70", "lore: 70")); // field skill without a field
    const issues = loadPack(d).issues.filter((i) => i.code === "REFERENCE_BROKEN");
    expect(issues.map((i) => i.file).sort()).toEqual([
      "archetypes.yaml",
      "archetypes.yaml",
      "items/weapons.yaml",
    ]);
  });

  test("duplicate IDs", () => {
    const d = copy();
    edit(d, "items/gear.yaml", (s) => `${s}- { id: torch, name: Torch Two, weightKg: 1, price: 1 }\n`);
    expect(errorCodes(d)).toContain("DUPLICATE_ID");
  });

  test("unknown plugins and incompatible engine ranges", () => {
    const d = copy();
    edit(d, "pack.yaml", (s) =>
      s.replace("plugins: []", "plugins:\n  - id: spellcasting").replace(">=1.0.0 <2.0.0", ">=2.0.0"),
    );
    expect(errorCodes(d).sort()).toEqual(["ENGINE_INCOMPATIBLE", "PLUGIN_UNKNOWN"]);
  });

  test("archetypes must fit the creation budget", () => {
    const d = copy();
    edit(d, "archetypes.yaml", (s) => s.replace("{ str: 7, agi: 6, end: 7,", "{ str: 8, agi: 6, end: 7,"));
    edit(d, "archetypes.yaml", (s) => s.replace("melee: 70, dodge: 50", "melee: 90, dodge: 50"));
    expect(errorCodes(d).sort()).toEqual([
      "ARCHETYPE_ATTRIBUTE_ILLEGAL",
      "ARCHETYPE_ATTRIBUTE_POINTS",
      "ARCHETYPE_SKILL_ABOVE_MAX",
      "ARCHETYPE_SKILL_POINTS",
    ]);
  });

  test("balance lints are warnings", () => {
    const d = copy();
    edit(d, "items/weapons.yaml", (s) => s.replace("damage: 1d4", "damage: 1d80"));
    edit(d, "items/gear.yaml", (s) => s.replace("price: 1,", "price: 5000,"));
    const { pack, issues } = loadPack(d);
    expect(pack).not.toBeNull();
    expect(issues.map((i) => [i.severity, i.code]).sort()).toEqual([
      ["warning", "PRICE_OUTLIER"],
      ["warning", "WEAPON_DAMAGE_OUTLIER"],
    ]);
  });
});

describe("pack new", () => {
  test("scaffolds a pack that validates", () => {
    const d = join(dir, "my-pack");
    scaffoldPack(d, "my-pack");
    const { pack, issues } = loadPack(d);
    expect(pack?.manifest.id).toBe("my-pack");
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(() => scaffoldPack(d, "my-pack")).toThrow(/already exists/);
    expect(() => scaffoldPack(join(dir, "x"), "Bad Id")).toThrow(/lowercase/);
  });
});

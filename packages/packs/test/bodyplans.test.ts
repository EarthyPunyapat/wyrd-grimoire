import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCampaignSettings, defaultTuning, HUMANOID_BODY_PLAN } from "@wyrd/core";
import { buildSheet, validateCreation } from "@wyrd/engine";
import { creationContent } from "../src/content.ts";
import { loadPack } from "../src/loader.ts";

const FANTASY = join(import.meta.dir, "../../../packs/fantasy-core");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wyrd-bodyplan-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A copy of fantasy-core we can break. Fixture packs follow this convention: no checked-in fixture packs. */
function copy(): string {
  const d = join(dir, "pack");
  cpSync(FANTASY, d, { recursive: true });
  return d;
}
const edit = (d: string, file: string, fn: (s: string) => string) =>
  writeFileSync(join(d, file), fn(readFileSync(join(d, file), "utf8")));

/** Writes a one-plan bodyplans.yaml whose locations cover the given ranges. */
function writePlan(d: string, id: string, ranges: Array<[id: string, from: number, to: number]>) {
  const lines = [`- id: ${id}`, `  name: ${id}`, "  locations:"];
  for (const [locId, from, to] of ranges) {
    lines.push(`    - { id: ${locId}, name: ${locId}, kind: torso, from: ${from}, to: ${to} }`);
  }
  writeFileSync(join(d, "bodyplans.yaml"), `${lines.join("\n")}\n`);
}
const issuesFor = (d: string, code: string) => loadPack(d).issues.filter((i) => i.code === code);

describe("fantasy-core and the built-in humanoid", () => {
  const { pack, issues } = loadPack(FANTASY);

  test("validates and declares only the extra quadruped plan", () => {
    expect(issues).toEqual([]);
    expect(Object.keys(pack!.bodyPlans)).toEqual(["fantasy-core:quadruped"]);
  });

  test("ancestries that name the default plan resolve to the built-in humanoid", () => {
    expect(pack!.ancestries["fantasy-core:human"]!.bodyPlan).toBe(HUMANOID_BODY_PLAN.id);
    expect(pack!.ancestries["fantasy-core:elf"]!.bodyPlan).toBe(HUMANOID_BODY_PLAN.id);
  });

  test("a sheet built for a humanoid ancestry carries its resolved plan and passes creation", () => {
    const content = creationContent([pack!]);
    const settings = defaultCampaignSettings();
    const archetype = Object.values(pack!.archetypes)[0]!;
    const draft = {
      id: "pc",
      identity: { name: "Test", ancestry: "fantasy-core:human" },
      archetypeId: archetype.id,
      attributes: archetype.suggestedAttributes,
      skills: Object.fromEntries(Object.entries(archetype.skills).map(([k, v]) => [k, { trained: v }])),
      talents: [archetype.talent],
      bodyPlan: pack!.ancestries["fantasy-core:human"]!.bodyPlan,
    };
    const sheet = buildSheet(draft, settings, defaultTuning);
    expect(sheet.bodyPlan).toBe("core:humanoid");
    const errors = validateCreation(sheet, content, settings, defaultTuning).filter(
      (i) => i.severity === "error",
    );
    expect(errors).toEqual([]);
  });
});

describe("body plan validation", () => {
  test("a gap in the ranges is BODYPLAN_RANGES", () => {
    const d = copy();
    writePlan(d, "humanoid", [
      ["head", 1, 10],
      ["torso", 12, 100],
    ]);
    const { pack, issues } = loadPack(d);
    expect(pack).toBeNull();
    expect(issues.find((i) => i.code === "BODYPLAN_RANGES")).toMatchObject({
      severity: "error",
      file: "bodyplans.yaml",
    });
  });

  test("an overlap is BODYPLAN_RANGES", () => {
    const d = copy();
    writePlan(d, "humanoid", [
      ["head", 1, 10],
      ["torso", 10, 100],
    ]);
    expect(issuesFor(d, "BODYPLAN_RANGES")).toHaveLength(1);
  });

  test("ranges that stop short of 100 are BODYPLAN_RANGES", () => {
    const d = copy();
    writePlan(d, "humanoid", [
      ["head", 1, 10],
      ["torso", 11, 50],
    ]);
    expect(issuesFor(d, "BODYPLAN_RANGES")).toHaveLength(1);
  });

  test("ranges that exactly cover 1–100 are accepted and namespaced", () => {
    const d = copy();
    writePlan(d, "quadruped", [
      ["head", 1, 10],
      ["torso", 11, 100],
    ]);
    const loaded = loadPack(d);
    expect(issuesFor(d, "BODYPLAN_RANGES")).toEqual([]);
    expect(loaded.pack!.bodyPlans["fantasy-core:quadruped"]).toMatchObject({
      id: "fantasy-core:quadruped",
    });
    expect(loaded.pack!.bodyPlans["fantasy-core:quadruped"]!.locations).toHaveLength(2);
  });

  test("an ancestry that names an unknown body plan is a broken reference", () => {
    const d = copy();
    edit(d, "ancestries.yaml", (s) => s.replace("  name: Human\n", "  name: Human\n  bodyPlan: nope\n"));
    expect(issuesFor(d, "REFERENCE_BROKEN")).toHaveLength(1);
  });
});

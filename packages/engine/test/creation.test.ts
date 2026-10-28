import { describe, expect, test } from "bun:test";
import { defaultCampaignSettings, defaultTuning } from "@wyrd/core";
import {
  buildSheet,
  type CreationContent,
  hasErrors,
  type SheetDraft,
  validateCreation,
} from "../src/creation.ts";
import { catalog } from "./fixtures.ts";

const settings = defaultCampaignSettings();

const content: CreationContent = {
  skills: catalog,
  ancestries: {
    "test:human": {
      id: "test:human",
      name: "Human",
      description: "x",
      bodyPlan: "humanoid",
      attributeMaxBonus: [],
      languages: [],
      traits: [],
    },
    "test:dwarf": {
      id: "test:dwarf",
      name: "Dwarf",
      description: "x",
      bodyPlan: "humanoid",
      attributeMaxBonus: ["end"],
      languages: [],
      traits: [],
    },
  },
  talents: {
    "test:tough": {
      id: "test:tough",
      name: "Tough",
      tier: 1,
      description: "x",
      prerequisites: { attributes: {}, skills: {}, talents: [] },
    },
    "test:quick": {
      id: "test:quick",
      name: "Quick",
      tier: 1,
      description: "x",
      prerequisites: { attributes: { agi: 6 }, skills: {}, talents: [] },
    },
    "test:shadow": {
      id: "test:shadow",
      name: "Shadow",
      tier: 1,
      description: "x",
      prerequisites: { attributes: {}, skills: { "core:stealth": 50 }, talents: [] },
    },
    "test:third": {
      id: "test:third",
      name: "Third",
      tier: 1,
      description: "x",
      prerequisites: { attributes: {}, skills: {}, talents: [] },
    },
  },
  archetypes: {
    "test:sellsword": {
      id: "test:sellsword",
      name: "Sellsword",
      description: "x",
      suggestedAttributes: { str: 7, agi: 6, end: 6, int: 4, awa: 5, wil: 5, pre: 4 },
      skills: { "core:melee": 40 },
      talent: "test:tough",
      kit: [],
      backstoryPrompts: [],
    },
  },
};

/** A legal sheet: 18 attribute points, 300 skill points, archetype talent + one free pick. */
const legal = (): SheetDraft => ({
  id: "pc",
  identity: { name: "Wren", ancestry: "test:human" },
  archetypeId: "test:sellsword",
  attributes: { str: 7, agi: 6, end: 6, int: 4, awa: 6, wil: 5, pre: 5 },
  skills: {
    "core:melee": { trained: 80 },
    "core:dodge": { trained: 50 },
    "core:athletics": { trained: 50 },
    "core:perception": { trained: 40 },
    "core:survival": { trained: 30 },
    "core:lore/history": { trained: 30 },
    "core:stealth": { trained: 20 },
  },
  talents: ["test:tough", "test:quick"],
});

const issuesFor = (draft: SheetDraft) =>
  validateCreation(buildSheet(draft, settings, defaultTuning), content, settings, defaultTuning);
const codes = (draft: SheetDraft) => issuesFor(draft).map((i) => i.code);

describe("creation validator", () => {
  test("a legal sheet has no issues", () => {
    expect(issuesFor(legal())).toEqual([]);
  });

  test("attributes: overspend, max and minimum", () => {
    expect(codes({ ...legal(), attributes: { ...legal().attributes, pre: 6 } })).toContain(
      "ATTR_POINTS_OVERSPENT",
    );
    expect(codes({ ...legal(), attributes: { ...legal().attributes, str: 8, pre: 4 } })).toContain(
      "ATTR_ABOVE_MAX",
    );
    expect(codes({ ...legal(), attributes: { ...legal().attributes, int: 2, pre: 7 } })).toContain(
      "ATTR_BELOW_START",
    );
  });

  test("an ancestry trait allows 8", () => {
    const dwarf = {
      ...legal(),
      identity: { name: "Brokk", ancestry: "test:dwarf" },
      attributes: { str: 7, agi: 6, end: 8, int: 4, awa: 4, wil: 5, pre: 5 },
    };
    expect(codes(dwarf)).not.toContain("ATTR_ABOVE_MAX");
  });

  test("unspent points are warnings, not errors", () => {
    const draft = {
      ...legal(),
      attributes: { ...legal().attributes, pre: 4 },
      skills: { "core:melee": { trained: 10 } },
    };
    const issues = issuesFor(draft);
    expect(issues.map((i) => i.code).sort()).toEqual(["ATTR_POINTS_UNSPENT", "SKILL_POINTS_UNSPENT"]);
    expect(hasErrors(issues)).toBe(false);
  });

  test("skills: total pool, per-skill max and the interest pool", () => {
    const over = { ...legal(), skills: { ...legal().skills, "core:insight": { trained: 10 } } };
    expect(codes(over)).toContain("SKILL_POINTS_OVERSPENT");
    expect(codes({ ...legal(), skills: { "core:melee": { trained: 81 } } })).toContain(
      "SKILL_ABOVE_CREATION_MAX",
    );
    // With the default budget the total-points rule always binds first; a smaller interest pool
    // shows the split rule on its own: two skills at +80 need 2 × 30 = 60 interest points.
    const tight = { ...defaultTuning, creation: { ...defaultTuning.creation, interestPoints: 50 } };
    const spiky = { ...legal(), skills: { "core:melee": { trained: 80 }, "core:dodge": { trained: 80 } } };
    const spikyIssues = validateCreation(buildSheet(spiky, settings, tight), content, settings, tight);
    expect(spikyIssues.map((i) => i.code)).toContain("SKILL_INTEREST_POINTS_OVERSPENT");
    expect(spikyIssues.map((i) => i.code)).not.toContain("SKILL_POINTS_OVERSPENT");
    expect(codes({ ...legal(), skills: { "core:flying": { trained: 10 } } })).toContain("SKILL_UNKNOWN");
    expect(codes({ ...legal(), skills: { "core:lore": { trained: 10 } } })).toContain("SKILL_UNKNOWN");
  });

  test("talents: count, archetype grant, prerequisites, unknown", () => {
    expect(codes({ ...legal(), talents: ["test:tough", "test:quick", "test:third"] })).toContain(
      "TALENT_TOO_MANY",
    );
    expect(codes({ ...legal(), talents: ["test:quick", "test:third"] })).toContain(
      "TALENT_ARCHETYPE_MISSING",
    );
    expect(codes({ ...legal(), talents: ["test:tough", "test:shadow"] })).toContain("TALENT_PREREQ_UNMET");
    expect(codes({ ...legal(), talents: ["test:tough", "test:nope"] })).toContain("TALENT_UNKNOWN");
    expect(codes({ ...legal(), talents: ["test:tough", "test:tough"] })).toContain("TALENT_DUPLICATE");
  });

  test("derived stats and starting status must match the rules", () => {
    const sheet = buildSheet(legal(), settings, defaultTuning);
    const tampered = {
      ...sheet,
      derived: { ...sheet.derived, hpMax: 99 },
      status: { ...sheet.status, luck: 9 },
    };
    const c = validateCreation(tampered, content, settings, defaultTuning).map((i) => i.code);
    expect(c).toContain("DERIVED_MISMATCH");
    expect(c).toContain("STATUS_LUCK");
  });

  test("every issue says which rule it breaks", () => {
    for (const i of issuesFor({ ...legal(), attributes: { ...legal().attributes, pre: 7 } })) {
      expect(i.message.length).toBeGreaterThan(10);
      expect(i.path).toBeDefined();
    }
  });
});

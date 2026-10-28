import { expect, test } from "bun:test";
import { ATTRIBUTE_IDS, defaultTuning } from "@wyrd/core";
import { allocateStartingTraining } from "../src/creation.ts";

const skills = [
  "core:investigation",
  "core:mechanics",
  "core:perception",
  "core:insight",
  "core:persuasion",
  "core:medicine",
];
test("generated training spends the configured pools without exceeding creation caps", () => {
  const result = allocateStartingTraining(ATTRIBUTE_IDS, skills, defaultTuning);
  const c = defaultTuning.creation;
  expect(Object.values(result.suggestedAttributes).reduce((a, b) => a + b - c.attributeStart, 0)).toBe(
    c.attributePoints,
  );
  expect(Math.max(...Object.values(result.suggestedAttributes))).toBeLessThanOrEqual(c.attributeMax);
  expect(result.suggestedAttributes.str).toBeGreaterThan(result.suggestedAttributes.pre);
  expect(Object.values(result.skills).reduce((a, b) => a + b, 0)).toBe(c.corePoints + c.interestPoints);
  expect(allocateStartingTraining(ATTRIBUTE_IDS, skills, defaultTuning)).toEqual(result);
});
test("generated training rejects duplicated attributes, unknown skills and unspecialised field skills", () => {
  expect(() => allocateStartingTraining(Array(7).fill("str"), skills, defaultTuning)).toThrow();
  expect(() =>
    allocateStartingTraining(
      ATTRIBUTE_IDS,
      skills.map(() => "core:mechanics"),
      defaultTuning,
    ),
  ).toThrow();
  expect(() =>
    allocateStartingTraining(ATTRIBUTE_IDS, [...skills.slice(1), "core:hacking"], defaultTuning),
  ).toThrow();
  expect(() =>
    allocateStartingTraining(ATTRIBUTE_IDS, [...skills.slice(1), "core:lore"], defaultTuning),
  ).toThrow();
});

import { type AttributeId, type Attributes, HUMANOID_BODY_PLAN } from "@wyrd/core";
import { CORE_SKILL_CATALOG } from "../src/skills.ts";

export const catalog = CORE_SKILL_CATALOG;

/** Attributes at human average (5) with overrides. */
export function attrs(overrides: Partial<Record<AttributeId, number>>): Attributes {
  return { str: 5, agi: 5, end: 5, int: 5, awa: 5, wil: 5, pre: 5, ...overrides };
}

/** The built-in humanoid body plan, for engine tests that don't load a pack. */
export const humanoidPlan = HUMANOID_BODY_PLAN;

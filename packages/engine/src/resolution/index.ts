import type { CheckResult, Degree, ResolutionId } from "@wyrd/core";
import { d20Module } from "./d20.ts";
import { d100Module } from "./d100.ts";
import type { ResolutionModule } from "./types.ts";

export type { ResolutionModule } from "./types.ts";

export const RESOLUTION_MODULES: Record<ResolutionId, ResolutionModule> = {
  d100: d100Module,
  d20: d20Module,
};

const DEGREE_RANK: Record<Degree, number> = { critFailure: 0, failure: 1, success: 2, critSuccess: 3 };

export const isSuccess = (d: Degree): boolean => d === "success" || d === "critSuccess";

/** Positive when `a` is the better result: higher degree, then higher margin. */
export function compareDegreeMargin(a: CheckResult, b: CheckResult): number {
  return DEGREE_RANK[a.degree] - DEGREE_RANK[b.degree] || a.margin - b.margin;
}

/** Opposed check winner. A full tie goes to the defender (the status quo). */
export function compareResults(active: CheckResult, defender: CheckResult): "active" | "defender" {
  return compareDegreeMargin(active, defender) > 0 ? "active" : "defender";
}

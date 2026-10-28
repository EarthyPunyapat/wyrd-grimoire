import type { AttributeId, CharacterSheet, Modifier, PenaltyScope, Wound } from "@wyrd/core";
import type { CheckContext } from "../conditions.ts";

const PHYSICAL_ATTRIBUTES: readonly AttributeId[] = ["str", "agi", "end"];
const SEVERITY_LABEL: Record<Wound["severity"], string> = {
  minor: "Minor",
  serious: "Serious",
  critical: "Critical",
  lethal: "Lethal",
};

/** The side of an arm location: "right-arm" is "right". Other locations have no side. */
function armSide(wound: Wound): string | undefined {
  if (wound.locationKind !== "arm") return undefined;
  return wound.location.split("-")[0];
}

function scopeApplies(scope: PenaltyScope, wound: Wound, ctx: CheckContext): boolean {
  switch (scope) {
    case "all":
      return true;
    case "physical":
      return PHYSICAL_ATTRIBUTES.includes(ctx.attribute);
    case "movement":
      return ctx.tags.includes("movement");
    case "sameArm": {
      const side = armSide(wound);
      return side !== undefined && ctx.tags.includes(`hand:${side}`);
    }
  }
}

/**
 * Check penalties from the sheet's wounds (spec 03, Wounds). Each wound's stored `penalty` applies
 * when its scope matches the check; a wound without a penalty contributes nothing.
 */
export function woundModifiers(sheet: CharacterSheet, ctx: CheckContext): Modifier[] {
  const modifiers: Modifier[] = [];
  for (const wound of sheet.status.wounds) {
    if (!wound.penalty || !scopeApplies(wound.penalty.scope, wound, ctx)) continue;
    modifiers.push({
      source: `${SEVERITY_LABEL[wound.severity]} ${wound.locationKind} wound`,
      value: wound.penalty.value,
    });
  }
  return modifiers;
}

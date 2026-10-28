import type { AttributeId, CharacterSheet, Modifier, PenaltyScope, Wound } from "@wyrd/core";
import type { CheckContext } from "../conditions.ts";

const PHYSICAL_ATTRIBUTES: readonly AttributeId[] = ["str", "agi", "end"];
const SEVERITY_LABEL: Record<Wound["severity"], string> = {
  minor: "Minor",
  serious: "Serious",
  critical: "Critical",
  lethal: "Lethal",
};

function scopeApplies(scope: PenaltyScope, wound: Wound, ctx: CheckContext): boolean {
  switch (scope) {
    case "all":
      return true;
    case "physical":
      return PHYSICAL_ATTRIBUTES.includes(ctx.attribute);
    case "movement":
      return ctx.tags.includes("movement");
    case "sameArm":
      // A wound without a side (not a limb) has no arm to match.
      return wound.side !== undefined && ctx.tags.includes(`hand:${wound.side}`);
  }
}

/**
 * Check penalties from the sheet's wounds (spec 03, Wounds). Each wound's stored `penalty` applies
 * when its scope matches the check; a wound without a penalty contributes nothing. A check tagged
 * `ignore-wound:<id>` (a wound's own lethal check) skips that wound.
 */
export function woundModifiers(sheet: CharacterSheet, ctx: CheckContext): Modifier[] {
  const modifiers: Modifier[] = [];
  for (const wound of sheet.status.wounds) {
    if (!wound.penalty) continue;
    if (ctx.tags.includes(`ignore-wound:${wound.id}`)) continue;
    if (!scopeApplies(wound.penalty.scope, wound, ctx)) continue;
    modifiers.push({
      source: `${SEVERITY_LABEL[wound.severity]} ${wound.locationKind} wound`,
      value: wound.penalty.value,
    });
  }
  return modifiers;
}

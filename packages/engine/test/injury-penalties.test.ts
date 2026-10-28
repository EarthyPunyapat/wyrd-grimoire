import { describe, expect, test } from "bun:test";
import type { AttributeId, Wound } from "@wyrd/core";
import { prepareCheck } from "../src/checks.ts";
import type { CheckContext } from "../src/conditions.ts";
import { woundModifiers } from "../src/injury/penalties.ts";
import { unwrap } from "../src/result.ts";
import { ctx, Sim } from "./sim.ts";

const wound = (over: Partial<Wound>): Wound => ({
  id: "pc-w1",
  location: "torso",
  locationKind: "torso",
  severity: "minor",
  hpMaxReduction: 2,
  fracture: false,
  severed: false,
  ...over,
});

const at = (attribute: AttributeId, tags: string[] = [], skillId: string | null = null): CheckContext => ({
  skillId,
  attribute,
  tags,
});

/** A pc's sheet carrying the given wounds, built through the same path as the rest of the engine tests. */
function sheetWith(...wounds: Wound[]) {
  const s = new Sim();
  s.addActor("pc", "pc", { status: { wounds } });
  return s.state.actors.pc!.sheet;
}

describe("woundModifiers", () => {
  test("a minor torso wound (physical) gives -10 on an Athletics (str) check and nothing on Perception (awa)", () => {
    const sheet = sheetWith(wound({ penalty: { scope: "physical", value: -10 } }));
    expect(woundModifiers(sheet, at("str", [], "core:athletics"))).toEqual([
      { source: "Minor torso wound", value: -10 },
    ]);
    expect(woundModifiers(sheet, at("awa", [], "core:perception"))).toEqual([]);
  });

  test("a serious right-arm wound (sameArm) gives -20 on a hand:right check and nothing on hand:left", () => {
    const sheet = sheetWith(
      wound({
        id: "pc-w2",
        location: "right-arm",
        locationKind: "arm",
        severity: "serious",
        penalty: { scope: "sameArm", value: -20 },
      }),
    );
    expect(woundModifiers(sheet, at("agi", ["hand:right"]))).toEqual([
      { source: "Serious arm wound", value: -20 },
    ]);
    expect(woundModifiers(sheet, at("agi", ["hand:left"]))).toEqual([]);
  });

  test("a left-arm wound matches hand:left only", () => {
    const sheet = sheetWith(
      wound({
        location: "left-arm",
        locationKind: "arm",
        severity: "serious",
        penalty: { scope: "sameArm", value: -20 },
      }),
    );
    expect(woundModifiers(sheet, at("agi", ["hand:left"]))).toHaveLength(1);
    expect(woundModifiers(sheet, at("agi", ["hand:right"]))).toEqual([]);
  });

  test("a minor leg wound (movement) gives -10 on a check tagged movement and nothing otherwise", () => {
    const sheet = sheetWith(
      wound({
        location: "left-leg",
        locationKind: "leg",
        penalty: { scope: "movement", value: -10 },
      }),
    );
    expect(woundModifiers(sheet, at("agi", ["movement"]))).toEqual([
      { source: "Minor leg wound", value: -10 },
    ]);
    expect(woundModifiers(sheet, at("agi", []))).toEqual([]);
  });

  test("an 'all' penalty applies to every check", () => {
    const sheet = sheetWith(
      wound({
        severity: "critical",
        penalty: { scope: "all", value: -30 },
      }),
    );
    expect(woundModifiers(sheet, at("awa", [], "core:perception"))).toEqual([
      { source: "Critical torso wound", value: -30 },
    ]);
  });

  test("a wound with no stored penalty contributes nothing", () => {
    const sheet = sheetWith(wound({ locationKind: "head", location: "head", severity: "critical" }));
    expect(woundModifiers(sheet, at("str", ["movement", "hand:right"], "core:athletics"))).toEqual([]);
  });

  test("a lethal wound keeps the penalty it was inflicted with", () => {
    const sheet = sheetWith(wound({ severity: "lethal", penalty: { scope: "all", value: -30 } }));
    expect(woundModifiers(sheet, at("awa", [], "core:perception"))).toEqual([
      { source: "Lethal torso wound", value: -30 },
    ]);
  });

  test("each wound gives its own modifier", () => {
    const sheet = sheetWith(
      wound({ penalty: { scope: "physical", value: -10 } }),
      wound({
        id: "pc-w2",
        location: "left-leg",
        locationKind: "leg",
        severity: "minor",
        penalty: { scope: "movement", value: -10 },
      }),
    );
    expect(woundModifiers(sheet, at("str", ["movement"], "core:athletics"))).toEqual([
      { source: "Minor torso wound", value: -10 },
      { source: "Minor leg wound", value: -10 },
    ]);
  });
});

describe("prepareCheck and wounds", () => {
  test("the wound modifier is included in prepared.modifiers", () => {
    const s = new Sim();
    s.addActor("pc", "pc", {
      status: { wounds: [wound({ penalty: { scope: "physical", value: -10 } })] },
    });
    const { prepared } = unwrap(
      prepareCheck(
        s.state,
        {
          actorId: "pc",
          skill: "core:athletics",
          difficulty: "normal",
          modifiers: [],
          boons: 0,
          banes: 0,
          purpose: "climb the wall",
          tags: [],
        },
        ctx,
      ),
    );
    expect(prepared.modifiers).toContainEqual({ source: "Minor torso wound", value: -10 });
    expect(prepared.modifierTotal).toBe(-10);
  });
});

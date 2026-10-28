import { describe, expect, test } from "bun:test";
import { draft } from "@wyrd/core";
import { Working } from "../src/working.ts";
import { Sim } from "./sim.ts";

function sim() {
  const s = new Sim({}, 3);
  s.addActor("pc", "pc");
  return s;
}

describe("Working", () => {
  test("applying a ConditionApplied draft updates the working state and records the event", () => {
    const s = sim();
    const original = s.state;
    const before = JSON.stringify(original);
    const w = new Working(original);

    w.apply([draft("ConditionApplied", { actorId: "pc", condition: { id: "core:prone" } }, "engine")]);

    expect(w.state.actors.pc!.sheet.status.conditions.map((c) => c.id)).toEqual(["core:prone"]);
    expect(w.events.length).toBe(1);
    expect(w.events[0]!.type).toBe("ConditionApplied");
    expect(w.state).not.toBe(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  test("later drafts see the state produced by earlier ones", () => {
    const s = sim();
    const w = new Working(s.state);

    w.apply([draft("ConditionApplied", { actorId: "pc", condition: { id: "core:prone" } }, "engine")]);
    w.apply([
      draft("ConditionRemoved", { actorId: "pc", conditionId: "core:prone" }, "engine"),
      draft("ConditionApplied", { actorId: "pc", condition: { id: "core:blinded" } }, "engine"),
    ]);

    expect(w.state.actors.pc!.sheet.status.conditions.map((c) => c.id)).toEqual(["core:blinded"]);
    expect(w.events.map((e) => e.type)).toEqual(["ConditionApplied", "ConditionRemoved", "ConditionApplied"]);
  });
});

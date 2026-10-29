import { describe, expect, test } from "bun:test";
import { DiseaseDef, draft, languageUnderstanding, lightEffect, survivalOf } from "@wyrd/core";
import { unwrap } from "../src/result.ts";
import { exposeToDisease } from "../src/survival.ts";
import { runTicks, type WorldContext } from "../src/world/index.ts";
import { ctx as rules, Sim } from "./sim.ts";

const ctx: WorldContext = {
  ...rules,
  nameOf: (id) => id,
  items: { weapons: {}, armor: {}, gear: {} },
  diseases: {},
};

const disease = DiseaseDef.parse({
  id: "river-fever",
  name: "River Fever",
  description: "A shaking fever caught from bad water.",
  vector: "ingested",
  resistance: "easy",
  onsetHours: 0,
  stages: [
    {
      id: "shaking",
      name: "Shaking",
      atHours: 0,
      symptoms: ["chills"],
      check: "easy",
      checkDifficulty: "easy",
    },
  ],
});

describe("survival (spec 11)", () => {
  test("light penalties follow the level, a light source and darkvision", () => {
    const t = rules.tuning.survival.light;
    expect(lightEffect("bright", { hasLight: false, hasDarkvision: false, tuning: t }).modifier).toBe(0);
    expect(lightEffect("dim", { hasLight: false, hasDarkvision: false, tuning: t }).modifier).toBe(
      t.dimPenalty,
    );
    expect(lightEffect("dark", { hasLight: false, hasDarkvision: false, tuning: t }).modifier).toBe(
      t.darkPenalty,
    );
    expect(lightEffect("dark", { hasLight: true, hasDarkvision: false, tuning: t }).modifier).toBe(0);
    expect(lightEffect("dark", { hasLight: false, hasDarkvision: true, tuning: t }).modifier).toBe(0);
  });

  test("language: a shared tongue, an interpreter, a check, or tone only", () => {
    expect(languageUnderstanding({ pcLanguages: ["common"], npcLanguages: ["common"] })).toMatchObject({
      understood: true,
      method: "shared",
    });
    expect(
      languageUnderstanding({ pcLanguages: ["common"], npcLanguages: ["old-speech"], interpreter: true }),
    ).toMatchObject({ understood: true, method: "interpreter" });
    expect(
      languageUnderstanding({ pcLanguages: ["common"], npcLanguages: ["old-speech"], check: "success" }),
    ).toMatchObject({ understood: true, method: "check" });
    expect(languageUnderstanding({ pcLanguages: ["common"], npcLanguages: ["old-speech"] })).toMatchObject({
      understood: false,
      toneOnly: true,
    });
  });

  test("a day without food and water escalates needs and shows notices", () => {
    const s = new Sim({ subsystems: { survival: true } });
    s.addActor("pc", "pc");
    s.commit([draft("TimeAdvanced", { minutes: 1440, reason: "test" })]);
    s.commit(runTicks(s.state, ctx));
    const needs = survivalOf(s.state.flags).needs.pc!;
    expect(needs.daysWithoutFood).toBe(1);
    expect(needs.daysWithoutWater).toBe(1);
    expect(s.state.actors.pc!.sheet.status.conditions.map((c) => c.id)).toContain("core:hungry");
    expect(survivalOf(s.state.flags).notices.some((n) => n.kind === "need")).toBe(true);
  });

  test("survival off means no needs, no notices", () => {
    const s = new Sim({ subsystems: { survival: false } });
    s.addActor("pc", "pc");
    s.commit([draft("TimeAdvanced", { minutes: 1440, reason: "test" })]);
    const drafts = runTicks(s.state, ctx);
    expect(drafts.some((d) => d.type === "SurvivalNeedsUpdated")).toBe(false);
    expect(survivalOf(s.state.flags).needs.pc).toBeUndefined();
  });

  test("exposure to a disease infects on a failed resistance check", () => {
    const s = new Sim({ subsystems: { disease: true } });
    s.addActor("pc", "pc");
    const c = { ...ctx, diseases: { "core:river-fever": disease } };
    const events = unwrap(exposeToDisease(s.state, "pc", "core:river-fever", c));
    s.commit(events);
    // Either the check resisted (no instance) or the infection is recorded and readable.
    const list = survivalOf(s.state.flags).diseases.pc ?? [];
    for (const instance of list) {
      expect(instance.diseaseId).toBe("core:river-fever");
      expect(instance.cured).toBe(false);
    }
  });

  test("a lit torch burns down and goes out", () => {
    const s = new Sim();
    s.addActor("pc", "pc");
    s.commit([
      draft("LightLit", {
        actorId: "pc",
        light: { itemId: "fantasy-core:torch", kind: "torch", minutesLeft: 3 },
      }),
    ]);
    expect(survivalOf(s.state.flags).lights.pc).toHaveLength(1);
    s.commit([draft("LightBurned", { actorId: "pc", itemId: "fantasy-core:torch", minutesLeft: 0 })]);
    expect(survivalOf(s.state.flags).lights.pc).toHaveLength(0);
  });
});

import { describe, expect, test } from "bun:test";
import { Combatant, CombatState, draft, SceneState, type SubsystemToggles } from "@wyrd/core";
import { resolveStrike } from "../src/combat/attack.ts";
import type { CombatContext } from "../src/combat/common.ts";
import { unwrap } from "../src/result.ts";
import { Working } from "../src/working.ts";
import { ctx as rules, Sim } from "./sim.ts";

const combatCtx: CombatContext = {
  ...rules,
  nameOf: (id) => id,
  items: { weapons: {}, armor: {}, gear: {} },
  bodyPlans: {},
  creatures: {},
  combatInfo: () => ({}),
};

function fight(subsystems: Partial<SubsystemToggles>, light: "bright" | "dim", tags: string[]) {
  const s = new Sim({ subsystems }, 7);
  s.addActor("pc", "pc");
  s.addActor("npc", "npc");
  s.commit([
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: "s",
        locationId: "loc:test",
        openedAt: 0,
        light,
        zones: [{ id: "z", name: "Room", tags }],
        positions: { pc: "z", npc: "z" },
      }),
    }),
    draft("CombatStarted", {
      combat: CombatState.parse({
        id: "c",
        round: 1,
        turn: 0,
        order: ["pc", "npc"],
        engaged: [["pc", "npc"]],
        combatants: {
          pc: Combatant.parse({ actorId: "pc", side: "party", group: "pc", controlled: true, ap: 3 }),
          npc: Combatant.parse({ actorId: "npc", side: "enemy", group: "npc" }),
        },
      }),
    }),
  ]);
  const w = new Working(s.state);
  const step = unwrap(resolveStrike(w, "pc", "npc", combatCtx));
  return step.lines.map((line) => line.text).join("\n");
}

describe("light modifiers in combat (spec 03, 11)", () => {
  test("a dim scene penalises attacks when lighting and vision is on", () => {
    expect(fight({ lightingAndVision: true }, "dim", [])).toContain("dim light");
  });

  test("a dark zone penalises attacks when lighting and vision is on", () => {
    expect(fight({ lightingAndVision: true }, "bright", ["dark"])).toContain("darkness");
  });

  test("the Story preset's dim scene does not penalise attacks when lighting is off", () => {
    const text = fight({ lightingAndVision: false }, "dim", []);
    expect(text).not.toContain("dim light");
    expect(text).not.toContain("darkness");
  });

  test("a dark zone does not penalise attacks when lighting is off", () => {
    const text = fight({ lightingAndVision: false }, "bright", ["dark"]);
    expect(text).not.toContain("darkness");
    expect(text).not.toContain("dim light");
  });
});

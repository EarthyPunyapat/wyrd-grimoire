import { expect, test } from "bun:test";
import { Combatant, CombatState, draft, SceneState } from "@wyrd/core";
import { resolveCombatAction } from "../src/combat/actions.ts";
import { unwrap } from "../src/result.ts";
import { Working } from "../src/working.ts";
import { attrs } from "./fixtures.ts";
import { ctx as rules, Sim } from "./sim.ts";

test("winning an opposed grapple has a successful outcome even when both individual rolls fail", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const s = new Sim({}, seed);
    s.addActor("pc", "pc", { attributes: attrs({ str: 1, agi: 1 }) });
    s.addActor("npc", "npc", { attributes: attrs({ str: 1, agi: 1 }) });
    s.commit([
      draft("SceneOpened", {
        scene: SceneState.parse({
          id: "s",
          locationId: "loc",
          openedAt: 0,
          zones: [{ id: "z", name: "Room" }],
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
    const result = unwrap(
      resolveCombatAction(
        w,
        "pc",
        { type: "grapple", targetId: "npc" },
        {
          ...rules,
          nameOf: (id) => id,
          items: { weapons: {}, armor: {}, gear: {} },
          bodyPlans: {},
          creatures: {},
          combatInfo: () => ({}),
        },
      ),
    );
    const step = result[0]!;
    if (!step.lines.slice(0, 2).every((l) => l.degree === "failure" || l.degree === "critFailure")) continue;
    if (!w.state.actors.npc!.sheet.status.conditions.some((c) => c.id === "core:grappled")) continue;
    expect(["success", "critSuccess"]).toContain(step.outcome);
    expect(step.lines).toHaveLength(3);
    expect(step.lines[2]!.text).toContain("wins the grapple contest");
    expect(step.lines[1]!.text).toStartWith("Resist:");
    return;
  }
  throw new Error("No deterministic fixture produced an opposed win with both checks failing");
});

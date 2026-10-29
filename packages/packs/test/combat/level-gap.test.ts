import { expect, test } from "bun:test";
import { startCombat, unwrap, Working } from "@wyrd/engine";
import { resolveStrike } from "../../../engine/src/combat/attack.ts";
import { Fight } from "./fixture.ts";

test("d20 strikes compare the attacker's and target's levels", () => {
  for (const [actorLevel, targetLevel, degree] of [
    [9, 1, "success"],
    [1, 9, "failure"],
  ] as const) {
    const f = new Fight({ settings: { structural: { resolution: "d20" } } });
    f.commit(
      unwrap(
        startCombat(f.state, { initiatorId: "pc", targetIds: ["npc:cutter"], combatId: "levels" }, f.ctx),
      ).events,
    );
    f.state.actors.pc!.sheet.level = actorLevel;
    f.state.actors["npc:cutter"]!.sheet.level = targetLevel;
    const w = new Working(f.state);
    unwrap(resolveStrike(w, "pc", "npc:cutter", f.ctx));
    const attack = w.events.find((e) => e.type === "CheckResolved" && e.payload.actorId === "pc");
    if (attack?.type !== "CheckResolved") throw new Error("Missing attack check");
    expect(attack.payload.result.rolls).toEqual([]);
    expect(attack.payload.result.degree).toBe(degree);
  }
});

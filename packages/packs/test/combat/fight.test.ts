import { describe, expect, test } from "bun:test";
import { combatView, fold, resolveTurn, unwrap, validateTurn } from "@wyrd/engine";
import { Fight } from "./fixture.ts";

const run = (f: Fight, actions: unknown[]) => {
  const v = validateTurn(f.state, "pc", actions, f.ctx);
  if (!v.ok) throw new Error(JSON.stringify(v.planErrors ?? v.errors));
  const r = unwrap(resolveTurn(f.state, v.value, f.ctx, `combat-${f.events.length}`));
  f.commit(r.events);
  return r.resolution;
};

describe("starting a fight", () => {
  test("attacking a bandit starts combat with the whole band and rolls initiative", () => {
    const f = new Fight({ seed: 7 });
    const res = run(f, [{ type: "strike", targetId: "npc:fen" }]);
    const combat = f.state.combat ?? null;
    // The fight may already be over on a lucky seed; check the start step either way.
    expect(res.steps[0]!.summary).toContain("A fight breaks out");
    const started = f.events.find((e) => e.type === "CombatStarted");
    expect(started).toBeDefined();
    const c = (started!.payload as { combat: { combatants: Record<string, { side: string }> } }).combat;
    expect(Object.keys(c.combatants).sort()).toEqual(["npc:bram", "npc:cutter", "npc:fen", "npc:mags", "pc"]);
    expect(c.combatants["npc:orla"]).toBeUndefined();
    expect(c.combatants.pc!.side).toBe("party");
    expect(f.state.actors["npc:cutter"]?.sheet.equipment.held.main).toBe("fantasy-core:arming-sword");
    if (combat) expect(f.state.mode).toBe("combat");
  });

  test("the three-action example parses into legal combat actions and resolves in order", () => {
    // Pick a seed where the PC still has a turn after starting the fight.
    for (let seed = 1; seed < 60; seed++) {
      const f = new Fight({ seed });
      run(f, [{ type: "strike", targetId: "npc:mags" }]);
      if (f.state.combat?.order[f.state.combat.turn] !== "pc") continue;
      const plan = [
        { type: "stunt", effect: "createCover", propId: "prop:table", description: "kick the table over" },
        { type: "takeCover", propId: "prop:table" },
        { type: "strike", targetId: "npc:fen" },
      ];
      const v = validateTurn(f.state, "pc", plan, f.ctx);
      expect(v.ok).toBe(true);
      const res = run(f, plan);
      const mine = res.steps.filter((s) => s.phase === "player");
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine[0]!.summary.toLowerCase()).toContain("table");
      return;
    }
    throw new Error("no seed gave the PC a turn");
  });

  test("illegal plans are rejected with codes and alternatives", () => {
    for (let seed = 1; seed < 60; seed++) {
      const f = new Fight({ seed });
      run(f, [{ type: "strike", targetId: "npc:mags" }]);
      if (!f.state.combat) continue;
      const strike = { type: "strike", targetId: "npc:fen" };
      const tooMuch = validateTurn(f.state, "pc", [strike, strike, strike, strike], f.ctx);
      expect(tooMuch.ok).toBe(false);
      expect(tooMuch.planErrors?.map((e) => [e.actionIndex, e.code])).toContainEqual([3, "NOT_ENOUGH_AP"]);
      const bystander = validateTurn(f.state, "pc", [{ type: "strike", targetId: "npc:orla" }], f.ctx);
      expect(bystander.planErrors?.[0]?.code).toBe("TARGET_NOT_IN_FIGHT");
      const notDrawn = validateTurn(
        f.state,
        "pc",
        [{ type: "strike", targetId: "npc:mags", weaponId: "fantasy-core:hand-axe" }],
        f.ctx,
      );
      expect(notDrawn.planErrors?.[0]?.code).toBe("WEAPON_NOT_DRAWN");
      expect(notDrawn.planErrors?.[0]?.legalAlternatives).toEqual([
        { type: "draw", weaponId: "fantasy-core:hand-axe" },
      ]);
      return;
    }
  });
});

describe("whole fights", () => {
  test("fights end, and folding the log reproduces the state", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const f = new Fight({ seed });
      run(f, [{ type: "strike", targetId: "npc:fen" }]);
      for (let i = 0; i < 40 && f.state.combat; i++) {
        const view = combatView(f.state, "pc", f.ctx)!;
        const legal =
          view.actions.find((a) => a.legal && a.label.startsWith("Strike")) ??
          view.actions.find((a) => a.legal);
        const target = legal?.label.startsWith("Strike")
          ? Object.values(f.state.combat.combatants).find(
              (c) => c.side === "enemy" && legal.label.endsWith(f.ctx.nameOf(c.actorId)),
            )?.actorId
          : undefined;
        run(f, target ? [{ type: "strike", targetId: target }] : [{ type: "defend" }]);
      }
      expect(f.state.combat).toBeNull();
      expect(f.state.mode).toBe("exploration");
      const ended = f.events.filter((e) => e.type === "CombatEnded");
      expect(ended).toHaveLength(1);
      expect(JSON.stringify(fold(f.events))).toBe(JSON.stringify(f.state));
    }
  });
});

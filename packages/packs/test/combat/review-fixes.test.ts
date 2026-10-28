import { describe, expect, test } from "bun:test";
import { draft } from "@wyrd/core";
import { autoFight, combatOf, resolveTurn, startCombat, unwrap, validateTurn } from "@wyrd/engine";
import { Fight } from "./fixture.ts";

const begin = (f: Fight, target = "npc:cutter") =>
  f.commit(
    unwrap(startCombat(f.state, { initiatorId: "pc", targetIds: [target], combatId: "c1" }, f.ctx)).events,
  );

describe("regressions from the M4 review", () => {
  test("no party member is left dying when a fight ends: they're stabilised or they die", () => {
    let dyingSeen = 0;
    for (let seed = 1; seed < 150; seed++) {
      const f = new Fight({
        seed,
        archetype: "scholar",
        companion: true,
        settings: { structural: { hardcore: true } },
      });
      begin(f);
      f.commit(autoFight(f.state, f.ctx).events);
      const changes = f.events.filter((e) => e.type === "CombatChanged");
      const last = (
        changes.at(-1)!.payload as {
          combat: { combatants: Record<string, { side: string; status: string }> };
        }
      ).combat;
      if (changes.some((e) => JSON.stringify(e.payload).includes('"status":"dying"'))) dyingSeen++;
      for (const [id, c] of Object.entries(last.combatants)) {
        if (c.side === "party" && c.status === "dying") expect(f.state.actors[id]!.dead).toBe(true);
      }
    }
    expect(dyingSeen).toBeGreaterThan(0);
  });

  test("fleeing from an exit doesn't provoke, and you can't flee once you're down", () => {
    const f = new Fight({ seed: 3 });
    f.commit([draft("EntityMoved", { entityId: "pc", toZoneId: "z:door" }, "engine")]);
    f.commit([draft("EntityMoved", { entityId: "npc:mags", toZoneId: "z:door" }, "engine")]);
    begin(f, "npc:mags");
    const c = combatOf(f.state);
    f.commit([
      draft(
        "CombatChanged",
        {
          combat: {
            ...c,
            turn: c.order.indexOf("pc"),
            engaged: [["pc", "npc:mags"]],
            combatants: { ...c.combatants, pc: { ...c.combatants.pc!, ap: 3 } },
          },
        },
        "engine",
      ),
    ]);
    const v = validateTurn(f.state, "pc", [{ type: "flee" }], f.ctx);
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    const r = unwrap(resolveTurn(f.state, v.value, f.ctx, "x"));
    expect(r.resolution.steps.filter((s) => s.summary.startsWith("Opportunity attack"))).toHaveLength(0);
    expect(r.resolution.combat?.ended).toBe("fled");
  });

  test("a dead PC can't take a turn", () => {
    const f = new Fight({ seed: 1 });
    f.commit([draft("ActorDied", { actorId: "pc", cause: "test" }, "engine")]);
    const v = validateTurn(f.state, "pc", [{ type: "move", toZoneId: "z:bar" }], f.ctx);
    if (v.ok) throw new Error("a dead PC's plan validated");
    expect(v.errors[0]?.code).toBe("ACTOR_DEAD");
  });

  test("attacking someone in the room with a sword closes in first instead of wasting the turn", () => {
    for (let seed = 1; seed < 40; seed++) {
      const f = new Fight({ seed, archetype: "sellsword" });
      const r = unwrap(
        resolveTurn(
          f.state,
          { actorId: "pc", actions: [{ type: "strike", targetId: "npc:mags" }] },
          f.ctx,
          "c1",
        ),
      );
      const mine = r.resolution.steps.filter((s) => s.phase === "player" && s.actorId === "pc");
      if (mine.length < 2) continue; // the PC was knocked out before their first turn
      expect(mine.some((s) => s.summary.includes("couldn't go on"))).toBe(false);
      expect(mine.some((s) => /Mags/.test(s.summary) && /(hit|attacked)/.test(s.summary))).toBe(true);
      return;
    }
    throw new Error("no seed gave the PC a first turn");
  });

  test("a melee strike on an unengaged target in the same zone validates as engage, then strike", () => {
    const f = new Fight({ seed: 2, archetype: "sellsword" });
    begin(f, "npc:mags");
    const c = combatOf(f.state);
    f.commit([
      draft("CombatChanged", { combat: { ...c, engaged: [], turn: c.order.indexOf("pc") } }, "engine"),
    ]);
    const v = validateTurn(f.state, "pc", [{ type: "strike", targetId: "npc:mags" }], f.ctx);
    if (!v.ok) throw new Error(JSON.stringify(v.planErrors));
    expect(v.value.actions).toEqual([
      { type: "engage", targetId: "npc:mags" },
      { type: "strike", targetId: "npc:mags" },
    ]);
  });

  test("a called shot at a location the target doesn't have is rejected before any roll", () => {
    for (let seed = 1; seed < 40; seed++) {
      const f = new Fight({ seed });
      f.commit(
        unwrap(
          resolveTurn(
            f.state,
            { actorId: "pc", actions: [{ type: "strike", targetId: "npc:fen" }] },
            f.ctx,
            "c1",
          ),
        ).events,
      );
      if (!f.state.combat) continue;
      const v = validateTurn(
        f.state,
        "pc",
        [{ type: "strike", targetId: "npc:fen", calledLocation: "arm" }],
        f.ctx,
      );
      expect(v.planErrors?.[0]?.code).toBe("LOCATION_UNKNOWN");
      expect(v.planErrors?.[0]?.message).toContain("right-arm");
      const ok = validateTurn(
        f.state,
        "pc",
        [{ type: "strike", targetId: "npc:fen", calledLocation: "right-arm" }],
        f.ctx,
      );
      expect(ok.ok).toBe(true);
      return;
    }
  });
});

import { describe, expect, test } from "bun:test";
import { draft } from "@wyrd/core";
import {
  applyCondition,
  autoFight,
  chooseActions,
  combatOf,
  legacyEvents,
  obituary,
  startCombat,
  unwrap,
} from "@wyrd/engine";
import { Fight } from "./fixture.ts";

const begin = (f: Fight, target = "npc:cutter") =>
  f.commit(
    unwrap(startCombat(f.state, { initiatorId: "pc", targetIds: [target], combatId: "c1" }, f.ctx)).events,
  );
const outcomeOf = (f: Fight) =>
  (f.events.find((e) => e.type === "CombatEnded")?.payload as { outcome: string } | undefined)?.outcome;

/** Gives one combatant the turn with full AP, for tactics tests. */
function giveTurn(f: Fight, id: string) {
  const c = combatOf(f.state);
  f.commit([
    draft(
      "CombatChanged",
      {
        combat: {
          ...c,
          turn: c.order.indexOf(id),
          combatants: { ...c.combatants, [id]: { ...c.combatants[id]!, ap: 3 } },
        },
      },
      "engine",
    ),
  ]);
}

describe("how fights end", () => {
  test("defeat in a normal campaign costs something and opens a new hook", () => {
    for (let seed = 1; seed < 200; seed++) {
      const f = new Fight({ seed, archetype: "scholar" });
      begin(f);
      f.commit(autoFight(f.state, f.ctx).events);
      if (outcomeOf(f) !== "defeat") continue;
      const pc = f.state.actors.pc!.sheet;
      expect(f.state.actors.pc!.dead).toBeUndefined();
      expect(pc.status.hp).toBe(1);
      expect(pc.status.wounds.every((w) => w.severity !== "lethal")).toBe(true);
      const hook = f.events.find(
        (e) =>
          e.type === "EntityCreated" && (e.payload as { entity: { kind: string } }).entity.kind === "quest",
      );
      expect(hook).toBeDefined();
      expect(
        f.events.some(
          (e) =>
            e.type === "TimeAdvanced" &&
            String((e.payload as { reason: string }).reason).startsWith("defeat"),
        ),
      ).toBe(true);
      return;
    }
    throw new Error("no seed produced a defeat");
  });

  test("death in hardcore kills the PC and ends the fight with a death outcome", () => {
    for (let seed = 1; seed < 300; seed++) {
      const f = new Fight({ seed, archetype: "scholar", settings: { structural: { hardcore: true } } });
      begin(f);
      f.commit(autoFight(f.state, f.ctx).events);
      if (outcomeOf(f) !== "death") continue;
      expect(f.state.actors.pc!.dead).toBe(true);
      expect(
        f.events.some((e) => e.type === "ActorDied" && (e.payload as { actorId: string }).actorId === "pc"),
      ).toBe(true);
      return;
    }
    throw new Error("no seed produced a hardcore death");
  });

  test("a normal-campaign PC never dies", () => {
    for (let seed = 1; seed < 60; seed++) {
      const f = new Fight({ seed, archetype: "scholar" });
      begin(f);
      f.commit(autoFight(f.state, f.ctx).events);
      expect(f.state.actors.pc!.dead).toBeUndefined();
    }
  });
});

describe("tactics AI", () => {
  test("an archer under fire takes cover when there is some", () => {
    const f = new Fight({ seed: 3 });
    f.commit([draft("EntityMoved", { entityId: "npc:fen", toZoneId: "z:bar" }, "engine")]);
    begin(f, "npc:fen");
    giveTurn(f, "npc:fen");
    const plan = chooseActions(f.state, "npc:fen", f.ctx);
    expect(plan.map((a) => a.type)).toContain("takeCover");
  });

  test("a combatant whose nerve broke heads for the way out", () => {
    const f = new Fight({ seed: 3 });
    begin(f);
    const c = combatOf(f.state);
    f.commit([
      draft(
        "CombatChanged",
        {
          combat: {
            ...c,
            combatants: { ...c.combatants, "npc:bram": { ...c.combatants["npc:bram"]!, fleeing: true } },
          },
        },
        "engine",
      ),
    ]);
    giveTurn(f, "npc:bram");
    const plan = chooseActions(f.state, "npc:bram", f.ctx);
    expect(plan).toContainEqual({ type: "move", toZoneId: "z:door" });
  });

  test("on Hard, enemies finish a downed-but-dangerous foe first", () => {
    const f = new Fight({ seed: 3, companion: true, settings: { difficulty: "hard" } });
    f.commit([draft("EntityMoved", { entityId: "ally", toZoneId: "z:taproom" }, "engine")]);
    begin(f, "npc:mags");
    const c = combatOf(f.state);
    f.commit([
      draft(
        "CombatChanged",
        {
          combat: {
            ...c,
            engaged: [
              ["npc:mags", "pc"],
              ["npc:mags", "ally"],
            ],
          },
        },
        "engine",
      ),
    ]);
    f.commit([
      draft(
        "HpChanged",
        { actorId: "pc", hp: 0, delta: -f.state.actors.pc!.sheet.status.hp, cause: "damage" },
        "engine",
      ),
    ]);
    f.commit(unwrap(applyCondition(f.state, "pc", { id: "core:down" })));
    giveTurn(f, "npc:mags");
    const plan = chooseActions(f.state, "npc:mags", f.ctx);
    const strike = plan.find((a) => a.type === "strike");
    expect(strike && "targetId" in strike ? strike.targetId : null).toBe("pc");
  });
});

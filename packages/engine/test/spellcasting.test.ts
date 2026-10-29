import { describe, expect, test } from "bun:test";
import { draft, SceneState, SpellDef } from "@wyrd/core";
import { castSpell, type SpellContext } from "../src/plugins/spellcasting.ts";
import { unwrap } from "../src/result.ts";
import { ctx as rules, Sim } from "./sim.ts";

const fireDart = SpellDef.parse({
  id: "fire-dart",
  name: "Fire Dart",
  description: "A dart of flame.",
  school: "elemental",
  tier: 1,
  apCost: 1,
  range: "near",
  target: "actor",
  effects: [{ kind: "damage", amount: 3 }],
});

const mend = SpellDef.parse({
  id: "mend",
  name: "Mend",
  description: "Close a cut.",
  school: "healing",
  tier: 1,
  apCost: 1,
  range: "touch",
  target: "actor",
  effects: [{ kind: "heal", amount: 4 }],
});

const glitter = SpellDef.parse({
  id: "glitter",
  name: "Glitter",
  description: "Mark the ground.",
  school: "illusion",
  tier: 2,
  apCost: 2,
  range: "near",
  target: "zone",
  effects: [{ kind: "createZoneTag", tag: "glittering" }],
});

const ward = SpellDef.parse({
  id: "ward",
  name: "Ward",
  description: "A small shield.",
  school: "warding",
  tier: 1,
  apCost: 1,
  range: "touch",
  target: "actor",
  effects: [{ kind: "ward", amount: 3 }],
});

const spells = {
  "test:fire-dart": { ...fireDart, id: "test:fire-dart" },
  "test:mend": { ...mend, id: "test:mend" },
  "test:glitter": { ...glitter, id: "test:glitter" },
  "test:ward": { ...ward, id: "test:ward" },
};
const ctx: SpellContext = { ...rules, spells, nameOf: (id) => id, creatureName: () => "a wolf" };

function sim(seed: number | string = 4) {
  const s = new Sim({}, seed);
  s.addActor("pc", "pc");
  s.addActor("npc:target", "npc");
  s.commit([
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: "scene-1",
        locationId: "loc:test",
        zones: [
          { id: "z:here", name: "here" },
          { id: "z:there", name: "there" },
        ],
        positions: { pc: "z:here", "npc:target": "z:here" },
        openedAt: 0,
      }),
    }),
  ]);
  return s;
}

const types = (drafts: { type: string }[]) => drafts.map((d) => d.type);

describe("spellcasting (spec 05)", () => {
  test("a damage spell costs strain and hurts its target", () => {
    const s = sim();
    const before = s.state.actors["npc:target"]!.sheet.status.hp;
    const events = unwrap(
      castSpell(s.state, "pc", { spellId: "test:fire-dart", targetIds: ["npc:target"] }, ctx),
    );
    expect(types(events)).toContain("SpellCast");
    s.commit(events);
    const cast = events.find((e) => e.type === "SpellCast")!;
    expect(cast.payload.strain).toBe(1);
    expect(s.state.actors["npc:target"]!.sheet.status.hp).toBe(before - 3);
    expect(s.state.actors.pc!.sheet.status.hp).toBe(s.state.actors.pc!.sheet.derived.hpMax - 1);
  });

  test("healing cannot exceed the effective maximum", () => {
    const s = sim();
    const max = s.state.actors.pc!.sheet.derived.hpMax;
    s.commit([draft("HpChanged", { actorId: "pc", hp: max - 2, delta: 0, cause: "damage" })]);
    const events = unwrap(castSpell(s.state, "pc", { spellId: "test:mend", targetIds: ["pc"] }, ctx));
    s.commit(events);
    expect(s.state.actors.pc!.sheet.status.hp).toBe(s.state.actors.pc!.sheet.derived.hpMax);
  });

  test("a zone spell adds its tag to the scene", () => {
    const s = sim();
    s.commit(unwrap(castSpell(s.state, "pc", { spellId: "test:glitter", targetIds: [] }, ctx)));
    expect(s.state.scene!.zones.find((z) => z.id === "z:here")!.tags).toContain("glittering");
  });

  test("a ward applies its condition", () => {
    const s = sim();
    s.commit(unwrap(castSpell(s.state, "pc", { spellId: "test:ward", targetIds: ["pc"] }, ctx)));
    expect(s.state.actors.pc!.sheet.status.conditions.some((c) => c.id === "core:warded")).toBe(true);
  });

  test("the known-spell list gates casting, and range is enforced", () => {
    const s = sim();
    const blocked = { ...s.state, flags: { ...s.state.flags, spellcasting: { known: { pc: [] } } } };
    expect(
      castSpell(blocked, "pc", { spellId: "test:fire-dart", targetIds: ["npc:target"] }, ctx),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "SPELL_UNKNOWN" }],
    });
    expect(
      castSpell(s.state, "pc", { spellId: "test:fire-dart", targetIds: ["npc:absent"] }, ctx),
    ).toMatchObject({ ok: false, errors: [{ code: "TARGET_UNKNOWN" }] });
  });

  test("a critical failure miscasts: backlash damage, exhaustion and a broken spell", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = sim(seed);
      const events = unwrap(
        castSpell(
          s.state,
          "pc",
          { spellId: "test:fire-dart", targetIds: ["npc:target"] },
          {
            ...ctx,
            spells: {
              ...spells,
              "test:fire-dart": {
                ...fireDart,
                id: "test:fire-dart",
                check: { skill: "core:lore/arcana", difficulty: "hard" },
              },
            },
          },
        ),
      );
      if (events.some((e) => e.type === "SpellMiscast")) {
        expect(types(events)).toContain("ConditionApplied");
        expect(types(events)).toContain("SpellMiscast");
        const before = s.state.actors.pc!.sheet.status.hp;
        s.commit(events);
        expect(s.state.actors.pc!.sheet.status.hp).toBeLessThan(before);
        return;
      }
    }
    throw new Error("no seed produced a miscast");
  });
});

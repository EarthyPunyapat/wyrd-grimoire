import { describe, expect, test } from "bun:test";
import { type CampaignSettingsInput, draft, type EventDraft, type Wound } from "@wyrd/core";
import { applyCondition } from "../src/conditions.ts";
import { type BleedResult, bleedTick } from "../src/injury/bleeding.ts";
import type { InjuryContext } from "../src/injury/hit.ts";
import { fold } from "../src/reduce.ts";
import { unwrap } from "../src/result.ts";
import { attrs } from "./fixtures.ts";
import { ctx as baseCtx, Sim } from "./sim.ts";

const injuryCtx: InjuryContext = {
  ...baseCtx,
  items: { weapons: {}, armor: {}, gear: {} },
  bodyPlans: {},
};

function sim(settings: CampaignSettingsInput = {}, seed: number | string = 1) {
  const s = new Sim(settings, seed);
  s.addActor("foe", "npc", { attributes: attrs({}) });
  return s;
}

const types = (events: EventDraft[]) => events.map((e) => e.type);
const condition = (s: Sim, id: string) =>
  s.state.actors.foe!.sheet.status.conditions.find((c) => c.id === id);

const setHp = (s: Sim, hp: number) =>
  s.commit([
    draft(
      "HpChanged",
      { actorId: "foe", hp, delta: hp - s.state.actors.foe!.sheet.status.hp, cause: "damage" },
      "engine",
    ),
  ]);

const bleed = (s: Sim, level: number) =>
  s.commit(unwrap(applyCondition(s.state, "foe", { id: "core:bleeding", level })));

const wound = (id: string, severity: Wound["severity"]): Wound => ({
  id,
  location: "torso",
  locationKind: "torso",
  severity,
  fracture: false,
  severed: false,
  hpMaxReduction: severity === "minor" ? 2 : severity === "serious" ? 5 : 10,
});

/** Finds a seed where `pred` holds for the outcome of a bleed tick on a prepared sim. */
function seedWhere(
  pred: (r: BleedResult) => boolean,
  prepare: (s: Sim) => void,
  settings: CampaignSettingsInput = {},
): Sim {
  for (let seed = 0; seed < 2000; seed++) {
    const s = sim(settings, seed);
    prepare(s);
    const r = bleedTick(s.state, "foe", injuryCtx);
    if (r.ok && pred(r.value)) return s;
  }
  throw new Error("no seed found");
}

/** Runs one bleed tick on `s` and commits its events. */
function tick(s: Sim) {
  const out = unwrap(bleedTick(s.state, "foe", injuryCtx));
  s.commit(out.events);
  return out;
}

describe("bleedTick: above 0 HP", () => {
  test("bleeding 2 at 10 HP takes 2 HP", () => {
    const s = sim();
    setHp(s, 10);
    bleed(s, 2);
    const out = tick(s);
    expect(types(out.events)).toEqual(["HpChanged"]);
    expect(out.events[0]).toMatchObject({
      type: "HpChanged",
      payload: { actorId: "foe", hp: 8, delta: -2, cause: "bleeding" },
    });
    expect(out.worsened).toBeNull();
    expect(s.state.actors.foe!.sheet.status.hp).toBe(8);
  });

  test("bleeding 3 at 2 HP floors at 0 and makes the Down check", () => {
    const s = sim();
    setHp(s, 2);
    bleed(s, 3);
    const out = tick(s);
    expect(types(out.events)).toEqual(["HpChanged", "CheckResolved", "ConditionApplied"]);
    expect(out.events[0]).toMatchObject({ payload: { hp: 0, delta: -2, cause: "bleeding" } });
    expect(out.events[1]).toMatchObject({
      payload: { request: { purpose: "stay conscious at 0 HP" } },
    });
    expect(s.state.actors.foe!.sheet.status.hp).toBe(0);
    const downed = condition(s, "core:down") !== undefined || condition(s, "core:unconscious") !== undefined;
    expect(downed).toBe(true);
    expect(fold(s.events)).toEqual(s.state);
  });

  test("with no bleeding condition there is nothing to do", () => {
    const s = sim();
    setHp(s, 10);
    const out = unwrap(bleedTick(s.state, "foe", injuryCtx));
    expect(out).toEqual({ events: [], worsened: null });
  });

  test("the bleeding subsystem off means no events", () => {
    const s = sim({ subsystems: { bleeding: false } });
    setHp(s, 10);
    bleed(s, 2);
    expect(unwrap(bleedTick(s.state, "foe", injuryCtx))).toEqual({ events: [], worsened: null });
  });
});

describe("bleedTick: at 0 HP", () => {
  const down = (s: Sim) => s.commit(unwrap(applyCondition(s.state, "foe", { id: "core:down" })));

  test("Down with a failed END check becomes Unconscious and loses Down", () => {
    const prepare = (s: Sim) => {
      setHp(s, 0);
      down(s);
      bleed(s, 1);
    };
    const s = seedWhere((r) => r.worsened === "unconscious", prepare);
    const out = tick(s);
    expect(out.worsened).toBe("unconscious");
    expect(types(out.events)).toContain("CheckResolved");
    expect(types(out.events)).not.toContain("HpChanged");
    expect(condition(s, "core:unconscious")).toBeDefined();
    expect(condition(s, "core:down")).toBeUndefined();
    expect(s.state.actors.foe!.sheet.status.wounds).toEqual([]);
  });

  test("Down with a passed END check stays Down", () => {
    const prepare = (s: Sim) => {
      setHp(s, 0);
      down(s);
      bleed(s, 1);
    };
    const s = seedWhere((r) => r.worsened === null && types(r.events).includes("CheckResolved"), prepare);
    const out = tick(s);
    expect(out.worsened).toBeNull();
    expect(condition(s, "core:down")).toBeDefined();
    expect(condition(s, "core:unconscious")).toBeUndefined();
  });

  test("Unconscious with a failed END check makes the most severe wound lethal, with bleeding at max", () => {
    const prepare = (s: Sim) => {
      setHp(s, 0);
      s.commit([draft("WoundInflicted", { actorId: "foe", wound: wound("foe-w1", "critical") }, "engine")]);
      s.commit(unwrap(applyCondition(s.state, "foe", { id: "core:unconscious" })));
      bleed(s, 1);
    };
    const s = seedWhere((r) => r.worsened === "lethal", prepare);
    const out = tick(s);
    expect(out.worsened).toBe("lethal");
    expect(out.events).toContainEqual(
      expect.objectContaining({
        type: "WoundWorsened",
        payload: { actorId: "foe", woundId: "foe-w1", severity: "lethal", hpMaxReduction: 10 },
      }),
    );
    expect(s.state.actors.foe!.sheet.status.wounds[0]!.severity).toBe("lethal");
    expect(condition(s, "core:unconscious")).toBeDefined();
    expect(condition(s, "core:down")).toBeUndefined();
    expect(condition(s, "core:bleeding")?.level).toBe(3);
  });

  test("the most severe wound is worsened, not the most recent one", () => {
    const prepare = (s: Sim) => {
      setHp(s, 0);
      s.commit([
        draft("WoundInflicted", { actorId: "foe", wound: wound("foe-w1", "serious") }, "engine"),
        draft(
          "WoundInflicted",
          { actorId: "foe", wound: { ...wound("foe-w2", "minor"), location: "left-arm" } },
          "engine",
        ),
      ]);
      s.commit(unwrap(applyCondition(s.state, "foe", { id: "core:unconscious" })));
      bleed(s, 1);
    };
    const s = seedWhere((r) => r.worsened === "lethal", prepare);
    tick(s);
    expect(s.state.actors.foe!.sheet.status.wounds.map((w) => w.severity)).toEqual(["lethal", "minor"]);
  });

  test("on a tie in severity the most recently inflicted wound is worsened", () => {
    const prepare = (s: Sim) => {
      setHp(s, 0);
      s.commit([
        draft("WoundInflicted", { actorId: "foe", wound: wound("foe-w1", "critical") }, "engine"),
        draft(
          "WoundInflicted",
          { actorId: "foe", wound: { ...wound("foe-w2", "critical"), location: "head" } },
          "engine",
        ),
      ]);
      s.commit(unwrap(applyCondition(s.state, "foe", { id: "core:unconscious" })));
      bleed(s, 1);
    };
    const s = seedWhere((r) => r.worsened === "lethal", prepare);
    tick(s);
    expect(s.state.actors.foe!.sheet.status.wounds.map((w) => w.severity)).toEqual(["critical", "lethal"]);
  });

  test("an Unconscious actor whose worst wound is already lethal rolls END and changes nothing else", () => {
    const s = sim();
    setHp(s, 0);
    s.commit([draft("WoundInflicted", { actorId: "foe", wound: wound("foe-w1", "lethal") }, "engine")]);
    s.commit(unwrap(applyCondition(s.state, "foe", { id: "core:unconscious" })));
    bleed(s, 1);
    const out = tick(s);
    expect(out.worsened).toBeNull();
    expect(types(out.events)).toEqual(["CheckResolved"]);
    expect(s.state.actors.foe!.sheet.status.wounds.map((w) => w.severity)).toEqual(["lethal"]);
  });
});

describe("bleedTick: Unconscious actors", () => {
  test("an Unconscious actor reaching 0 HP from above emits only HpChanged; END rolls start next tick", () => {
    const s = sim();
    setHp(s, 2);
    s.commit(unwrap(applyCondition(s.state, "foe", { id: "core:unconscious" })));
    bleed(s, 3);
    const out = tick(s);
    expect(types(out.events)).toEqual(["HpChanged"]);
    expect(out.events[0]).toMatchObject({ payload: { hp: 0, delta: -2, cause: "bleeding" } });
    expect(out.worsened).toBeNull();
    expect(s.state.actors.foe!.sheet.status.hp).toBe(0);
    expect(condition(s, "core:down")).toBeUndefined();

    const next = tick(s);
    expect(types(next.events)).toContain("CheckResolved");
  });
});

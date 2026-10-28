import { describe, expect, test } from "bun:test";
import {
  type ArmorDef,
  type CampaignSettingsInput,
  draft,
  type EventDraft,
  type ItemCatalog,
  type WeaponDef,
  type Wound,
} from "@wyrd/core";
import { applyCondition } from "../src/conditions.ts";
import {
  type HitInput,
  type HitOutcome,
  type InjuryContext,
  lethalFate,
  resolveHit,
} from "../src/injury/hit.ts";
import { effectiveHpMax } from "../src/injury/hp.ts";
import { fold } from "../src/reduce.ts";
import { unwrap } from "../src/result.ts";
import { attrs } from "./fixtures.ts";
import { ctx as baseCtx, Sim } from "./sim.ts";

const weapon = (id: string, damage: string, damageType: string, over: Partial<WeaponDef> = {}) =>
  ({
    id,
    name: id,
    description: "",
    weightKg: 1,
    price: 1,
    tags: [],
    skill: "core:melee",
    damage,
    damageType,
    armorPiercing: 0,
    hands: 1,
    ranges: {},
    reloadAp: 0,
    ...over,
  }) as WeaponDef & { id: string };

const armour = (id: string, covers: string[], protection: Record<string, number>) =>
  ({
    id,
    name: id,
    description: "",
    weightKg: 1,
    price: 1,
    tags: [],
    covers,
    protection,
    penalties: [],
  }) as ArmorDef & { id: string };

/** `1d1+n` always rolls n + 1, so a test picks the raw damage it wants. */
const fixed = (damage: number, type: string, over: Partial<WeaponDef> = {}) =>
  weapon(`t:${type}${damage}`, `1d1+${damage - 1}`, type, over);

const mail = armour("t:mail", ["torso", "right-arm"], { cut: 9, pierce: 3, blunt: 2 });

function itemsWith(...weapons: Array<WeaponDef & { id: string }>): ItemCatalog {
  return {
    weapons: Object.fromEntries(weapons.map((w) => [w.id, w])),
    armor: { [mail.id]: mail },
    gear: {},
  };
}

const ctxFor = (items: ItemCatalog): InjuryContext => ({ ...baseCtx, items, bodyPlans: {} });

function sim(settings: CampaignSettingsInput = {}, seed: number | string = 1) {
  const s = new Sim(settings, seed);
  s.addActor("pc", "pc", { attributes: attrs({}) });
  s.addActor("foe", "npc", { attributes: attrs({}) });
  return s;
}

const setHp = (s: Sim, actorId: string, hp: number) =>
  s.commit([
    draft(
      "HpChanged",
      { actorId, hp, delta: hp - s.state.actors[actorId]!.sheet.status.hp, cause: "damage" },
      "engine",
    ),
  ]);

const criticalTorso: Wound = {
  id: "foe-w1",
  location: "torso",
  locationKind: "torso",
  severity: "critical",
  fracture: false,
  severed: false,
  hpMaxReduction: 10,
};

/** Hits `foe` with a fixed-damage weapon from `pc`. */
function hit(s: Sim, w: WeaponDef & { id: string }, over: Partial<HitInput> = {}) {
  const input: HitInput = {
    attackerId: "pc",
    targetId: "foe",
    weaponId: w.id,
    degree: "success",
    calledLocation: "torso",
    ...over,
  };
  return resolveHit(s.state, input, ctxFor(itemsWith(w)));
}

function commitHit(s: Sim, w: WeaponDef & { id: string }, over: Partial<HitInput> = {}) {
  const out = unwrap(hit(s, w, over));
  s.commit(out.events);
  return out;
}

const foe = (s: Sim) => s.state.actors.foe!.sheet;
const types = (events: EventDraft[]) => events.map((e) => e.type);
const condition = (s: Sim, id: string, actorId = "foe") =>
  s.state.actors[actorId]!.sheet.status.conditions.find((c) => c.id === id);

/** Finds a seed where `pred` holds for the outcome of `attempt` on a fresh sim. */
function seedWhere(
  attempt: (s: Sim) => ReturnType<typeof resolveHit>,
  pred: (out: HitOutcome) => boolean,
  prepare: (s: Sim) => void = () => {},
  settings: CampaignSettingsInput = {},
): Sim {
  for (let seed = 0; seed < 2000; seed++) {
    const s = sim(settings, seed);
    prepare(s);
    const r = attempt(s);
    if (r.ok && pred(r.value)) return s;
  }
  throw new Error("no seed found");
}

describe("resolveHit: damage", () => {
  test("a glancing hit below the threshold costs HP and nothing else", () => {
    const s = sim();
    const w = fixed(3, "blunt");
    const out = unwrap(hit(s, w));
    expect(types(out.events)).toEqual(["HitResolved", "HpChanged"]);
    expect(out.final).toBe(3);
    expect(out.wound).toBeNull();
    s.commit(out.events);
    expect(foe(s).status.hp).toBe(17);
    expect(foe(s).status.wounds).toEqual([]);
  });

  test("a called shot rolls no location; an uncalled one rolls d100 on the body plan", () => {
    const s = sim();
    const w = fixed(3, "blunt");
    const called = unwrap(hit(s, w, { calledLocation: "left-leg" }));
    expect(called.location).toBe("left-leg");
    const e = called.events[0]!;
    expect(e.type === "HitResolved" && e.payload.locationRoll).toBeNull();

    const rolled = unwrap(hit(s, w, { calledLocation: undefined }));
    const r = rolled.events[0]!;
    if (r.type !== "HitResolved") throw new Error("no HitResolved");
    expect(r.payload.locationRoll).toBeGreaterThanOrEqual(1);
    expect(r.payload.locationRoll).toBeLessThanOrEqual(100);
  });

  test("adds the strength bonus unless the weapon opts out", () => {
    const s = new Sim();
    s.addActor("pc", "pc", { attributes: attrs({ str: 9 }) });
    s.addActor("foe", "npc");
    const melee = fixed(3, "blunt");
    const bow = fixed(3, "pierce", { id: "t:bow", strengthBonus: false });
    expect(unwrap(hit(s, melee)).final).toBe(5);
    expect(unwrap(hit(s, bow)).final).toBe(3);
  });

  test("unarmed uses the tuning's unarmed dice and damage type", () => {
    const s = sim();
    const out = unwrap(
      resolveHit(
        s.state,
        { attackerId: "pc", targetId: "foe", weaponId: null, degree: "success", calledLocation: "torso" },
        ctxFor(itemsWith()),
      ),
    );
    const e = out.events[0]!;
    if (e.type !== "HitResolved") throw new Error("no HitResolved");
    expect(e.payload.weaponId).toBeNull();
    expect(e.payload.raw).toBeGreaterThanOrEqual(1);
    expect(e.payload.raw).toBeLessThanOrEqual(3);
  });

  test("a critical maximises the dice and halves armour", () => {
    const s = sim();
    s.commit([
      draft(
        "EquipmentChanged",
        { actorId: "foe", equipment: { held: { main: null, off: null }, worn: [mail.id], carried: [] } },
        "engine",
      ),
    ]);
    const w = weapon("t:axe", "1d6", "cut");
    const out = unwrap(hit(s, w, { degree: "critSuccess" }));
    const e = out.events[0]!;
    if (e.type !== "HitResolved") throw new Error("no HitResolved");
    expect(e.payload).toMatchObject({ raw: 6, protection: 4, final: 2, crit: true });
  });

  test("armour that absorbs everything leaves only HitResolved", () => {
    const s = sim();
    s.commit([
      draft(
        "EquipmentChanged",
        { actorId: "foe", equipment: { held: { main: null, off: null }, worn: [mail.id], carried: [] } },
        "engine",
      ),
    ]);
    const out = unwrap(hit(s, fixed(7, "cut")));
    expect(types(out.events)).toEqual(["HitResolved"]);
    expect(out.final).toBe(0);
    expect(out.wound).toBeNull();
    const e = out.events[0]!;
    expect(e.type === "HitResolved" && e.payload.protection).toBe(9);
    s.commit(out.events);
    expect(foe(s).status.hp).toBe(20);
  });
});

describe("resolveHit: errors", () => {
  test("unknown actors, weapons, worn armour, body plans and locations", () => {
    const s = sim();
    const w = fixed(3, "blunt");
    const code = (r: ReturnType<typeof resolveHit>) => (r.ok ? "ok" : r.errors[0]!.code);
    expect(code(hit(s, w, { targetId: "nobody" }))).toBe("ACTOR_UNKNOWN");
    expect(code(hit(s, w, { attackerId: "nobody" }))).toBe("ACTOR_UNKNOWN");
    expect(code(hit(s, w, { weaponId: "t:missing" }))).toBe("ITEM_UNKNOWN");
    expect(code(hit(s, w, { calledLocation: "tail" }))).toBe("LOCATION_UNKNOWN");

    s.commit([
      draft(
        "EquipmentChanged",
        {
          actorId: "foe",
          equipment: { held: { main: null, off: null }, worn: ["t:ghost-plate"], carried: [] },
        },
        "engine",
      ),
    ]);
    expect(code(hit(s, w))).toBe("ITEM_UNKNOWN");

    const odd = new Sim();
    odd.addActor("pc", "pc");
    odd.addActor("foe", "npc", { bodyPlan: "x:weird" });
    expect(code(hit(odd, w))).toBe("BODYPLAN_UNKNOWN");
  });
});

describe("resolveHit: wounds", () => {
  test("a 7-damage cut is a minor wound with bleeding 2, -2 max HP and a physical penalty", () => {
    const s = sim();
    const out = commitHit(s, fixed(7, "cut"));
    expect(out.wound).toMatchObject({
      severity: "minor",
      location: "torso",
      locationKind: "torso",
      damageType: "cut",
      hpMaxReduction: 2,
      penalty: { scope: "physical", value: -10 },
    });
    expect(condition(s, "core:bleeding")?.level).toBe(2);
    expect(effectiveHpMax(foe(s))).toBe(18);
    expect(foe(s).status.hp).toBe(13);
  });

  test("blunt 14 on the torso is serious and fractured, unless fractures are off", () => {
    const w = fixed(14, "blunt");
    const on = sim();
    expect(commitHit(on, w).wound).toMatchObject({ severity: "serious", fracture: true });
    const off = sim({ subsystems: { fractures: false } });
    expect(commitHit(off, w).wound).toMatchObject({ severity: "serious", fracture: false });
  });

  test("bleeding off skips bleeding; burn never bleeds", () => {
    const noBleed = sim({ subsystems: { bleeding: false } });
    commitHit(noBleed, fixed(7, "cut"));
    expect(condition(noBleed, "core:bleeding")).toBeUndefined();

    const burnt = sim();
    commitHit(burnt, fixed(7, "burn"));
    expect(condition(burnt, "core:bleeding")).toBeUndefined();
  });

  test("new bleeding adds onto existing bleeding, capped at 3", () => {
    const s = sim();
    s.commit(unwrap(applyCondition(s.state, "foe", { id: "core:bleeding", level: 2 })));
    commitHit(s, fixed(7, "cut"));
    expect(condition(s, "core:bleeding")?.level).toBe(3);
  });

  test("bleedingIf replaces the base and the cut bonus", () => {
    const s = sim();
    commitHit(s, fixed(14, "cut"), { calledLocation: "right-arm" });
    expect(condition(s, "core:bleeding")?.level).toBe(2);
    expect(foe(s).status.wounds[0]).toMatchObject({ severity: "serious", fracture: false });
  });

  test("a cut that reaches 4 x WT on a limb severs it; a blunt one doesn't", () => {
    const sever = sim();
    expect(commitHit(sever, fixed(28, "cut"), { calledLocation: "right-arm" }).wound).toMatchObject({
      severity: "critical",
      severed: true,
    });
    const short = sim();
    expect(commitHit(short, fixed(27, "cut"), { calledLocation: "right-arm" }).wound?.severed).toBe(false);
    const blunt = sim();
    expect(commitHit(blunt, fixed(28, "blunt"), { calledLocation: "right-arm" }).wound?.severed).toBe(false);
  });

  test("wound ids stay unique across hits", () => {
    const s = sim();
    commitHit(s, fixed(7, "blunt"));
    commitHit(s, fixed(7, "blunt"), { calledLocation: "left-arm" });
    const ids = foe(s).status.wounds.map((w) => w.id);
    expect(new Set(ids).size).toBe(2);
  });

  test("a wound's conditions and beats come from its effect", () => {
    const s = sim();
    setHp(s, "foe", 0);
    const out = commitHit(s, fixed(7, "blunt"), { calledLocation: "head" });
    // 7 x 1.5 = 10 -> minor, one step worse while Down -> serious: stunned and concussed.
    expect(out.wound?.severity).toBe("serious");
    expect(condition(s, "core:stunned")).toBeDefined();
    expect(condition(s, "core:concussed")).toBeDefined();
    expect(out.beats).toEqual([]);

    const t = sim();
    setHp(t, "foe", 0);
    expect(commitHit(t, fixed(14, "blunt")).beats).toContain("internal injury");
  });
});

describe("resolveHit: Down", () => {
  const dropToZero = (s: Sim) => setHp(s, "foe", 3);
  const attempt = (s: Sim) => hit(s, fixed(3, "blunt"));

  test("reaching 0 HP rolls END: success is Down", () => {
    const s = seedWhere(attempt, (o) => o.downed === "down", dropToZero);
    const out = commitHit(s, fixed(3, "blunt"));
    expect(out.downed).toBe("down");
    expect(types(out.events)).toContain("CheckResolved");
    expect(foe(s).status.hp).toBe(0);
    expect(condition(s, "core:down")).toBeDefined();
    expect(condition(s, "core:unconscious")).toBeUndefined();
  });

  test("failure is Unconscious", () => {
    const s = seedWhere(attempt, (o) => o.downed === "unconscious", dropToZero);
    const out = commitHit(s, fixed(3, "blunt"));
    expect(out.downed).toBe("unconscious");
    expect(condition(s, "core:unconscious")).toBeDefined();
    expect(condition(s, "core:down")).toBeUndefined();
  });

  test("a hit that doesn't reach 0 HP makes no check", () => {
    const out = unwrap(hit(sim(), fixed(3, "blunt")));
    expect(out.downed).toBeNull();
    expect(types(out.events)).not.toContain("CheckResolved");
  });

  test("a target already at 0 HP takes a minor wound from a 3-damage hit and stays at 0", () => {
    const s = sim();
    setHp(s, "foe", 0);
    const out = commitHit(s, fixed(3, "blunt"));
    expect(out.downed).toBeNull();
    expect(out.wound).toMatchObject({ severity: "minor", hpMaxReduction: 2 });
    expect(foe(s).status.hp).toBe(0);
    expect(types(out.events)).not.toContain("CheckResolved");
  });
});

describe("resolveHit: lethal wounds", () => {
  test("a second critical wound at the same location is lethal without a roll", () => {
    const s = sim();
    setHp(s, "foe", 0);
    s.commit([draft("WoundInflicted", { actorId: "foe", wound: criticalTorso }, "engine")]);
    const out = commitHit(s, fixed(21, "blunt"));
    expect(out.lethal).toMatchObject({ fate: "dying", immediate: false, deathInRounds: 5 });
    expect(types(out.events)).not.toContain("CheckResolved");
    expect(types(out.events)).toContain("WoundWorsened");
    const wounds = foe(s).status.wounds;
    expect(wounds.map((w) => w.severity)).toEqual(["critical", "lethal"]);
    expect(out.lethal?.woundId).toBe(wounds[1]!.id);
    expect(condition(s, "core:unconscious")).toBeDefined();
    expect(condition(s, "core:bleeding")?.level).toBe(3);
    expect(effectiveHpMax(foe(s))).toBe(0);
  });

  const headKill = (s: Sim) =>
    hit(s, fixed(14, "blunt"), { targetId: "pc", attackerId: "foe", calledLocation: "head" });
  const asPc = (s: Sim) => setHp(s, "pc", 0);

  test("a failed lethal check on a PC means Defeated in a normal campaign", () => {
    const s = seedWhere(headKill, (o) => o.lethal !== null && !o.lethal.immediate, asPc);
    const out = unwrap(headKill(s));
    expect(out.wound?.severity).toBe("lethal");
    expect(out.lethal).toMatchObject({ fate: "defeated", immediate: false, deathInRounds: 5 });
    s.commit(out.events);
    expect(s.state.actors.pc!.sheet.status.wounds[0]!.severity).toBe("lethal");
  });

  test("the same wound in a hardcore campaign is Dying", () => {
    const s = seedWhere(headKill, (o) => o.lethal !== null, asPc, {
      structural: { hardcore: true },
      companionDeath: true,
    });
    expect(unwrap(headKill(s)).lethal?.fate).toBe("dying");
  });

  test("a critical failure on the lethal check is immediate", () => {
    const s = seedWhere(headKill, (o) => o.lethal?.immediate === true, asPc);
    expect(unwrap(headKill(s)).lethal?.immediate).toBe(true);
  });

  test("a passed lethal check leaves the critical wound as it is", () => {
    const s = seedWhere(headKill, (o) => o.lethal === null && o.wound?.severity === "critical", asPc);
    const out = unwrap(headKill(s));
    expect(types(out.events)).toContain("CheckResolved");
    expect(out.wound?.severity).toBe("critical");
  });
});

describe("lethalFate", () => {
  test("follows the spec table", () => {
    const fate = (role: "pc" | "companion" | "npc", settings: CampaignSettingsInput) => {
      const s = new Sim(settings);
      s.addActor("a", role);
      return lethalFate(s.state, "a");
    };
    expect(fate("pc", {})).toBe("defeated");
    expect(fate("pc", { structural: { hardcore: true }, companionDeath: true })).toBe("dying");
    expect(fate("companion", {})).toBe("defeated");
    expect(fate("companion", { companionDeath: true })).toBe("dying");
    expect(fate("companion", { structural: { hardcore: true }, companionDeath: true })).toBe("dying");
    expect(fate("npc", {})).toBe("dying");
  });
});

describe("resolveHit: simple injuries", () => {
  test("a critical wound is a flat -30 on everything plus Down, with no bleeding or fracture", () => {
    const s = sim({ subsystems: { injuries: "simple" } });
    setHp(s, "foe", 0);
    const out = commitHit(s, fixed(14, "cut"));
    expect(out.wound).toMatchObject({
      locationKind: "torso",
      penalty: { scope: "all", value: -30 },
      fracture: false,
    });
    expect(condition(s, "core:down")).toBeDefined();
    expect(condition(s, "core:bleeding")).toBeUndefined();
    expect(out.beats).toEqual([]);
  });

  test("a minor wound is a flat -10", () => {
    const s = sim({ subsystems: { injuries: "simple" } });
    expect(commitHit(s, fixed(7, "cut"), { calledLocation: "left-leg" }).wound?.penalty).toEqual({
      scope: "all",
      value: -10,
    });
    expect(condition(s, "core:bleeding")).toBeUndefined();
  });
});

describe("resolveHit: replay", () => {
  test("committing the events and folding the log gives the same state, rng included", () => {
    const s = sim();
    setHp(s, "foe", 3);
    commitHit(s, fixed(3, "blunt"));
    commitHit(s, fixed(14, "cut"), { calledLocation: "head", attackerId: "pc" });
    commitHit(s, fixed(9, "blunt"), { calledLocation: undefined });
    expect(fold(s.events)).toEqual(s.state);
    expect(fold(s.events).campaign.rngState).toEqual(s.state.campaign.rngState);
  });

  test("is deterministic for the same state", () => {
    const s = sim();
    const w = fixed(7, "cut");
    expect(hit(s, w, { calledLocation: undefined })).toEqual(hit(s, w, { calledLocation: undefined }));
  });
});

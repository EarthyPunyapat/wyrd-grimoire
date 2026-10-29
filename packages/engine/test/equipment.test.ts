import { describe, expect, test } from "bun:test";
import {
  ArmorDef,
  draft,
  type Equipment,
  GearDef,
  type ItemCatalog,
  type KitEntry,
  WeaponDef,
} from "@wyrd/core";
import { moveEquipment, startingEquipment, validateEquipment } from "../src/equipment.ts";
import { makeSheet, Sim } from "./sim.ts";

// A small catalog with namespaced ids, shaped like the fantasy-core items it stands in for. The
// engine doesn't depend on @wyrd/packs, so the real pack is not loaded here.
const weapon = (local: string, extra: Record<string, unknown>) => ({
  ...WeaponDef.parse({
    id: local,
    name: local,
    weightKg: 1,
    price: 1,
    skill: "melee",
    damage: "1d4",
    damageType: "pierce",
    hands: 1,
    ranges: { engaged: 0 },
    ...extra,
  }),
  id: `fantasy-core:${local}`,
});
const armor = (local: string, covers: string[]) => ({
  ...ArmorDef.parse({
    id: local,
    name: local,
    weightKg: 1,
    price: 1,
    covers,
    protection: { cut: 1 },
  }),
  id: `fantasy-core:${local}`,
});
const gear = (local: string) => ({
  ...GearDef.parse({ id: local, name: local, weightKg: 0.1, price: 1 }),
  id: `fantasy-core:${local}`,
});

const items: ItemCatalog = {
  weapons: {
    "fantasy-core:dagger": weapon("dagger", {}),
    "fantasy-core:light-crossbow": weapon("light-crossbow", { hands: 2, skill: "ranged", damage: "1d10" }),
  },
  armor: {
    "fantasy-core:mail-hauberk": armor("mail-hauberk", ["torso", "right-arm", "left-arm"]),
    "fantasy-core:open-helmet": armor("open-helmet", ["head"]),
  },
  gear: {
    "fantasy-core:lockpicks": gear("lockpicks"),
    "fantasy-core:rope": gear("rope"),
    "fantasy-core:backpack": gear("backpack"),
  },
};

// The fantasy-core cutpurse kit, with the namespaced ids the loader resolves kit entries to.
const cutpurseKit: KitEntry[] = [
  { item: "fantasy-core:dagger", qty: 1 },
  { item: "fantasy-core:lockpicks", qty: 1 },
  { item: "fantasy-core:rope", qty: 1 },
  { item: "fantasy-core:backpack", qty: 1 },
];

const empty: Equipment = { held: { main: null, off: null }, worn: [], carried: [] };

const codes = (eq: Equipment) => {
  const r = validateEquipment(eq, items);
  return r.ok ? [] : r.errors.map((e) => e.code);
};

describe("startingEquipment", () => {
  test("a cutpurse kit holds the dagger and carries the lockpicks", () => {
    const eq = startingEquipment(cutpurseKit, items);
    expect(eq.held).toEqual({ main: "fantasy-core:dagger", off: null });
    expect(eq.worn).toEqual([]);
    expect(eq.carried).toEqual(cutpurseKit);
    expect(eq.carried).toContainEqual({ item: "fantasy-core:lockpicks", qty: 1 });
    expect(validateEquipment(eq, items).ok).toBe(true);
  });

  test("armour in the kit is worn, and every kit entry is carried", () => {
    const kit: KitEntry[] = [
      { item: "fantasy-core:mail-hauberk", qty: 1 },
      { item: "fantasy-core:open-helmet", qty: 1 },
    ];
    const eq = startingEquipment(kit, items);
    expect(eq.worn).toEqual(["fantasy-core:mail-hauberk", "fantasy-core:open-helmet"]);
    expect(eq.held.main).toBeNull();
    expect(eq.carried).toEqual(kit);
    expect(validateEquipment(eq, items).ok).toBe(true);
  });

  test("an empty kit gives empty equipment", () => {
    expect(startingEquipment([], items)).toEqual(empty);
  });
});

describe("validateEquipment", () => {
  test("a two-handed main weapon with an off hand is TWO_HANDED_OCCUPIED", () => {
    const eq: Equipment = {
      held: { main: "fantasy-core:light-crossbow", off: "fantasy-core:dagger" },
      worn: [],
      carried: [
        { item: "fantasy-core:light-crossbow", qty: 1 },
        { item: "fantasy-core:dagger", qty: 1 },
      ],
    };
    expect(codes(eq)).toEqual(["TWO_HANDED_OCCUPIED"]);
  });

  test("a worn id absent from the catalog is ITEM_UNKNOWN", () => {
    const eq: Equipment = {
      held: { main: null, off: null },
      worn: ["fantasy-core:ghost-plate"],
      carried: [{ item: "fantasy-core:ghost-plate", qty: 1 }],
    };
    expect(codes(eq)).toEqual(["ITEM_UNKNOWN"]);
  });

  test("a worn item that is not armour is NOT_ARMOUR", () => {
    const eq: Equipment = {
      held: { main: null, off: null },
      worn: ["fantasy-core:dagger"],
      carried: [{ item: "fantasy-core:dagger", qty: 1 }],
    };
    expect(codes(eq)).toEqual(["NOT_ARMOUR"]);
  });

  test("a held or worn item missing from carried is ITEM_NOT_CARRIED", () => {
    const eq: Equipment = {
      held: { main: "fantasy-core:dagger", off: null },
      worn: [],
      carried: [],
    };
    expect(codes(eq)).toEqual(["ITEM_NOT_CARRIED"]);
  });
});

describe("moveEquipment", () => {
  const carried = (sim: Sim, itemId: string, qty = 1) =>
    sim.commit([
      draft("ItemTransferred", {
        actorId: "pc",
        itemId,
        qty,
        location: { kind: "carried" },
        reason: "test",
      }),
    ]);
  const equipped = (sim: Sim) => sim.state.actors.pc!.sheet.equipment;

  test("wield, wear and stow are one validated equipment change each", () => {
    const sim = new Sim();
    sim.addActor("pc", "pc");
    carried(sim, "fantasy-core:dagger");
    carried(sim, "fantasy-core:mail-hauberk");

    const wield = moveEquipment(sim.state, "pc", "fantasy-core:dagger", "main", items);
    expect(wield.ok).toBe(true);
    if (wield.ok) sim.commit(wield.value);
    expect(equipped(sim).held.main).toBe("fantasy-core:dagger");

    const wear = moveEquipment(sim.state, "pc", "fantasy-core:mail-hauberk", "worn", items);
    expect(wear.ok).toBe(true);
    if (wear.ok) sim.commit(wear.value);
    expect(equipped(sim).worn).toEqual(["fantasy-core:mail-hauberk"]);

    const stow = moveEquipment(sim.state, "pc", "fantasy-core:dagger", "carried", items);
    expect(stow.ok).toBe(true);
    if (stow.ok) sim.commit(stow.value);
    expect(equipped(sim).held.main).toBeNull();
    expect(equipped(sim).carried).toContainEqual({ item: "fantasy-core:dagger", qty: 1 });
  });

  test("the off hand takes a one-handed weapon and refuses a two-handed one", () => {
    const sim = new Sim();
    sim.addActor("pc", "pc");
    carried(sim, "fantasy-core:dagger");
    carried(sim, "fantasy-core:light-crossbow");
    const oneHanded = moveEquipment(sim.state, "pc", "fantasy-core:dagger", "off", items);
    expect(oneHanded.ok).toBe(true);
    const twoHanded = moveEquipment(sim.state, "pc", "fantasy-core:light-crossbow", "off", items);
    expect(twoHanded.ok).toBe(false);
    if (!twoHanded.ok) expect(twoHanded.errors[0]!.code).toBe("TWO_HANDED_OFF");
  });

  test("gear cannot be wielded or worn, and an uncarried item is refused", () => {
    const sim = new Sim();
    sim.addActor("pc", "pc");
    carried(sim, "fantasy-core:rope");
    for (const to of ["main", "off", "worn"] as const) {
      const out = moveEquipment(sim.state, "pc", "fantasy-core:rope", to, items);
      expect(out.ok).toBe(false);
    }
    const missing = moveEquipment(sim.state, "pc", "fantasy-core:lockpicks", "main", items);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]!.code).toBe("ITEM_NOT_CARRIED");
  });
});

describe("sheet equipment", () => {
  test("a sheet built without equipment defaults to empty equipment", () => {
    const sim = new Sim();
    expect(makeSheet("pc", sim.state).equipment).toEqual(empty);
  });

  test("committing EquipmentChanged replaces the sheet's equipment", () => {
    const sim = new Sim();
    sim.addActor("pc", "pc");
    const eq = startingEquipment(cutpurseKit, items);
    sim.commit([draft("EquipmentChanged", { actorId: "pc", equipment: eq })]);
    expect(sim.state.actors.pc!.sheet.equipment).toEqual(eq);
  });
});

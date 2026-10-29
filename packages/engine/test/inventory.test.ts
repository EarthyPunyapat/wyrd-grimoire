import { describe, expect, test } from "bun:test";
import { type ItemCatalog, Rng, type ShopState } from "@wyrd/core";
import { buy, haggle, sell } from "../src/economy.ts";
import {
  capacityKg,
  carriedKg,
  degradeItem,
  encumbranceBand,
  equipItem,
  inventoryOf,
  spendAmmo,
} from "../src/inventory.ts";
import { unwrap } from "../src/result.ts";
import { ctx as rules, Sim } from "./sim.ts";

const gear = (id: string, weightKg: number, price: number) => ({
  id,
  name: id,
  description: "",
  weightKg,
  price,
  tags: [] as string[],
});
const items = {
  weapons: {},
  armor: {},
  gear: {
    "test:anvil": gear("test:anvil", 20, 10),
    "test:rock": gear("test:rock", 5, 10),
    "test:arrow": gear("test:arrow", 0, 1),
    "test:bullet": gear("test:bullet", 0, 1),
  },
} as unknown as ItemCatalog;
const ictx = { items, tuning: rules.tuning };

function sim(settings = {}) {
  const s = new Sim(settings, 2);
  s.addActor("pc", "pc");
  return s;
}

function give(s: Sim, itemId: string, qty: number) {
  s.commit([
    {
      type: "ItemTransferred",
      payload: { actorId: "pc", itemId, qty, location: { kind: "carried" }, reason: "test" },
      source: "engine",
    } as never,
  ]);
}

describe("inventory and encumbrance (spec 11)", () => {
  test("capacity is STR × 5 and the bands follow the load", () => {
    const s = sim();
    expect(capacityKg(s.state.actors.pc!.sheet, rules.tuning)).toBe(
      s.state.actors.pc!.sheet.attributes.str * 5,
    );
    give(s, "test:anvil", 1); // 20 kg of 25 → unburdened
    expect(carriedKg(s.state, "pc", ictx)).toBe(20);
    expect(encumbranceBand(s.state, "pc", ictx)).toBe("none");
    give(s, "test:rock", 1); // 25 kg = capacity → still unburdened
    expect(encumbranceBand(s.state, "pc", ictx)).toBe("none");
    give(s, "test:rock", 1); // 30 kg = 1.2× → burdened
    expect(encumbranceBand(s.state, "pc", ictx)).toBe("burdened");
    give(s, "test:anvil", 1); // 50 kg = 2× → heavily burdened
    expect(encumbranceBand(s.state, "pc", ictx)).toBe("heavilyBurdened");
    give(s, "test:anvil", 1); // 70 kg → overloaded
    expect(encumbranceBand(s.state, "pc", ictx)).toBe("overloaded");
  });

  test("abstract inventory ignores weight", () => {
    const s = sim({ subsystems: { inventory: "abstract" } });
    give(s, "test:anvil", 3);
    expect(carriedKg(s.state, "pc", ictx)).toBe(0);
    expect(encumbranceBand(s.state, "pc", ictx)).toBe("none");
  });

  test("equipping moves a stack into a worn slot", () => {
    const s = sim();
    s.commit(equipItem("pc", "test:rock", { kind: "worn", slot: "body" }));
    const stack = inventoryOf(s.state, "pc").stacks.find((x) => x.itemId === "test:rock")!;
    expect(stack.location).toEqual({ kind: "worn", slot: "body" });
  });

  test("spent ammunition is removed, and arrows can be recovered", () => {
    const s = sim({ subsystems: { ammo: true } });
    give(s, "test:arrow", 10);
    s.commit(spendAmmo(s.state, "pc", "test:arrow", 4));
    expect(inventoryOf(s.state, "pc").stacks.find((x) => x.itemId === "test:arrow")!.qty).toBe(6);
  });

  test("durability degrades one step at a time and stops at broken", () => {
    const s = sim();
    give(s, "test:rock", 1);
    for (let i = 0; i < 5; i++) s.commit(degradeItem(s.state, "pc", "test:rock", "test"));
    const stack = inventoryOf(s.state, "pc").stacks.find((x) => x.itemId === "test:rock")!;
    expect(stack.condition).toBe("broken");
  });
});

const shop: ShopState = {
  id: "shop:test",
  templateId: "test",
  name: "The Test Shop",
  kind: "general",
  settlement: "village",
  merchant: { id: "npc:merchant", name: "Mira", insight: 30 },
  attitude: 0,
  markup: 1,
  priceModifier: 1,
  stock: [{ itemId: "test:rock", qty: 10 }],
  lastRefresh: 0,
  bargain: null,
};

function rich(settings = {}) {
  const s = sim({ subsystems: { money: "haggling" }, ...settings });
  s.state = {
    ...s.state,
    economy: {
      wallets: { pc: { coins: 100, wealthLevel: 3 } },
      shops: { "shop:test": shop },
    },
  };
  give(s, "test:rock", 2);
  return s;
}
const ectx = { ...rules, items, nameOf: (id: string) => id };

describe("money and shops (spec 11)", () => {
  test("buying moves coins, stock and items", () => {
    const s = rich();
    const events = unwrap(buy(s.state, "pc", "shop:test", "test:rock", 2, ectx));
    s.commit(events);
    expect(s.state.economy.wallets.pc!.coins).toBe(80);
    expect(s.state.economy.shops["shop:test"]!.stock[0]!.qty).toBe(8);
  });

  test("selling pays a share of value and restocks the shop", () => {
    const s = rich();
    const before = s.state.economy.wallets.pc!.coins;
    s.commit(unwrap(sell(s.state, "pc", "shop:test", "test:rock", 1, ectx)));
    expect(s.state.economy.wallets.pc!.coins).toBe(before + 5);
    expect(s.state.economy.shops["shop:test"]!.stock[0]!.qty).toBe(11);
  });

  test("haggling sets a lasting price modifier", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = rich();
      const out = haggle(s.state, "pc", "shop:test", ectx);
      if (!out.ok) continue;
      s.commit(out.value);
      const bargain = s.state.economy.shops["shop:test"]!.bargain!;
      expect(["critSuccess", "success", "failure", "critFailure"]).toContain(
        bargain.modifier === 0.8
          ? "critSuccess"
          : bargain.modifier === 0.9
            ? "success"
            : bargain.modifier === 1
              ? "failure"
              : "critFailure",
      );
      return;
    }
    throw new Error("no seed resolved a haggle");
  });

  test("the RNG for recovery is deterministic", () => {
    const s = sim({ subsystems: { ammo: true } });
    const rng = new Rng(s.state.campaign.rngState);
    const first = Array.from({ length: 5 }, () => rng.int(1, 100));
    const rng2 = new Rng(s.state.campaign.rngState);
    expect(Array.from({ length: 5 }, () => rng2.int(1, 100))).toEqual(first);
  });
});

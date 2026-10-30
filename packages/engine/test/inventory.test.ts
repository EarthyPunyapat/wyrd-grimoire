import { describe, expect, test } from "bun:test";
import { draft, type ItemCatalog, Rng, SceneState, type ShopState } from "@wyrd/core";
import { buy, haggle, openShop, sell, shopHere } from "../src/economy.ts";
import { startingEquipment, startingKitEvents } from "../src/equipment.ts";
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
    "test:gem": gear("test:gem", 1, 100),
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

  test("a starting kit becomes inventory stacks and its ammunition can be spent", () => {
    const s = sim({ subsystems: { ammo: true } });
    const equipment = startingEquipment(
      [
        { item: "test:arrow", qty: 2 },
        { item: "test:rock", qty: 1 },
      ],
      items,
    );
    s.commit(startingKitEvents("pc", equipment));
    expect(inventoryOf(s.state, "pc").stacks.find((x) => x.itemId === "test:arrow")?.qty).toBe(2);
    expect(carriedKg(s.state, "pc", ictx)).toBe(5);
    s.commit(spendAmmo(s.state, "pc", "test:arrow", 1));
    expect(inventoryOf(s.state, "pc").stacks.find((x) => x.itemId === "test:arrow")?.qty).toBe(1);
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
  merchantPresent: false,
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

/** A shop selling one gem; `price` sets the shop line, so the shop can price it below base. */
const gemShop = (attitude: number, price?: number): ShopState => ({
  ...shop,
  attitude,
  stock: [price === undefined ? { itemId: "test:gem", qty: 10 } : { itemId: "test:gem", qty: 10, price }],
});
function atShop(shopState: ShopState, coins = 1000) {
  const s = sim({ subsystems: { money: "haggling" } });
  s.state = {
    ...s.state,
    economy: { wallets: { pc: { coins, wealthLevel: 3 } }, shops: { [shopState.id]: shopState } },
  };
  return s;
}

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

  test("a discounted shop line cannot be bought and sold back for profit", () => {
    // The gem's base is 100 and the shop line is 40 — below the 60% ceiling of its value.
    // Pricing the sale from the base would pay 50 and mint 10 coins per loop.
    const s = atShop(gemShop(0, 40));
    s.commit(unwrap(buy(s.state, "pc", "shop:test", "test:gem", 1, ectx)));
    expect(s.state.economy.wallets.pc!.coins).toBe(960);
    s.commit(unwrap(sell(s.state, "pc", "shop:test", "test:gem", 1, ectx)));
    expect(s.state.economy.wallets.pc!.coins).toBe(980);
  });

  test("selling back to the shop it came from can never return more than it cost", () => {
    for (const price of [1, 10, 40, 50, 60, 100, 150]) {
      for (const attitude of [-100, -50, 0, 50, 100]) {
        const s = atShop(gemShop(attitude, price), 10_000);
        const start = s.state.economy.wallets.pc!.coins;
        s.commit(unwrap(buy(s.state, "pc", "shop:test", "test:gem", 1, ectx)));
        const paid = start - s.state.economy.wallets.pc!.coins;
        const beforeSale = s.state.economy.wallets.pc!.coins;
        s.commit(unwrap(sell(s.state, "pc", "shop:test", "test:gem", 1, ectx)));
        const got = s.state.economy.wallets.pc!.coins - beforeSale;
        expect(got).toBeLessThanOrEqual(paid);
      }
    }
  });

  test("ordinary selling still pays the attitude share of the item's value", () => {
    // A shop that doesn't list the rock falls back to the pack price (10) → 5 at neutral attitude.
    const s = atShop(gemShop(0, 40));
    give(s, "test:rock", 1);
    const before = s.state.economy.wallets.pc!.coins;
    s.commit(unwrap(sell(s.state, "pc", "shop:test", "test:rock", 1, ectx)));
    expect(s.state.economy.wallets.pc!.coins).toBe(before + 5);
  });

  test("a shop line without its own price sells from the pack price", () => {
    const s = atShop(gemShop(0));
    give(s, "test:gem", 1);
    const before = s.state.economy.wallets.pc!.coins;
    s.commit(unwrap(sell(s.state, "pc", "shop:test", "test:gem", 1, ectx)));
    expect(s.state.economy.wallets.pc!.coins).toBe(before + 50);
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

describe("a shop belongs to a place", () => {
  const vendor = { ...shop, templateId: "gm" };
  const scene = (locationId: string) =>
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: `scene:${locationId}`,
        locationId,
        zones: [{ id: "z:1", name: "inside" }],
        positions: { pc: "z:1" },
        openedAt: 0,
      }),
    });

  test("a shop opened without a place is stamped with the scene it opened in", () => {
    const s = sim();
    s.commit([scene("loc:market"), draft("ShopOpened", { shop: vendor }, "engine")]);
    expect(s.state.economy.shops["shop:test"]!.locationId).toBe("loc:market");
    expect(shopHere(s.state)?.id).toBe("shop:test");
  });

  test("leaving the shop's place leaves the shop behind", () => {
    const s = sim();
    s.commit([scene("loc:market"), draft("ShopOpened", { shop: vendor }, "engine"), scene("loc:rooftop")]);
    expect(shopHere(s.state)).toBeNull();
    s.commit([scene("loc:market")]);
    expect(shopHere(s.state)?.id).toBe("shop:test");
  });

  test("an old shop with no recorded place uses the fallback location", () => {
    const s = sim();
    s.commit([scene("loc:opening")]);
    s.state = { ...s.state, economy: { wallets: {}, shops: { "shop:test": vendor } } };
    expect(shopHere(s.state, "loc:opening")?.id).toBe("shop:test");
    expect(shopHere(s.state, "loc:elsewhere")).toBeNull();
  });
});

test("a merchant won't buy the player's own creation gear; it leaves only through the story", () => {
  const s = sim({ subsystems: { money: "haggling" } });
  s.state = {
    ...s.state,
    economy: { wallets: { pc: { coins: 0, wealthLevel: 3 } }, shops: { "shop:test": shop } },
  };
  const ring = {
    id: "player:ring",
    name: "Lantern Ring",
    kind: "gear" as const,
    weightKg: 0,
    price: 0,
    tags: [],
  };
  const withRing = { ...items, gear: { ...items.gear, [ring.id]: ring } } as typeof items;
  give(s, ring.id, 1);
  const out = sell(s.state, "pc", "shop:test", ring.id, 1, { ...ectx, items: withRing });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.errors[0]!.code).toBe("SIGNATURE_ITEM");
});

describe("vendors the GM opens (D166)", () => {
  const scene = (locationId: string, positions: Record<string, string> = { pc: "z:1" }) =>
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: `scene:${locationId}`,
        locationId,
        zones: [{ id: "z:1", name: "inside" }],
        positions,
        openedAt: 0,
      }),
    });
  const newsstand = {
    name: "Planet Newsstand",
    kind: "newsstand",
    merchant: { id: "npc:sal", name: "Sal" },
    stock: [
      { name: "Daily Planet", description: "Today's edition.", price: 1, qty: 20, weightKg: 0.2 },
      { name: "Rock", price: 9, qty: 2, description: "", weightKg: 1 },
    ],
  };

  test("a vendor opens here with their own wares, reusing catalog items by name", () => {
    const s = sim();
    s.commit([scene("loc:planet", { pc: "z:1", "npc:sal": "z:1" })]);
    const out = unwrap(openShop(s.state, newsstand, items));
    s.commit(out.drafts);
    const shopNow = shopHere(s.state)!;
    expect(shopNow.name).toBe("Planet Newsstand");
    expect(shopNow.merchant).toMatchObject({ id: "npc:sal", name: "Sal" });
    expect(shopNow.merchantPresent).toBe(true);
    expect(shopNow.locationId).toBe("loc:planet");
    const ids = shopNow.stock.map((line) => line.itemId);
    // "Rock" already exists in the catalog; the paper is defined for this campaign.
    expect(ids).toContain("test:rock");
    expect(ids.some((id) => id.startsWith("campaign:daily-planet"))).toBe(true);
    expect(shopNow.stock.find((line) => line.itemId === "test:rock")!.price).toBe(9);
  });

  test("the shop closes when its merchant walks away, and only one vendor opens per place", () => {
    const s = sim();
    s.commit([scene("loc:planet", { pc: "z:1", "npc:sal": "z:1" })]);
    s.commit(unwrap(openShop(s.state, newsstand, items)).drafts);
    const again = openShop(s.state, { ...newsstand, name: "Another Stand" }, items);
    expect(again.ok).toBe(false);
    s.commit([scene("loc:planet")]);
    expect(shopHere(s.state)).toBeNull();
  });

  test("a merchant who isn't a person in the scene is named, not required", () => {
    const s = sim();
    s.commit([scene("loc:alley")]);
    const out = unwrap(openShop(s.state, { ...newsstand, merchant: { name: "a street vendor" } }, items));
    s.commit(out.drafts);
    expect(shopHere(s.state)?.merchantPresent).toBe(false);
    expect(shopHere(s.state)?.merchant.name).toBe("a street vendor");
  });
});

describe("a shop is a seller in front of you (D173)", () => {
  const scene = (locationId: string, positions: Record<string, string> = { pc: "z:1" }) =>
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: `scene:${locationId}`,
        locationId,
        zones: [{ id: "z:1", name: "here" }],
        positions,
        openedAt: 0,
      }),
    });

  test("a starting shop from world setup stays hidden: its merchant is never in the scene", () => {
    const s = sim();
    // Older campaigns opened their starting shop at the opening scene.
    s.commit([
      scene("loc:opening"),
      draft("ShopOpened", { shop: { ...shop, templateId: "generated-shop" } }, "engine"),
    ]);
    expect(shopHere(s.state)).toBeNull();
  });

  test("a starting shop whose merchant is actually here trades", () => {
    const s = sim();
    const withMerchant = {
      ...shop,
      templateId: "market",
      merchantPresent: true,
      merchant: { ...shop.merchant, id: "npc:mira" },
    };
    s.commit([
      scene("loc:market", { pc: "z:1", "npc:mira": "z:1" }),
      draft("ShopOpened", { shop: withMerchant }, "engine"),
    ]);
    expect(shopHere(s.state)?.id).toBe("shop:test");
  });
});

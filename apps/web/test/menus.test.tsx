import { expect, test } from "bun:test";
import type { GameView } from "@wyrd/core";
import { renderToStaticMarkup } from "react-dom/server";
import { Menus } from "../src/Menus.tsx";
import { ShopWares } from "../src/Shop.tsx";

const view = {
  id: "c1",
  name: "Ford",
  worldName: "The Ford",
  gameTime: 1440,
  resolution: "d20",
  scene: { location: "Watchtower", zone: "the long window", weather: "clear", present: [] },
  speakers: {},
  known: [],
  turns: [],
  suggestions: [],
  spells: [],
  skills: [],
  powerRating: 12,
  levelProposals: [],
  theme: null,
  shop: null,
  survival: { food: 0, water: 0, sleep: 0, exposure: 0, exposureKind: "none", notices: [] },
  pc: {
    id: "pc",
    identity: { name: "Ethan Hunt" },
    status: { hp: 7, luck: 3, conditions: [], wounds: [] },
    derived: { hpMax: 12 },
    level: 3,
    abilities: [],
    attributes: { str: 5, agi: 5, end: 5, int: 5, awa: 5, wil: 5, pre: 5 },
    skills: {},
    progression: { marks: [] },
    equipment: {
      held: { main: "fantasy-core:arming-sword", off: null },
      worn: ["fantasy-core:padded-jack"],
      carried: [],
    },
  },
  inventory: {
    capacityKg: 25,
    weightKg: 4,
    band: "none",
    coins: 50,
    items: [
      {
        id: "fantasy-core:arming-sword",
        name: "Arming Sword",
        qty: 1,
        location: "main hand",
        condition: "pristine",
        kind: "weapon",
        description: "A straight blade.",
        quality: "standard",
      },
      {
        id: "fantasy-core:padded-jack",
        name: "Padded Jack",
        qty: 1,
        location: "worn",
        condition: "pristine",
        kind: "armor",
        description: "Quilted linen.",
        quality: "standard",
      },
      {
        id: "fantasy-core:healing-draught",
        name: "Healing Draught",
        qty: 2,
        location: "carried",
        condition: "pristine",
        kind: "gear",
        description: "Bitter and green.",
        quality: "standard",
      },
    ],
  },
} as unknown as GameView;

const noop = () => {};
const render = (tab: Parameters<typeof Menus>[0]["tab"]) =>
  renderToStaticMarkup(
    <Menus
      view={view}
      tab={tab}
      onTab={noop}
      onRefresh={noop}
      onSend={noop}
      onTravel={noop}
      onOpenCodex={noop}
      onClose={noop}
    />,
  );

test("the status screen has all eight tabs with key hints as hints", () => {
  const html = render("inventory");
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-label="Status screen"');
  for (const name of ["Character", "Inventory", "Quests", "Journal", "Codex", "Map", "Timeline", "Settings"])
    expect(html).toContain(name);
  for (const [key, name] of [
    ["C", "Character"],
    ["I", "Inventory"],
    ["Q", "Quests"],
    ["J", "Journal"],
    ["M", "Map"],
  ] as const) {
    expect(html).toContain(`<span class="key" aria-hidden="true">${key}</span>`);
    expect(html).toContain(name);
  }
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain('role="tabpanel"');
  expect(html).toContain("Back to the story");
});

test("inventory is equipped slots plus a bag, and every item uses the story's item card", () => {
  const html = render("inventory");
  expect(html).toContain('class="equipped"');
  expect(html).toContain("Main hand");
  expect(html).toContain("Off hand");
  expect(html).toContain("Worn");
  expect(html).toContain('aria-label="Main hand: Arming Sword"');
  expect(html).toContain('aria-label="Worn: Padded Jack"');
  // The equipped items are not duplicated into the bag; the draught is.
  expect(html).toContain('aria-label="Healing Draught, Gear, carried, quantity 2"');
  expect(html).not.toContain('aria-label="Arming Sword, Weapon, main hand"');
  // The shared card anatomy: icon, gold name, printed type line, description.
  expect(html).toContain('class="gm-card item-card"');
  expect(html).toContain("Healing Draught");
  expect(html).toContain("Gear · carried");
  expect(html).toContain("Bitter and green.");
});

test("inventory offers instant moves, sorting and story-turn actions", () => {
  const html = render("inventory");
  expect(html).toContain("Sort:");
  for (const action of ["Use", "Give", "Throw", "Drop"]) expect(html).toContain(`>${action}<`);
  expect(html).toContain("In the story · takes a turn");
  // Trading happens at a vendor, never in the bag.
  expect(html).not.toContain("Buy ·");
  expect(html).not.toContain("Sell one");
});

test("no menu tab trades: the vendor's wares are their own pop-up content", () => {
  for (const tab of ["inventory", "quests", "map"] as const) expect(render(tab)).not.toContain("Buy ·");
  expect(render("inventory")).not.toContain('data-tab="market"');
  const shop = {
    id: "shop:stall",
    name: "The River Stall",
    merchant: "Old Tamsin",
    kind: "rope stall",
    attitude: 0,
    items: [{ id: "rope", name: "Hemp Rope", basePrice: 2, price: 2, stock: 3 }],
  };
  const html = renderToStaticMarkup(<ShopWares view={{ ...view, shop } as GameView} shop={shop} />);
  expect(html).toContain("sold by Old Tamsin");
  expect(html).toContain("Buy · 2c");
  expect(html).toContain("Sell one Healing Draught");
  // The player's own creation gear is shown as not for sale, never with a Sell button.
  const ring = {
    id: "player:lantern-ring",
    name: "Lantern Ring",
    qty: 1,
    location: "carried",
    condition: "pristine",
    kind: "gear",
    description: "",
    quality: "standard",
  };
  const withRing = {
    ...view,
    shop,
    inventory: { ...view.inventory, items: [...view.inventory.items, ring] },
  } as GameView;
  const keep = renderToStaticMarkup(<ShopWares view={withRing} shop={shop} />);
  expect(keep).not.toContain("Sell one Lantern Ring");
  expect(keep).toContain("Not for sale: Lantern Ring");
});

test("settings is one screen: the campaign's rules and this device's settings", () => {
  const html = renderToStaticMarkup(
    <Menus
      view={view}
      tab="settings"
      onTab={noop}
      onRefresh={noop}
      onSend={noop}
      onTravel={noop}
      onOpenCodex={noop}
      onClose={noop}
      appSettings={<p>Device panel</p>}
    />,
  );
  expect(html).toContain("This campaign");
  expect(html).toContain("This device and your models");
  expect(html).toContain("Device panel");
});

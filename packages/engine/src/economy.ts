import {
  type ActorId,
  type ArmorDef,
  draft,
  type EventDraft,
  GearDef,
  type ItemCatalog,
  type OpenShopArgs,
  ShopState,
  slugify,
  type WeaponDef,
} from "@wyrd/core";
import { resolveCheck } from "./checks.ts";
import { fail, ok, type Result } from "./result.ts";
import type { GameState, RulesContext } from "./state.ts";

/**
 * Money and shops (spec 11). Prices come from the pack's items and the shop's markup; buying and
 * selling move coins, stock and item stacks as events. Haggling is an opposed-ish Persuasion check
 * against the merchant's Insight, and the bargain lasts a day.
 */

export type EconomyContext = RulesContext & {
  items: ItemCatalog;
  nameOf: (id: string) => string;
};

const priceOfItem = (items: ItemCatalog, itemId: string): number | null => {
  const item: WeaponDef | ArmorDef | GearDef | undefined =
    items.weapons[itemId] ?? items.armor[itemId] ?? items.gear[itemId];
  return item ? item.price : null;
};

/** What this actor pays per unit right now, after markup, drift and a live bargain. */
export function buyPrice(
  state: GameState,
  shop: ShopState,
  actorId: ActorId,
  basePrice: number,
  ctx: EconomyContext,
): number {
  const live =
    shop.bargain !== null &&
    shop.bargain.actorId === actorId &&
    state.campaign.gameTime - shop.bargain.at <= ctx.tuning.economy.bargainMinutes;
  const bargain = live ? shop.bargain!.modifier : 1;
  return Math.max(1, Math.round(basePrice * shop.markup * shop.priceModifier * bargain));
}

/** What a merchant pays per unit: the attitude share of the shop's price (spec 11, Selling). */
export function sellPrice(shop: ShopState, basePrice: number, ctx: EconomyContext): number {
  const { min, max } = ctx.tuning.economy.selling;
  const share = min + ((shop.attitude + 100) / 200) * (max - min);
  return Math.max(1, Math.round(basePrice * share));
}

/**
 * The shop at the PC's current location, or null. A shop lives where it opened; one recorded before
 * shops had a place uses `fallbackLocationId` (the campaign's opening location).
 */
export function shopHere(state: GameState, fallbackLocationId?: string): ShopState | null {
  const scene = state.scene;
  if (!scene) return null;
  return (
    Object.values(state.economy?.shops ?? {}).find(
      (shop) =>
        (shop.locationId ?? fallbackLocationId) === scene.locationId &&
        // A merchant who is a person in the scene has to be here to sell (D166).
        (!shop.merchantPresent || scene.positions[shop.merchant.id] !== undefined),
    ) ?? null
  );
}

const ITEM_TABLES = ["weapons", "armor", "gear"] as const;

/** An existing item with this name (or whose id ends in its slug), so a vendor's wares reuse the catalog. */
function catalogItem(items: ItemCatalog, name: string): string | null {
  const wanted = name.trim().toLowerCase();
  const slug = slugify(name, "item");
  for (const table of ITEM_TABLES)
    for (const [id, def] of Object.entries(items[table]))
      if (def.name.toLowerCase() === wanted || id.split(":").pop() === slug) return id;
  return null;
}

/**
 * Open a vendor at the PC's location (D166): the GM names the merchant and wares that fit them. Wares
 * reuse catalog items by name; new ones are defined for this campaign. One vendor trades per place.
 */
export function openShop(
  state: GameState,
  args: OpenShopArgs,
  items: ItemCatalog,
): Result<{ drafts: EventDraft[]; shopId: string }> {
  const scene = state.scene;
  if (!scene) return fail("NO_SCENE", "There is no scene to open a shop in");
  const existing = shopHere(state);
  if (existing)
    return fail(
      "SHOP_HERE",
      `${existing.name} already trades here (${existing.id}); show it with a shop card`,
    );
  const drafts: EventDraft[] = [];
  const defined = new Set<string>();
  const taken = (id: string) => defined.has(id) || ITEM_TABLES.some((t) => Object.hasOwn(items[t], id));
  const stock = args.stock.map((line) => {
    const known = catalogItem(items, line.name);
    if (known) return { itemId: known, qty: line.qty, price: line.price };
    const base = slugify(line.name, "item");
    let local = base;
    for (let n = 2; taken(`campaign:${local}`); n++) local = `${base}-${n}`;
    const itemId = `campaign:${local}`;
    defined.add(itemId);
    drafts.push(
      draft(
        "ItemDefined",
        {
          itemId,
          def: GearDef.parse({
            id: local,
            name: line.name,
            description: line.description,
            weightKg: line.weightKg,
            price: line.price,
            tags: ["gm", "shop"],
          }),
        },
        "model",
      ),
    );
    return { itemId, qty: line.qty, price: line.price };
  });
  const present = !!args.merchant.id && scene.positions[args.merchant.id] !== undefined;
  const slug = slugify(args.name, "shop");
  let shopId = `shop:${slug}`;
  for (let n = 2; state.economy?.shops[shopId]; n++) shopId = `shop:${slug}-${n}`;
  const shop = ShopState.parse({
    id: shopId,
    templateId: "gm",
    locationId: scene.locationId,
    name: args.name,
    kind: args.kind,
    merchant: {
      id: present ? args.merchant.id : `npc:merchant-${slugify(args.merchant.name, "merchant")}`,
      name: args.merchant.name,
      insight: 30,
    },
    merchantPresent: present,
    stock,
    lastRefresh: state.campaign.gameTime,
  });
  drafts.push(draft("ShopOpened", { shop }, "model"));
  return ok({ drafts, shopId });
}

function shopOf(state: GameState, shopId: string): ShopState | null {
  return state.economy?.shops[shopId] ?? null;
}

export function buy(
  state: GameState,
  actorId: ActorId,
  shopId: string,
  itemId: string,
  qty: number,
  ctx: EconomyContext,
): Result<EventDraft[]> {
  const shop = shopOf(state, shopId);
  if (!shop) return fail("SHOP_UNKNOWN", `No shop called ${shopId}`);
  if (qty <= 0) return fail("QTY_INVALID", "Buy at least one");
  const line = shop.stock.find((s) => s.itemId === itemId);
  if (!line || line.qty < qty) return fail("OUT_OF_STOCK", `${ctx.nameOf(itemId)} is out of stock`);
  const base = line.price ?? priceOfItem(ctx.items, itemId);
  if (base === null) return fail("PRICE_UNKNOWN", `No price for ${itemId}`);
  const unit = buyPrice(state, shop, actorId, base, ctx);
  const total = unit * qty;
  const wallet = state.economy.wallets[actorId] ?? { coins: 0, wealthLevel: 3 };
  if (wallet.coins < total) return fail("NOT_ENOUGH_COINS", `That costs ${total}; you have ${wallet.coins}`);
  return ok([
    draft(
      "CoinsChanged",
      { actorId, delta: -total, reason: `bought ${qty} × ${ctx.nameOf(itemId)}` },
      "engine",
    ),
    draft("ShopStockChanged", { shopId, itemId, delta: -qty, reason: "purchase" }, "engine"),
    draft(
      "ItemTransferred",
      { actorId, itemId, qty, location: { kind: "carried" }, reason: `bought at ${shop.name}` },
      "engine",
    ),
  ]);
}

export function sell(
  state: GameState,
  actorId: ActorId,
  shopId: string,
  itemId: string,
  qty: number,
  ctx: EconomyContext,
): Result<EventDraft[]> {
  const shop = shopOf(state, shopId);
  if (!shop) return fail("SHOP_UNKNOWN", `No shop called ${shopId}`);
  if (qty <= 0) return fail("QTY_INVALID", "Sell at least one");
  // Gear the player wrote into their character is player canon (D147): it isn't pawned with one click.
  if (itemId.startsWith("player:"))
    return fail(
      "SIGNATURE_ITEM",
      "That's part of who your character is, so the merchant won't take it here. Sell it in the story if you mean it.",
    );
  const have = state.inventory?.actors[actorId]?.stacks
    .filter((s) => s.itemId === itemId)
    .reduce((sum, s) => sum + s.qty, 0);
  if ((have ?? 0) < qty) return fail("NOT_CARRIED", `You only carry ${have ?? 0}`);
  // Price the sale on the same basis a purchase would use: a cheap shop line also sells cheap,
  // so buying back from the shop it came from can never turn a profit.
  const line = shop.stock.find((s) => s.itemId === itemId);
  const base = line?.price ?? priceOfItem(ctx.items, itemId);
  if (base === null) return fail("PRICE_UNKNOWN", `No price for ${itemId}`);
  const coins = sellPrice(shop, base, ctx) * qty;
  return ok([
    draft("CoinsChanged", { actorId, delta: coins, reason: `sold ${qty} × ${ctx.nameOf(itemId)}` }, "engine"),
    draft("ShopStockChanged", { shopId, itemId, delta: qty, reason: "purchase from the PC" }, "engine"),
    draft("ItemTransferred", { actorId, itemId, qty, reason: `sold at ${shop.name}` }, "engine"),
  ]);
}

export function haggle(
  state: GameState,
  actorId: ActorId,
  shopId: string,
  ctx: EconomyContext,
): Result<EventDraft[]> {
  const shop = shopOf(state, shopId);
  if (!shop) return fail("SHOP_UNKNOWN", `No shop called ${shopId}`);
  if (state.campaign.settings.subsystems.money !== "haggling")
    return fail("HAGGLING_OFF", "Haggling is off in this campaign");
  const check = resolveCheck(
    state,
    {
      actorId,
      skill: "core:persuasion",
      difficulty: shop.merchant.insight >= 50 ? "hard" : shop.merchant.insight >= 30 ? "normal" : "easy",
      purpose: `haggle with ${shop.merchant.name}`,
      tags: ["social", "commerce"],
    },
    ctx,
  );
  if (!check.ok) return check;
  const degree = check.value.effective.degree;
  const multiplier = ctx.tuning.economy.haggle[degree];
  const summary =
    degree === "critSuccess"
      ? `${shop.merchant.name} gives you a generous price.`
      : degree === "success"
        ? `${shop.merchant.name} shaves a little off the price.`
        : degree === "critFailure"
          ? `${shop.merchant.name} is offended and raises the price.`
          : `${shop.merchant.name} won't budge.`;
  return ok([
    ...check.value.events,
    draft("BargainStruck", { actorId, shopId, multiplier, summary }, "engine"),
  ]);
}

/** Refresh a shop's stock from a template's lines (weekly tick or opening day). */
export function refreshShop(
  state: GameState,
  shopId: string,
  stock: Array<{ itemId: string; qty: number; price?: number }>,
): EventDraft[] {
  const shop = shopOf(state, shopId);
  if (!shop) return [];
  return [draft("ShopRefreshed", { shopId, stock }, "engine")];
}

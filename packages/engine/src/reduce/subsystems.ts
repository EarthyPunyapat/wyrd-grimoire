import { type EconomyState, type InventoryState, ItemLocation } from "@wyrd/core";
import type { GameState } from "../state.ts";
import type { Handlers } from "./types.ts";

const economyOf = (s: GameState): EconomyState => s.economy ?? { wallets: {}, shops: {} };

/** Inventory, economy, survival and other subsystem event handlers (M7). */
export const subsystemHandlers: Pick<
  Handlers,
  | "CoinsChanged"
  | "ItemTransferred"
  | "ItemConditionChanged"
  | "ShopOpened"
  | "ShopStockChanged"
  | "ShopRefreshed"
  | "BargainStruck"
> = {
  CoinsChanged: (s, e) => {
    const economy = economyOf(s);
    const wallet = economy.wallets[e.payload.actorId] ?? { coins: 0, wealthLevel: 3 };
    return {
      ...s,
      economy: {
        ...economy,
        wallets: {
          ...economy.wallets,
          [e.payload.actorId]: { ...wallet, coins: Math.max(0, wallet.coins + e.payload.delta) },
        },
      },
    };
  },

  ItemTransferred: (s, e) => {
    const inventory = (s.inventory ?? { actors: {} }) as InventoryState;
    const actor = inventory.actors[e.payload.actorId] ?? {
      actorId: e.payload.actorId,
      stacks: [],
      spentAmmo: {},
    };
    // The detailed item stack projection is filled by the inventory module; keep quantities
    // coherent here so a downtime crafting result can be spent by the next rules pass.
    const stacks = [...actor.stacks];
    const existing = stacks.find((st) => st.itemId === e.payload.itemId && st.qty > 0);
    if (e.payload.location) {
      const location = ItemLocation.parse(
        e.payload.location.kind === "held"
          ? { kind: "held", hand: e.payload.location.hand ?? "main" }
          : e.payload.location.kind === "container"
            ? { kind: "container", containerId: e.payload.location.containerId ?? "pack" }
            : e.payload.location.kind === "worn"
              ? { kind: "worn", slot: e.payload.location.slot ?? "body" }
              : { kind: "carried" },
      );
      if (existing) {
        existing.qty += e.payload.qty;
        existing.location = location;
      } else
        stacks.push({
          id: `stack:${e.payload.actorId}:${e.payload.itemId}`,
          itemId: e.payload.itemId,
          qty: e.payload.qty,
          location,
          condition: "pristine",
          quality: "standard",
        });
    } else if (existing) {
      existing.qty = Math.max(0, existing.qty - e.payload.qty);
    }
    return {
      ...s,
      inventory: {
        ...inventory,
        actors: {
          ...inventory.actors,
          [e.payload.actorId]: { ...actor, stacks: stacks.filter((st) => st.qty > 0) },
        },
      },
    };
  },

  ItemConditionChanged: (s, e) => {
    const inventory = (s.inventory ?? { actors: {} }) as InventoryState;
    const actor = inventory.actors[e.payload.actorId];
    if (!actor) return s;
    return {
      ...s,
      inventory: {
        ...inventory,
        actors: {
          ...inventory.actors,
          [e.payload.actorId]: {
            ...actor,
            stacks: actor.stacks.map((st) =>
              st.itemId === e.payload.itemId ? { ...st, condition: e.payload.condition } : st,
            ),
          },
        },
      },
    };
  },

  ShopOpened: (s, e) => {
    const economy = economyOf(s);
    return {
      ...s,
      economy: { ...economy, shops: { ...economy.shops, [e.payload.shop.id]: e.payload.shop } },
    };
  },

  ShopStockChanged: (s, e) => {
    const economy = economyOf(s);
    const shop = economy.shops[e.payload.shopId];
    if (!shop) return s;
    const stock = shop.stock
      .map((line) =>
        line.itemId === e.payload.itemId ? { ...line, qty: Math.max(0, line.qty + e.payload.delta) } : line,
      )
      .filter((line) => line.qty > 0);
    return {
      ...s,
      economy: { ...economy, shops: { ...economy.shops, [e.payload.shopId]: { ...shop, stock } } },
    };
  },

  ShopRefreshed: (s, e) => {
    const economy = economyOf(s);
    const shop = economy.shops[e.payload.shopId];
    if (!shop) return s;
    return {
      ...s,
      economy: { ...economy, shops: { ...economy.shops, [e.payload.shopId]: { ...shop } } },
    };
  },

  BargainStruck: (s, e) => {
    const economy = economyOf(s);
    const shop = economy.shops[e.payload.shopId];
    if (!shop) return s;
    return {
      ...s,
      economy: {
        ...economy,
        shops: {
          ...economy.shops,
          [e.payload.shopId]: {
            ...shop,
            bargain: { actorId: e.payload.actorId, modifier: e.payload.multiplier, at: s.campaign.gameTime },
          },
        },
      },
    };
  },
};

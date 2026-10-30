import { OpenShopArgs } from "@wyrd/core";
import { openShop } from "@wyrd/engine";
import { registerGmTool } from "../registry.ts";

registerGmTool({
  name: "open_shop",
  description:
    "Open a vendor at the current place when the player wants to trade and no shop is here: name the merchant (a present person's id when they are in the scene) and 1-20 wares with prices that fit this vendor, place and setting. The player browses it from a shop card; only one vendor trades per place.",
  schema: OpenShopArgs,
  run: (a, x) => {
    const result = openShop(x.state, a, x.items);
    return result.ok
      ? {
          ok: true,
          body: { shopId: result.value.shopId },
          effects: { drafts: result.value.drafts, cards: [{ type: "shop" }] },
        }
      : { ok: false, body: { errors: result.errors } };
  },
});

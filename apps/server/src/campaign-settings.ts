import { CampaignSettingsPatch, CampaignSettingsView, presetOf } from "@wyrd/core";
import { changeSettings, type GameState, settingsLocks } from "@wyrd/engine";
import type { CampaignStore } from "@wyrd/storage";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { AppEnvironment } from "./app.ts";

type Deps = {
  campaign: (id: string) => CampaignStore<GameState>;
  body: <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) => Promise<T>;
};

function settingsView(settings: GameState["campaign"]["settings"]): CampaignSettingsView {
  return CampaignSettingsView.parse({
    settings,
    preset: presetOf(settings),
    locks: settingsLocks(settings),
  });
}

/**
 * Campaign settings (spec 12). GET returns the current settings with the preset label and every
 * locked field; PATCH merges a partial patch through the engine's lock rules, appends
 * `SettingsChanged` and returns the new view. A locked change is a 409 naming its exact path.
 */
export function mountCampaignSettings(app: Hono<AppEnvironment>, d: Deps) {
  app.get("/api/campaigns/:id/settings", (c) => {
    const game = d.campaign(c.req.param("id"));
    return c.json(settingsView(game.state().campaign.settings));
  });
  app.patch("/api/campaigns/:id/settings", async (c) => {
    const id = c.req.param("id");
    const game = d.campaign(id);
    const patch = await d.body(c, CampaignSettingsPatch);
    const result = changeSettings(game.state(), patch);
    if (!result.ok) {
      const locked = result.errors.find(
        (error) => error.code === "SETTING_LOCKED" || error.code === "SETTING_FORCED",
      );
      if (locked) {
        return c.json({ error: locked.message, path: locked.path ?? "", reason: locked.message }, 409);
      }
      throw new HTTPException(422, {
        message: result.errors.map((error) => error.message).join("; ") || "Please check the settings",
      });
    }
    if (result.value.length) game.append(result.value);
    return c.json(settingsView(game.state().campaign.settings));
  });
}

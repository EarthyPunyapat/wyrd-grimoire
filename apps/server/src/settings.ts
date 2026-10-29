import { CampaignSettings, CampaignSettingsView, type CompiledPack, SettingsUpdate } from "@wyrd/core";
import type { GameState } from "@wyrd/engine";
import { changeSettings, settingsLocks } from "@wyrd/engine";
import type { AppStore, CampaignStore } from "@wyrd/storage";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { AppEnvironment } from "./app.ts";

type Deps = {
  campaign: (id: string) => CampaignStore<GameState>;
  store: AppStore;
  body: <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) => Promise<T>;
};

const CLASS_MODES = (pack: CompiledPack) => pack.manifest.supports.progression.includes("classes");

/** Campaign settings (spec 12): read with lock reasons, write through the engine's lock rules. */
export function settingsView(game: CampaignStore<GameState>, pack: CompiledPack) {
  const state = game.state();
  const classes = CLASS_MODES(pack);
  return CampaignSettingsView.parse({
    settings: state.campaign.settings,
    locks: settingsLocks(state.campaign.settings, { allowClasses: classes }),
    presets: ["story", "standard", "simulation", "custom"],
    classesSupported: classes,
  });
}

export function mountSettings(app: Hono<AppEnvironment>, d: Deps) {
  app.get("/api/campaigns/:id/settings", (c) => {
    const game = d.campaign(c.req.param("id"));
    const pack = game.packSnapshot()!.content as CompiledPack;
    return c.json(settingsView(game, pack));
  });

  app.put("/api/campaigns/:id/settings", async (c) => {
    const id = c.req.param("id");
    const game = d.campaign(id);
    if (d.store.running(id)) throw new HTTPException(409, { message: "A turn is already running" });
    const input = await d.body(c, SettingsUpdate);
    const pack = game.packSnapshot()!.content as CompiledPack;
    const result = changeSettings(game.state(), input.settings, {
      allowClasses: CLASS_MODES(pack),
    });
    if (!result.ok) {
      const locked = result.errors.some((e) => e.code === "SETTING_LOCKED");
      throw new HTTPException(locked ? 409 : 422, {
        message: result.errors.map((e) => e.message).join("; "),
      });
    }
    if (result.value.length) game.append(result.value);
    d.store.touchCampaign(id);
    return c.json(settingsView(game, pack));
  });

  /** The defaults the creation screen offers for a new campaign. */
  app.get("/api/settings/defaults", (c) =>
    c.json(
      CampaignSettingsView.parse({
        settings: CampaignSettings.parse({}),
        locks: [],
        presets: ["story", "standard", "simulation", "custom"],
        classesSupported: true,
      }),
    ),
  );
}

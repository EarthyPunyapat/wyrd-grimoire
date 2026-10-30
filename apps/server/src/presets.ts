import { randomUUID } from "node:crypto";
import { WorldSetup, WorldSetupInput } from "@wyrd/core";
import type { GameState } from "@wyrd/engine";
import type { AppStore, CampaignStore } from "@wyrd/storage";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { AppEnvironment } from "./app.ts";
import { StoredDraft } from "./creation.ts";
import { WORLD_STARTERS } from "./world-starters.ts";

type Deps = {
  store: AppStore;
  campaign: (id: string) => CampaignStore<GameState>;
  body: <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) => Promise<T>;
};
function draftFor(d: Deps, id: string) {
  for (const row of d.store.creationDrafts()) {
    const parsed = StoredDraft.safeParse(row.value);
    if (parsed.success && parsed.data.campaignId === id) return parsed.data;
  }
  return null;
}
function campaignPitch(game: CampaignStore<GameState>): string {
  const facts = game.events().filter((e) => e.type === "FactAsserted");
  for (const e of facts.reverse()) {
    if (
      e.type === "FactAsserted" &&
      e.payload.fact.predicate === "pitch" &&
      typeof e.payload.fact.value === "string"
    )
      return e.payload.fact.value;
  }
  return `Explore the world of ${game.state().campaign.name}.`;
}
const immutable = "Built-in setups can't be changed; duplicate it";
export function mountPresets(app: Hono<AppEnvironment>, d: Deps) {
  app.get("/api/world-setups", (c) => c.json([...WORLD_STARTERS, ...d.store.worldSetups()]));
  app.post("/api/world-setups", async (c) => {
    const input = await d.body(c, WorldSetupInput);
    return c.json(d.store.saveWorldSetup(WorldSetup.parse({ ...input, id: randomUUID() })), 201);
  });
  app.patch("/api/world-setups/:id", async (c) => {
    const id = c.req.param("id");
    if (WORLD_STARTERS.some((s) => s.id === id)) throw new HTTPException(409, { message: immutable });
    const existing = d.store.worldSetups().find((s) => s.id === id);
    if (!existing) throw new HTTPException(404, { message: "World setup not found" });
    const patch = await d.body(c, WorldSetupInput.partial());
    return c.json(d.store.saveWorldSetup(WorldSetup.parse({ ...existing, ...patch })));
  });
  app.delete("/api/world-setups/:id", (c) => {
    const id = c.req.param("id");
    if (WORLD_STARTERS.some((s) => s.id === id)) throw new HTTPException(409, { message: immutable });
    d.store.removeWorldSetup(id);
    return c.json({ ok: true });
  });
  app.post("/api/campaigns/:id/world-setup", (c) => {
    const id = c.req.param("id");
    const game = d.campaign(id);
    const state = game.state();
    const saved = draftFor(d, id);
    const s = state.campaign.settings;
    const pc = state.actors[state.party.pcId ?? ""]?.sheet;
    const source = state.worlds.find((w) => w.source);
    return c.json(
      d.store.saveWorldSetup(
        WorldSetup.parse({
          id: randomUUID(),
          name: state.campaign.name.slice(0, 80),
          pitch: saved?.input.pitch ?? campaignPitch(game),
          source:
            saved?.input.source ??
            (source?.source ? { title: source.source, wiki: source.wiki ?? "en.wikipedia.org" } : undefined),
          rules: { preset: s.preset, storyMode: s.story.mode, ...s.structural },
          review: {
            subsystems: s.subsystems,
            theme: s.theme,
            resolution: s.structural.resolution,
            hardcore: s.structural.hardcore,
            lethality: s.lethality,
            companionDeath: s.companionDeath,
            startingLevel: pc?.level ?? 1,
            style: s.style,
          },
        }),
      ),
      201,
    );
  });
}

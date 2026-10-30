import { randomUUID } from "node:crypto";
import {
  CharacterCard,
  CharacterCardInput,
  type CompiledPack,
  SavedWorldMeta,
  WorldSetup,
  WorldSetupInput,
} from "@wyrd/core";
import type { GameState } from "@wyrd/engine";
import { type AppStore, type CampaignStore, CanonQueries } from "@wyrd/storage";
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
/** A portable snapshot of the current PC and their permanent companions. */
export function cardFromCampaign(game: CampaignStore<GameState>): CharacterCardInput {
  const state = game.state();
  const pc = state.actors[state.party.pcId ?? ""]?.sheet;
  if (!pc) throw new HTTPException(409, { message: "This campaign has no character to copy" });
  const pack = game.packSnapshot()!.content as CompiledPack;
  const canon = new CanonQueries(game);
  return CharacterCardInput.parse({
    title: pc.identity.name.slice(0, 80),
    origin: "campaign",
    pc: {
      name: pc.identity.name,
      level: pc.level,
      backstory: (pc.identity.backstory || campaignPitch(game)).slice(0, 4000),
      abilities: pc.abilities.map((a) => ({ name: a.name, description: a.description, rank: a.rank })),
      gear: pc.equipment.carried
        .filter((i) => i.item.startsWith("player:"))
        .flatMap((i) => {
          const item = pack.items.gear[i.item];
          return item ? [{ name: item.name, description: item.description }] : [];
        }),
    },
    companions: state.party.companionIds
      .filter((id) => state.companions[id]?.loyal)
      .flatMap((id) => {
        const actor = state.actors[id];
        if (!actor) return [];
        return [
          {
            name: actor.sheet.identity.name,
            summary: canon.entity(id)?.summary || actor.sheet.identity.name,
            voice: state.companions[id]?.voiceProfile || "Speaks in their own voice.",
            level: actor.sheet.level,
          },
        ];
      }),
    sheet: {
      pronouns: pc.identity.pronouns,
      attributes: pc.attributes,
      appearance: pc.identity.appearance,
      personality: pc.identity.personality,
      skills: Object.fromEntries(
        Object.entries(pc.skills)
          .filter(([id, v]) => id.startsWith("core:") && v.trained > 0)
          .map(([id, v]) => [id, v.trained]),
      ),
    },
  });
}
const immutable = "Built-in setups can't be changed; duplicate it";
export function mountPresets(app: Hono<AppEnvironment>, d: Deps) {
  app.get("/api/character-cards", (c) => c.json(d.store.characterCards()));
  app.get("/api/character-cards/:id", (c) => {
    const card = d.store.characterCard(c.req.param("id"));
    if (!card) throw new HTTPException(404, { message: "Character card not found" });
    return c.json(card);
  });
  app.post("/api/character-cards", async (c) =>
    c.json(
      d.store.saveCharacterCard(
        CharacterCard.parse({ ...(await d.body(c, CharacterCardInput)), id: randomUUID() }),
      ),
      201,
    ),
  );
  app.patch("/api/character-cards/:id", async (c) => {
    const card = d.store.characterCard(c.req.param("id"));
    if (!card) throw new HTTPException(404, { message: "Character card not found" });
    const patch = await d.body(c, CharacterCardInput.pick({ title: true }).partial().strict());
    return c.json(d.store.saveCharacterCard({ ...card, ...patch }));
  });
  app.delete("/api/character-cards/:id", (c) => {
    d.store.removeCharacterCard(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/campaigns/:id/character-card", (c) =>
    c.json(
      d.store.saveCharacterCard(
        CharacterCard.parse({ ...cardFromCampaign(d.campaign(c.req.param("id"))), id: randomUUID() }),
      ),
      201,
    ),
  );
  app.post("/api/character-cards/:id/update-from/:campaignId", (c) => {
    const card = d.store.characterCard(c.req.param("id"));
    if (!card) throw new HTTPException(404, { message: "Character card not found" });
    const fresh = cardFromCampaign(d.campaign(c.req.param("campaignId")));
    return c.json(
      d.store.saveCharacterCard({ ...card, pc: fresh.pc, companions: fresh.companions, sheet: fresh.sheet }),
    );
  });
  app.post("/api/campaigns/:id/save-world", (c) => {
    const id = c.req.param("id");
    const state = d.campaign(id).state();
    const saved = draftFor(d, id);
    if (!saved) throw new HTTPException(409, { message: "This campaign has no saved world to copy" });
    const { campaignId: _, sheet: __, interview: ___, ...copy } = saved;
    const stored = d.store.saveSavedWorld(
      {
        id: randomUUID(),
        name: state.campaign.name.slice(0, 80),
        worldName: saved.proposal.worldName,
        premise: saved.proposal.premise,
        sourceCampaignId: id,
        updatedAt: "",
      },
      copy,
    );
    return c.json(SavedWorldMeta.parse(stored), 201);
  });
  app.get("/api/worlds", (c) => c.json(d.store.savedWorlds().map((w) => SavedWorldMeta.parse(w))));
  app.delete("/api/worlds/:id", (c) => {
    d.store.removeSavedWorld(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/worlds/:id/draft", (c) => {
    const world = d.store.savedWorld(c.req.param("id"));
    if (!world) throw new HTTPException(404, { message: "Saved world not found" });
    const draftId = randomUUID();
    d.store.saveCreationDraft(draftId, StoredDraft.parse(world.draft));
    return c.json({ draftId }, 201);
  });
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

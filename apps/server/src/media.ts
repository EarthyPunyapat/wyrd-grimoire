import { defaultTuning, draft, type EventDraft, MediaRole, MediaSettings } from "@wyrd/core";
import { campaignWiki, type GameState, mediaOf } from "@wyrd/engine";
import {
  type AssetCache,
  type ImageHit,
  type ImageProvider,
  portraitPrompt,
  resolveImage,
} from "@wyrd/media";
import { type AppStore, type CampaignStore, CanonQueries } from "@wyrd/storage";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

type WikiImages = {
  pageImage(wiki: string, title: string): Promise<Omit<ImageHit, "origin"> | null>;
  search(wiki: string, query: string): Promise<string[]>;
  fetchBytes(url: string): Promise<{ bytes: Uint8Array; mime: string }>;
};
type Target = { id: string; name: string; kind: string; role: MediaRole; summary: string; facts: Fact[] };
type Fact = { predicate: string; value: string };

const PLACES = new Set(["location", "site"]);

/**
 * First Light's background worker (D168). After a turn it looks for entities the PC knows that have no
 * picture yet, a few at a time, one job at a time across the server. Results attach as events, never
 * during a running turn; nothing a turn does ever waits on it.
 */
export class MediaWorker {
  private readonly queue: string[] = [];
  private readonly held = new Map<string, EventDraft[]>();
  private readonly forced = new Map<string, Set<string>>();
  /** Image hosts that refused the honest Wyrd user agent (Fandom's CDN does); never asked again this run. */
  private readonly refused = new Set<string>();
  private loop: Promise<void> = Promise.resolve();

  constructor(
    private readonly d: {
      cache: AssetCache;
      wiki: WikiImages | null;
      provider: () => ImageProvider | null;
      store: AppStore;
      campaign: (id: string) => CampaignStore<GameState>;
      running: (id: string) => boolean;
      settings: () => MediaSettings;
      offline: boolean;
      limit?: number;
      now?: () => number;
      log?: (message: string) => void;
    },
  ) {}

  after(campaignId: string): void {
    if (this.d.offline || this.queue.includes(campaignId)) return;
    this.queue.push(campaignId);
    this.loop = this.loop.then(() => this.drain());
  }

  /** Generate a new picture for one entity, skipping the wiki (the player asked for it). */
  regenerate(campaignId: string, entityId: string, role: MediaRole): void {
    const keys = this.forced.get(campaignId) ?? new Set<string>();
    keys.add(`${role}:${entityId}`);
    this.forced.set(campaignId, keys);
    this.d.store.markMediaAttempt(campaignId, entityId, role, 0);
    this.after(campaignId);
  }

  idle(): Promise<void> {
    return this.loop;
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const id = this.queue.shift()!;
      try {
        this.flush(id);
        await this.pass(id);
        this.flush(id);
      } catch (error) {
        this.d.log?.(`[media] ${id}: ${(error as Error).message}`);
      }
    }
  }

  /** Appends attachments that waited for a turn to end. */
  private flush(campaignId: string): void {
    const drafts = this.held.get(campaignId);
    if (!drafts?.length || this.d.running(campaignId)) return;
    this.held.delete(campaignId);
    this.d.campaign(campaignId).append(drafts);
  }

  private attach(
    campaignId: string,
    entityId: string,
    role: MediaRole,
    asset: ReturnType<AssetCache["put"]>,
  ) {
    const event = draft("AssetAttached", { entityId, role, asset }, "engine");
    this.held.set(campaignId, [...(this.held.get(campaignId) ?? []), event]);
    this.flush(campaignId);
  }

  private async pass(campaignId: string): Promise<void> {
    const game = this.d.campaign(campaignId);
    const state = game.state();
    const settings = this.d.settings();
    const provider = this.d.provider();
    const now = (this.d.now ?? Date.now)();
    const wiki = campaignWiki(state);
    const waiting = new Set(
      (this.held.get(campaignId) ?? []).map((e) => (e.payload as { entityId: string }).entityId),
    );
    const forced = this.forced.get(campaignId) ?? new Set<string>();
    this.forced.delete(campaignId);
    const media = mediaOf(state);
    const due = this.targets(game, state, forced).filter((t) => {
      if (forced.has(`${t.role}:${t.id}`)) return true;
      // An attached picture reaching here has lost its file: fetch it again now.
      if (t.role === "portrait" ? media.portraits[t.id] : media.banners[t.id]) return true;
      if (waiting.has(t.id)) return false;
      const tried = this.d.store.mediaAttempt(campaignId, t.id, t.role);
      return tried === null || now - tried > defaultTuning.media.retryMinutes * 60_000;
    });
    for (const target of due.slice(0, this.d.limit ?? defaultTuning.media.jobsPerTurn)) {
      this.d.store.markMediaAttempt(campaignId, target.id, target.role, now);
      const web = settings.webImages && !forced.has(`${target.role}:${target.id}`) ? this.d.wiki : null;
      if (web) {
        const found = await resolveImage({ entity: target, wiki, wikiClient: web });
        const reachable = (hit: ImageHit) => !this.refused.has(new URL(hit.imageUrl).host);
        if (found.kind === "candidates") {
          const hits = found.hits.filter(reachable);
          if (hits.length) {
            this.d.store.saveMediaCandidates(campaignId, target.id, target.role, hits);
            continue;
          }
        }
        if (found.kind === "confident" && reachable(found.hit)) {
          try {
            const { bytes } = await web.fetchBytes(found.hit.imageUrl);
            const asset = this.d.cache.put(bytes, {
              origin: found.hit.origin,
              pageUrl: found.hit.pageUrl,
              sourceUrl: found.hit.imageUrl,
              ...(found.hit.width ? { width: found.hit.width } : {}),
              ...(found.hit.height ? { height: found.hit.height } : {}),
            });
            this.attach(campaignId, target.id, target.role, asset);
            continue;
          } catch (error) {
            // A host that refuses us (Fandom's CDN does) falls through to generation, and isn't asked again.
            if ((error as Error).message.startsWith("Image source refused"))
              this.refused.add(new URL(found.hit.imageUrl).host);
            this.d.log?.(`[media] ${target.name}: ${(error as Error).message}`);
          }
        }
      }
      if (!provider) continue;
      const main = state.worlds[0];
      const { prompt, negativePrompt } = portraitPrompt(target, target.facts, {
        name: main?.name ?? state.campaign.name,
        tone: main?.source ? `${main.source}` : "atmospheric",
      });
      const place = PLACES.has(target.kind);
      try {
        const out = await provider.generate(
          { mode: "t2i", prompt, negativePrompt, width: place ? 1024 : 768, height: place ? 576 : 1024 },
          AbortSignal.timeout(defaultTuning.media.generateTimeoutMs),
        );
        const asset = this.d.cache.put(out.bytes, {
          origin: "generated",
          prompt,
          ...(out.seed !== undefined ? { seed: out.seed } : {}),
        });
        this.attach(campaignId, target.id, target.role, asset);
      } catch (error) {
        this.d.log?.(`[media] ${target.name}: ${(error as Error).message}`);
      }
    }
  }

  /** Known people and places without a picture: the current place first, then the PC, companions, NPCs. */
  private targets(game: CampaignStore<GameState>, state: GameState, forced = new Set<string>()): Target[] {
    const canon = new CanonQueries(game);
    const media = mediaOf(state);
    const facts = (id: string): Fact[] =>
      canon.factsAbout(id).map((f) => ({ predicate: f.predicate, value: String(f.value) }));
    const out: Target[] = [];
    const add = (t: Target) => {
      const attached = t.role === "portrait" ? media.portraits[t.id] : media.banners[t.id];
      // A picture whose file is gone (a moved or restored server) counts as missing.
      const have = attached && this.d.cache.has(attached.id);
      if ((!have || forced.has(`${t.role}:${t.id}`)) && !out.some((o) => o.id === t.id)) out.push(t);
    };
    const here = state.scene?.locationId;
    const place = here ? canon.entity(here) : null;
    if (place)
      add({
        id: place.id,
        name: place.name,
        kind: place.kind,
        role: "banner",
        summary: place.summary,
        facts: facts(place.id),
      });
    for (const id of [state.party.pcId, ...state.party.companionIds]) {
      const actor = id ? state.actors[id] : undefined;
      if (!actor) continue;
      const looks = actor.sheet.identity.appearance;
      const appearance = [
        looks.build,
        looks.hair,
        looks.eyes,
        looks.skin,
        ...looks.marks,
        looks.clothingStyle,
      ]
        .filter((v): v is string => Boolean(v))
        .map((value) => ({ predicate: "appearance", value }));
      add({
        id: actor.sheet.id,
        name: actor.sheet.identity.name,
        kind: id === state.party.pcId ? "pc" : "companion",
        role: "portrait",
        summary: actor.sheet.identity.background,
        facts: [...appearance, ...facts(actor.sheet.id)],
      });
    }
    for (const id of Object.keys(state.knowledge.entities)) {
      const e = canon.entity(id);
      if (!e) continue;
      if (e.kind === "npc")
        add({ id, name: e.name, kind: "npc", role: "portrait", summary: e.summary, facts: facts(id) });
      else if (PLACES.has(e.kind))
        add({ id, name: e.name, kind: e.kind, role: "banner", summary: e.summary, facts: facts(id) });
    }
    return out;
  }
}

/** The URL the browser loads an asset from; bytes are served behind the passcode. */
export const mediaUrl = (asset: { id: string }) => `/api/media/${asset.id}`;

/** Who the browser may see pictures of: the party, the current place and entities the PC knows. */
export function visibleIds(state: GameState): Set<string> {
  return new Set(
    [
      state.party.pcId,
      ...state.party.companionIds,
      state.scene?.locationId,
      ...Object.keys(state.knowledge.entities),
    ].filter((id): id is string => Boolean(id)),
  );
}

export function viewMedia(
  state: GameState,
  stored: (assetId: string) => boolean = () => true,
): { portraits: Record<string, string>; banners: Record<string, string> } {
  const media = mediaOf(state);
  const seen = visibleIds(state);
  const urls = (from: Record<string, { id: string }>) =>
    Object.fromEntries(
      Object.entries(from).flatMap(([id, a]) => (seen.has(id) && stored(a.id) ? [[id, mediaUrl(a)]] : [])),
    );
  return { portraits: urls(media.portraits), banners: urls(media.banners) };
}

const Choose = z.object({ role: MediaRole, index: z.number().int().min(0) });
const Regenerate = z.object({ role: MediaRole });
const SettingsInput = MediaSettings.omit({ workflowsDir: true })
  .partial()
  .extend({ workflowsDir: z.string().min(1).optional() });

/** Image bytes, candidates, regeneration and Settings → Media (all behind the passcode middleware). */
export function mountMedia(
  // biome-ignore lint/suspicious/noExplicitAny: the app's Hono environment type lives in app.ts
  app: Hono<any>,
  d: {
    worker: MediaWorker;
    cache: AssetCache;
    store: AppStore;
    wiki: WikiImages | null;
    campaign: (id: string) => CampaignStore<GameState>;
    running: (id: string) => boolean;
    provider: () => ImageProvider | null;
    settings: () => MediaSettings;
    body: <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) => Promise<T>;
  },
) {
  app.get("/api/media/:assetId", async (c) => {
    const found = d.cache.find(c.req.param("assetId"));
    if (!found) throw new HTTPException(404, { message: "Image not found" });
    return new Response(Bun.file(found.path), {
      headers: { "Content-Type": found.mime, "Cache-Control": "private, max-age=31536000, immutable" },
    });
  });
  app.get("/api/campaigns/:id/media/candidates", (c) => {
    const id = c.req.param("id");
    const game = d.campaign(id);
    const seen = visibleIds(game.state());
    const canon = new CanonQueries(game);
    return c.json(
      d.store
        .mediaCandidates(id)
        .filter((row) => seen.has(row.entityId))
        .map((row) => ({ ...row, name: canon.entity(row.entityId)?.name ?? row.entityId })),
    );
  });
  app.post("/api/campaigns/:id/media/:entityId/choose", async (c) => {
    const id = c.req.param("id");
    const entityId = c.req.param("entityId");
    const input = await d.body(c, Choose);
    const game = d.campaign(id);
    if (!visibleIds(game.state()).has(entityId))
      throw new HTTPException(404, { message: "Unknown character or place" });
    const row = d.store.mediaCandidates(id).find((r) => r.entityId === entityId && r.role === input.role);
    const hit = row?.hits[input.index] as ImageHit | undefined;
    if (!hit) throw new HTTPException(404, { message: "That picture is no longer offered" });
    if (!d.wiki) throw new HTTPException(422, { message: "Web images are off" });
    if (d.running(id)) throw new HTTPException(409, { message: "Wait for the current turn to finish" });
    let asset: ReturnType<AssetCache["put"]>;
    try {
      const { bytes } = await d.wiki.fetchBytes(hit.imageUrl);
      asset = d.cache.put(bytes, { origin: hit.origin, pageUrl: hit.pageUrl, sourceUrl: hit.imageUrl });
    } catch (error) {
      throw new HTTPException(502, {
        message: `That picture could not be fetched: ${(error as Error).message}`,
      });
    }
    // The download can take seconds; a turn that started meanwhile must not get an event in its middle.
    if (d.running(id)) throw new HTTPException(409, { message: "Wait for the current turn to finish" });
    game.append([draft("AssetAttached", { entityId, role: input.role, asset }, "player")]);
    d.store.clearMediaCandidates(id, entityId, input.role);
    return c.json({ url: mediaUrl(asset) });
  });
  app.post("/api/campaigns/:id/media/:entityId/regenerate", async (c) => {
    const id = c.req.param("id");
    const entityId = c.req.param("entityId");
    const input = await d.body(c, Regenerate);
    if (!visibleIds(d.campaign(id).state()).has(entityId))
      throw new HTTPException(404, { message: "Unknown character or place" });
    if (!d.provider())
      throw new HTTPException(422, { message: "Set up ComfyUI in Settings → Media to generate pictures" });
    d.worker.regenerate(id, entityId, input.role);
    return c.json({ queued: true }, 202);
  });
  app.get("/api/settings/media", (c) => c.json(d.settings()));
  app.put("/api/settings/media", async (c) => {
    const input = await d.body(c, SettingsInput);
    const next = MediaSettings.parse({ ...d.settings(), ...input });
    d.store.saveMediaSettings({
      webImages: next.webImages,
      comfyUrl: next.comfyUrl,
      workflowsDir: next.workflowsDir,
    });
    return c.json(next);
  });
  app.post("/api/settings/media/test", async (c) => {
    const provider = d.provider();
    if (!provider) throw new HTTPException(422, { message: "Add your ComfyUI address first" });
    try {
      const out = await provider.generate(
        { mode: "t2i", prompt: "a lantern on a wooden table, painterly", width: 512, height: 512 },
        AbortSignal.timeout(defaultTuning.media.generateTimeoutMs),
      );
      const asset = d.cache.put(out.bytes, { origin: "generated", prompt: "settings test" });
      return c.json({ url: mediaUrl(asset) });
    } catch (error) {
      throw new HTTPException(422, { message: `ComfyUI test failed: ${(error as Error).message}` });
    }
  });
}

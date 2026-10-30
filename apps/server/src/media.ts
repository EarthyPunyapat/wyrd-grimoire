import { defaultTuning, draft, type EventDraft, type MediaRole, type MediaSettings } from "@wyrd/core";
import { campaignWiki, type GameState, mediaOf } from "@wyrd/engine";
import {
  type AssetCache,
  type ImageHit,
  type ImageProvider,
  portraitPrompt,
  resolveImage,
} from "@wyrd/media";
import { type AppStore, type CampaignStore, CanonQueries } from "@wyrd/storage";

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
    const due = this.targets(game, state).filter((t) => {
      if (waiting.has(t.id)) return false;
      const tried = this.d.store.mediaAttempt(campaignId, t.id, t.role);
      return tried === null || now - tried > defaultTuning.media.retryMinutes * 60_000;
    });
    for (const target of due.slice(0, this.d.limit ?? defaultTuning.media.jobsPerTurn)) {
      this.d.store.markMediaAttempt(campaignId, target.id, target.role, now);
      const web = settings.webImages ? this.d.wiki : null;
      if (web) {
        const found = await resolveImage({ entity: target, wiki, wikiClient: web });
        if (found.kind === "candidates") {
          this.d.store.saveMediaCandidates(campaignId, target.id, target.role, found.hits);
          continue;
        }
        if (found.kind === "confident") {
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
            // A host that refuses us (Fandom's CDN does) falls through to generation.
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
  private targets(game: CampaignStore<GameState>, state: GameState): Target[] {
    const canon = new CanonQueries(game);
    const media = mediaOf(state);
    const facts = (id: string): Fact[] =>
      canon.factsAbout(id).map((f) => ({ predicate: f.predicate, value: String(f.value) }));
    const out: Target[] = [];
    const add = (t: Target) => {
      const have = t.role === "portrait" ? media.portraits[t.id] : media.banners[t.id];
      if (!have && !out.some((o) => o.id === t.id)) out.push(t);
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

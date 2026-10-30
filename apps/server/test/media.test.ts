import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultTuning, draft, Entity, Fact, MAIN_WORLD, SceneState } from "@wyrd/core";
import {
  buildSheet,
  createActor,
  createCampaign,
  type GameState,
  mediaOf,
  reduce,
  unwrap,
} from "@wyrd/engine";
import { AssetCache, type ImageProvider } from "@wyrd/media";
import { AppStore, CampaignStore } from "@wyrd/storage";
import { PNG } from "../../../packages/media/test/fixtures.ts";
import { MediaWorker } from "../src/media.ts";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

/** Wren in the Bowery: Batman and Old Magda known, the alley as the scene; optionally a DC source wiki. */
function world(wiki?: string) {
  const home = mkdtempSync(join(tmpdir(), "wyrd-media-worker-"));
  homes.push(home);
  const created = unwrap(createCampaign({ name: "Gotham", packIds: ["fantasy-core"], seed: 3 }));
  const game = CampaignStore.create<GameState>(join(home, "c1.db"), created, { reduce });
  const sheet = buildSheet(
    {
      id: "pc",
      identity: { name: "Wren", ancestry: "fantasy-core:human", appearance: { hair: "short black hair" } },
      attributes: { str: 5, agi: 5, end: 5, int: 5, awa: 5, wil: 5, pre: 5 },
      skills: {},
    },
    game.state().campaign.settings,
    defaultTuning,
  );
  game.append(unwrap(createActor(game.state(), sheet, "pc")));
  const entity = (id: string, kind: string, name: string) =>
    draft("EntityCreated", {
      entity: Entity.parse({ id, kind, name, detail: "sketch", summary: `${name} of Gotham.` }),
    });
  const knows = (entityId: string) =>
    draft("KnowledgeGained", { entityId, entry: { how: "witnessed", gameTime: 0 } });
  game.append([
    entity("npc:bat", "npc", "Batman"),
    entity("npc:magda", "npc", "Old Magda"),
    entity("loc:alley", "location", "Wet Alleys"),
    entity("npc:stranger", "npc", "The Stranger"),
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "f:magda-hair",
        entityId: "npc:magda",
        predicate: "appearance.hair",
        value: "white braids",
        source: "pack",
      }),
    }),
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: "scene-1",
        locationId: "loc:alley",
        zones: [{ id: "z:1", name: "the alley" }],
        positions: { pc: "z:1" },
        openedAt: 0,
      }),
    }),
    knows("npc:bat"),
    knows("npc:magda"),
    knows("loc:alley"),
    ...(wiki ? [draft("CanonSourceSet", { worldId: MAIN_WORLD, source: "DC", wiki })] : []),
  ]);
  return { home, game };
}

function fakeWiki(pages: Record<string, boolean>) {
  const calls: string[] = [];
  let gate: Promise<void> = Promise.resolve();
  return {
    calls,
    hold() {
      let release!: () => void;
      gate = new Promise((r) => {
        release = r;
      });
      return release;
    },
    client: {
      pageImage: async (_wiki: string, title: string) => {
        calls.push(`page ${title}`);
        await gate;
        return pages[title] === undefined
          ? null
          : pages[title]
            ? {
                title,
                pageUrl: `https://dc.fandom.com/wiki/${title}`,
                imageUrl: `https://img.example/${title}.png`,
              }
            : null;
      },
      search: async () => [] as string[],
      fetchBytes: async (url: string) => {
        calls.push(`bytes ${url}`);
        return { bytes: PNG, mime: "image/png" };
      },
    },
  };
}

function worker(o: {
  home: string;
  game: CampaignStore<GameState>;
  wiki: ReturnType<typeof fakeWiki>;
  provider?: ImageProvider | null;
  offline?: boolean;
  running?: { value: boolean };
  limit?: number;
  now?: () => number;
}) {
  const store = new AppStore(join(o.home, "app.db"));
  return new MediaWorker({
    cache: new AssetCache(join(o.home, "media-cache")),
    wiki: o.wiki.client,
    provider: () => o.provider ?? null,
    store,
    campaign: () => o.game,
    running: () => o.running?.value ?? false,
    settings: () => ({ webImages: true, workflowsDir: join(o.home, "media", "workflows") }),
    offline: o.offline ?? false,
    ...(o.limit ? { limit: o.limit } : {}),
    ...(o.now ? { now: o.now } : {}),
  });
}

const generated: ImageProvider = {
  id: "comfyui",
  generate: async (req) => ({ bytes: PNG, mime: "image/png", seed: 7, meta: { prompt: req.prompt } }),
};

describe("the media worker", () => {
  test("a known canon character in a source campaign gets their wiki portrait", async () => {
    const { home, game } = world("dc.fandom.com");
    const w = worker({ home, game, wiki: fakeWiki({ Batman: true }), limit: 10 });
    w.after("c1");
    await w.idle();
    const bat = mediaOf(game.state()).portraits["npc:bat"];
    expect(bat?.origin).toBe("wiki");
    expect(bat?.pageUrl).toBe("https://dc.fandom.com/wiki/Batman");
    // Unknown to the PC: never looked up.
    expect(mediaOf(game.state()).portraits["npc:stranger"]).toBeUndefined();
  });

  test("an original character is generated when ComfyUI is set up, and left as a placeholder otherwise", async () => {
    const a = world();
    const without = worker({ ...a, wiki: fakeWiki({}), limit: 10 });
    without.after("c1");
    await without.idle();
    expect(mediaOf(a.game.state()).portraits["npc:magda"]).toBeUndefined();

    const b = world();
    const wiki = fakeWiki({});
    const withComfy = worker({ ...b, wiki, provider: generated, limit: 10 });
    withComfy.after("c1");
    await withComfy.idle();
    const magda = mediaOf(b.game.state()).portraits["npc:magda"];
    expect(magda?.origin).toBe("generated");
    expect(magda?.prompt).toContain("white braids");
    // People in an original world never touch Wikipedia.
    expect(wiki.calls.some((c) => c.includes("Old Magda"))).toBe(false);
  });

  test("a page without an image is tried once and not again inside the retry window", async () => {
    const { home, game } = world("dc.fandom.com");
    const wiki = fakeWiki({ Batman: false });
    let clock = 0;
    const w = worker({ home, game, wiki, limit: 10, now: () => clock });
    w.after("c1");
    await w.idle();
    const first = wiki.calls.filter((c) => c === "page Batman").length;
    w.after("c1");
    await w.idle();
    expect(wiki.calls.filter((c) => c === "page Batman").length).toBe(first);
    clock += defaultTuning.media.retryMinutes * 60_000 + 1;
    w.after("c1");
    await w.idle();
    expect(wiki.calls.filter((c) => c === "page Batman").length).toBeGreaterThan(first);
  });

  test("a result that arrives during a turn waits for the turn to end", async () => {
    const { home, game } = world("dc.fandom.com");
    const running = { value: true };
    const w = worker({ home, game, wiki: fakeWiki({ Batman: true }), running, limit: 10 });
    w.after("c1");
    await w.idle();
    expect(mediaOf(game.state()).portraits["npc:bat"]).toBeUndefined();
    running.value = false;
    w.after("c1");
    await w.idle();
    expect(mediaOf(game.state()).portraits["npc:bat"]?.origin).toBe("wiki");
  });

  test("offline makes no calls at all", async () => {
    const { home, game } = world("dc.fandom.com");
    const wiki = fakeWiki({ Batman: true });
    const w = worker({ home, game, wiki, offline: true, provider: generated });
    w.after("c1");
    await w.idle();
    expect(wiki.calls).toEqual([]);
    expect(mediaOf(game.state()).portraits).toEqual({});
  });

  test("asking for pictures never waits for them", async () => {
    const { home, game } = world("dc.fandom.com");
    const wiki = fakeWiki({ Batman: true });
    const release = wiki.hold();
    const w = worker({ home, game, wiki, limit: 10 });
    const started = performance.now();
    w.after("c1");
    expect(performance.now() - started).toBeLessThan(50);
    expect(mediaOf(game.state()).portraits["npc:bat"]).toBeUndefined();
    release();
    await w.idle();
    expect(mediaOf(game.state()).portraits["npc:bat"]).toBeDefined();
  });
});

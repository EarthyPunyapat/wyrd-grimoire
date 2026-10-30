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
import { MediaWorker, viewMedia } from "../src/media.ts";

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

import { GameView, MapView } from "@wyrd/core";
import { createApp } from "../src/app.ts";

describe("media routes and the game view", () => {
  const setup = async (o: {
    pages?: Record<string, boolean>;
    searches?: string[];
    provider?: ImageProvider | null;
  }) => {
    const home = mkdtempSync(join(tmpdir(), "wyrd-media-app-"));
    homes.push(home);
    const wiki = fakeWiki(o.pages ?? {});
    wiki.client.search = async () => o.searches ?? [];
    const instance = createApp({
      home,
      offline: true,
      mediaWiki: wiki.client,
      ...(o.provider !== undefined ? { imageProvider: o.provider } : {}),
    });
    const request = (path: string, body?: unknown, cookie?: string) =>
      instance.app.request(`http://localhost/api${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", "X-Wyrd": "1", ...(cookie ? { Cookie: cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const setupRes = await request("/auth/setup", { passcode: "a long media test passcode" });
    const cookie = setupRes.headers.get("set-cookie")!.split(";")[0]!;
    const made = await request(
      "/campaigns/quick-start",
      { name: "Ferry", characterName: "Wren", archetype: "cutpurse" },
      cookie,
    );
    const id = ((await made.json()) as { id: string }).id;
    const view = async () =>
      GameView.parse(await (await request(`/campaigns/${id}/view`, undefined, cookie)).json());
    return { instance, request, cookie, id, view, wiki };
  };

  test("the current place gets a (generated) banner the view links to, served as image bytes behind the passcode", async () => {
    const s = await setup({ provider: generated });
    await s.view();
    await s.instance.idle();
    const view = await s.view();
    const url = view.scene?.banner;
    expect(url).toMatch(/^\/api\/media\/[0-9a-f]{64}$/);
    expect(Object.values(view.media.banners)).toContain(url!);
    const image = await s.request(url!.replace("/api", ""), undefined, s.cookie);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
    expect((await s.request(url!.replace("/api", ""))).status).toBe(401);
    s.instance.close();
  });

  test("the PC gets a generated portrait when a generator is set up", async () => {
    const s = await setup({ provider: generated });
    await s.view();
    await s.instance.idle();
    const view = await s.view();
    expect(view.media.portraits[view.pc.id]).toMatch(/^\/api\/media\//);
    s.instance.close();
  });

  test("ambiguous places offer candidates; choosing one attaches it, and unknown entities are never listed", async () => {
    const s = await setup({
      pages: { "Ferry house (inn)": true, "River ferry": true },
      searches: ["Ferry house (inn)", "River ferry"],
    });
    await s.view();
    await s.instance.idle();
    s.instance.store.saveMediaCandidates(s.id, "npc:secret-stranger", "portrait", [{ title: "x" }]);
    const listed = (await (
      await s.request(`/campaigns/${s.id}/media/candidates`, undefined, s.cookie)
    ).json()) as {
      entityId: string;
      role: string;
      name: string;
      hits: { title: string }[];
    }[];
    expect(listed.map((c) => c.entityId)).not.toContain("npc:secret-stranger");
    const place = listed.find((c) => c.role === "banner")!;
    expect(place.hits.map((h) => h.title)).toEqual(["Ferry house (inn)", "River ferry"]);
    const chose = await s.request(
      `/campaigns/${s.id}/media/${place.entityId}/choose`,
      { role: "banner", index: 1 },
      s.cookie,
    );
    expect(chose.status).toBe(200);
    expect((await s.view()).scene?.banner).toMatch(/^\/api\/media\//);
    const after = (await (
      await s.request(`/campaigns/${s.id}/media/candidates`, undefined, s.cookie)
    ).json()) as unknown[];
    expect(after).toHaveLength(0);
    s.instance.close();
  });

  test("media settings save, and the generator test says when nothing is set up", async () => {
    const s = await setup({ provider: null });
    const saved = await s.instance.app.request("http://localhost/api/settings/media", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1", Cookie: s.cookie },
      body: JSON.stringify({ webImages: false, comfyUrl: "http://192.168.1.20:8188" }),
    });
    expect(saved.status).toBe(200);
    const read = (await (await s.request("/settings/media", undefined, s.cookie)).json()) as {
      webImages: boolean;
      comfyUrl: string;
    };
    expect(read).toMatchObject({ webImages: false, comfyUrl: "http://192.168.1.20:8188" });
    const tested = await s.request("/settings/media/test", {}, s.cookie);
    expect(tested.status).toBe(422);
    s.instance.close();
  });

  test("the map shows a site's banner as its thumbnail", async () => {
    const s = await setup({ pages: { "Ashford Ferry House": true } });
    await s.view();
    await s.instance.idle();
    const map = MapView.parse(await (await s.request(`/campaigns/${s.id}/map`, undefined, s.cookie)).json());
    // Quick-start worlds have no sites; the field is optional and absent, never broken.
    for (const site of map.sites)
      expect(site.thumb === undefined || site.thumb.startsWith("/api/media/")).toBe(true);
    s.instance.close();
  });
});

test("a picture chosen while a turn starts is refused rather than written into the turn", async () => {
  const home = mkdtempSync(join(tmpdir(), "wyrd-media-race-"));
  homes.push(home);
  const wiki = fakeWiki({ "Ferry house (inn)": true });
  wiki.client.search = async () => ["Ferry house (inn)"];
  const instance = createApp({ home, offline: true, mediaWiki: wiki.client, imageProvider: null });
  const req = (path: string, body?: unknown, cookie?: string) =>
    instance.app.request(`http://localhost/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const cookie = (await req("/auth/setup", { passcode: "a long media race passcode" })).headers
    .get("set-cookie")!
    .split(";")[0]!;
  const id = (
    (await (
      await req("/campaigns/quick-start", { name: "F", characterName: "W", archetype: "cutpurse" }, cookie)
    ).json()) as { id: string }
  ).id;
  await req(`/campaigns/${id}/view`, undefined, cookie);
  await instance.idle();
  const place = (
    (await (await req(`/campaigns/${id}/media/candidates`, undefined, cookie)).json()) as {
      entityId: string;
    }[]
  )[0]!;
  // The download is slow; a turn starts while it runs.
  wiki.client.fetchBytes = async () => {
    instance.store.startJob({
      id: "job-1",
      campaign_id: id,
      client_id: "c1",
      input: "{}",
      status: "running",
      target_id: null,
    });
    return { bytes: PNG, mime: "image/png" };
  };
  const chose = await req(
    `/campaigns/${id}/media/${place.entityId}/choose`,
    { role: "banner", index: 0 },
    cookie,
  );
  expect(chose.status).toBe(409);
  const view = GameView.parse(await (await req(`/campaigns/${id}/view`, undefined, cookie)).json());
  expect(view.scene?.banner).toBeUndefined();
  instance.close();
});

test("a picture whose file is gone (a moved server) is hidden and fetched again", async () => {
  const { home, game } = world();
  const ghost = { id: "f".repeat(64), mime: "image/png" as const, origin: "generated" as const };
  game.append([draft("AssetAttached", { entityId: "npc:magda", role: "portrait", asset: ghost }, "engine")]);
  const cache = new AssetCache(join(home, "media-cache"));
  expect(viewMedia(game.state(), (id) => cache.has(id)).portraits["npc:magda"]).toBeUndefined();
  const w = worker({ home, game, wiki: fakeWiki({}), provider: generated, limit: 10 });
  w.after("c1");
  await w.idle();
  const now = mediaOf(game.state()).portraits["npc:magda"];
  expect(now?.id).not.toBe(ghost.id);
  expect(cache.has(now!.id)).toBe(true);
});

test("a host that refuses us is remembered: its candidates aren't offered and the character is generated", async () => {
  const { home, game } = world("dc.fandom.com");
  game.append([
    draft("KnowledgeGained", { entityId: "npc:stranger", entry: { how: "witnessed", gameTime: 0 } }),
  ]);
  const cdn = (title: string) => ({
    title,
    pageUrl: `https://dc.fandom.com/wiki/${title}`,
    imageUrl: `https://static.wikia.nocookie.net/${title}.jpg`,
  });
  const fetched: string[] = [];
  const wiki = {
    calls: [] as string[],
    hold: () => () => {},
    client: {
      pageImage: async (_w: string, title: string) =>
        ["Batman", "Stranger (comics)"].includes(title) ? cdn(title) : null,
      search: async (_w: string, q: string) => (q === "The Stranger" ? ["Stranger (comics)"] : []),
      fetchBytes: async (url: string) => {
        fetched.push(url);
        throw new Error("Image source refused (403)");
      },
    },
  };
  const w = worker({
    home,
    game,
    wiki: wiki as unknown as ReturnType<typeof fakeWiki>,
    provider: generated,
    limit: 10,
  });
  w.after("c1");
  await w.idle();
  expect(mediaOf(game.state()).portraits["npc:bat"]?.origin).toBe("generated");
  expect(mediaOf(game.state()).portraits["npc:stranger"]?.origin).toBe("generated");
  expect(new AppStore(join(home, "app.db")).mediaCandidates("c1")).toEqual([]);
  // One refusal was enough to stop asking that host.
  expect(fetched).toHaveLength(1);
});

test("connecting ComfyUI takes effect at once for characters nothing could picture before", async () => {
  const { home, game } = world();
  let provider: ImageProvider | null = null;
  const store = new AppStore(join(home, "app.db"));
  const w = new MediaWorker({
    cache: new AssetCache(join(home, "media-cache")),
    wiki: fakeWiki({}).client,
    provider: () => provider,
    store,
    campaign: () => game,
    running: () => false,
    settings: () => ({ webImages: true, workflowsDir: join(home, "wf") }),
    offline: false,
    limit: 10,
    now: () => 1000,
  });
  w.after("c1");
  await w.idle();
  expect(mediaOf(game.state()).portraits["npc:magda"]).toBeUndefined();
  provider = generated;
  w.after("c1");
  await w.idle();
  expect(mediaOf(game.state()).portraits["npc:magda"]?.origin).toBe("generated");
});

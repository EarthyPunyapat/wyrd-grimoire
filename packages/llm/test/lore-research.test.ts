import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoreCache } from "../../storage/src/lore-cache.ts";
import { FakeProvider } from "../src/fake.ts";
import { MediaWikiClient, RequestLimiter } from "../src/lore/mediawiki.ts";
import { LoreResearch } from "../src/lore/research.ts";
import { summarise } from "../src/lore/summarise.ts";
import { RoleRouter } from "../src/router.ts";
import wikipedia from "./fixtures/lore/wikipedia.json";

const page = Object.values(wikipedia.query.pages)[0]!;
const original = page.extract;
const summary = "Marsh lights can lure travellers off safe paths.";
export function loreRouter(facts: string[] = [summary]) {
  const fake = new FakeProvider([
    { role: "worldGen", reply: { toolCall: { name: "propose_lore", args: { facts } } } },
  ]);
  const router = new RoleRouter({
    providers: { fake },
    routing: { worldGen: { provider: "fake", model: "test", fallbacks: [] } },
  });
  return { fake, router };
}

test("worldGen summaries carry code-owned provenance", async () => {
  const { fake, router } = loreRouter();
  const result = await summarise(router, {
    title: page.title,
    text: original,
    url: "https://en.wikipedia.org/wiki/Will-o'-the-wisp",
  });
  expect(result.facts).toEqual([summary]);
  expect(result.source).toBe("lore");
  expect(result.evidence?.quote).toContain("https://en.wikipedia.org/wiki/");
  expect(result.confidence).toBe("high");
  expect(fake.calls("worldGen")[0]!.instructions).toContain("untrusted");
});

test("26-word passages cannot enter summaries, even with punctuation/case changes", async () => {
  const copied = original.split(" ").slice(0, 26).join(" ");
  for (const text of [original, copied.toUpperCase().replaceAll(" ", ", ")]) {
    const { router } = loreRouter([text]);
    await expect(
      summarise(router, { title: "Light", text: original, url: "https://en.wikipedia.org/wiki/Light" }),
    ).rejects.toThrow();
  }
  // Nor may a passage be split across several proposed facts.
  const { router } = loreRouter([
    original.split(" ").slice(0, 18).join(" "),
    original.split(" ").slice(18).join(" "),
  ]);
  await expect(
    summarise(router, { title: "Light", text: original, url: "https://en.wikipedia.org/wiki/Light" }),
  ).rejects.toThrow();
});

test("cache hit across service instances needs neither HTTP nor another model call", async () => {
  const home = mkdtempSync(join(tmpdir(), "wyrd-lore-service-"));
  try {
    const { fake, router } = loreRouter();
    let requests = 0;
    const client = new MediaWikiClient({
      limiter: new RequestLimiter(),
      fetch: async () => {
        requests++;
        return Response.json(wikipedia);
      },
    });
    const service = new LoreResearch({ client, cache: new LoreCache(home), router });
    const first = await service.lookup("en.wikipedia.org", page.title);
    expect(first.confidence).toBe("high");
    expect(first.facts).toEqual([summary]);
    const second = new LoreResearch({ client, cache: new LoreCache(home), router });
    expect(await second.lookup("en.wikipedia.org", page.title)).toEqual(first);
    expect(requests).toBe(1);
    expect(fake.calls("worldGen")).toHaveLength(1);
    expect(new LoreCache(home).get("en.wikipedia.org", page.title)?.text).not.toContain(original);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("missing page searches, then falls back to low-confidence model knowledge", async () => {
  const home = mkdtempSync(join(tmpdir(), "wyrd-lore-fallback-"));
  try {
    const { fake, router } = loreRouter();
    let requests = 0;
    const client = new MediaWikiClient({
      limiter: new RequestLimiter({ now: () => 0, sleep: async () => {} }),
      fetch: async () => {
        requests++;
        return Response.json({ query: { pages: { "-1": { missing: "" } }, search: [] } });
      },
    });
    const service = new LoreResearch({ client, cache: new LoreCache(home), router });
    const result = await service.lookup("dc.fandom.com", "Light");
    expect(result.confidence).toBe("low");
    expect(result.evidence).toBeUndefined();
    expect(requests).toBe(2);
    expect(fake.calls("worldGen")[0]!.messages[0]!.content).toContain("model knowledge");
    expect(new LoreCache(home).get("dc.fandom.com", "Light")).toBeNull();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("HTTP and model errors are sanitized, never copied into tool-facing output", async () => {
  const { router } = loreRouter();
  const result = await new LoreResearch({
    router,
    client: {
      fetchPage: async () => {
        throw new Error("Bearer secret-token");
      },
      search: async () => [],
    },
    cache: { get: () => null, put: () => {} },
  }).lookup("dc.fandom.com", "Light");
  expect(JSON.stringify(result)).not.toContain("secret-token");
  expect(result.confidence).toBe("low");
  const broken = new RoleRouter({ providers: {}, routing: {} });
  await expect(
    new LoreResearch({
      router: broken,
      cache: { get: () => null, put: () => {} },
      client: { fetchPage: async () => null, search: async () => [] },
    }).lookup("dc.fandom.com", "Light"),
  ).rejects.toThrow("Lore research unavailable");
});

test("failed paraphrasing cannot smuggle the source passage through model fallback", async () => {
  const { router } = loreRouter([original]);
  const cache = {
    get: () => null,
    put: () => {
      throw new Error("Copied text must never be cached");
    },
  };
  const client = {
    fetchPage: async () => ({
      title: page.title,
      url: "https://en.wikipedia.org/wiki/Light",
      text: original,
    }),
    search: async () => [],
  };
  await expect(
    new LoreResearch({ router, cache, client }).lookup("en.wikipedia.org", "Light"),
  ).rejects.toThrow("Lore research unavailable");
});

test("a search result is fetched once and cached under query and canonical title", async () => {
  const home = mkdtempSync(join(tmpdir(), "wyrd-lore-search-"));
  try {
    const { router } = loreRouter();
    const calls: string[] = [];
    const client = {
      fetchPage: async (_wiki: string, title: string) => {
        calls.push(`page:${title}`);
        return title === "Marsh light"
          ? { title, text: original, url: "https://dc.fandom.com/wiki/Marsh_light" }
          : null;
      },
      search: async (_wiki: string, query: string) => {
        calls.push(`search:${query}`);
        return ["Marsh light"];
      },
    };
    const service = new LoreResearch({ router, client, cache: new LoreCache(home) });
    const [a, b] = await Promise.all([
      service.lookup("dc.fandom.com", "wandering light"),
      service.lookup("dc.fandom.com", "wandering light"),
    ]);
    expect(a).toEqual(b);
    expect(calls).toEqual(["page:wandering light", "search:wandering light", "page:Marsh light"]);
    expect(await service.lookup("dc.fandom.com", "Marsh light")).toEqual(a);
    expect(calls).toHaveLength(3);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

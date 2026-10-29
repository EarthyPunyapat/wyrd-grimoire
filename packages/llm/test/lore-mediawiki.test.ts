import { expect, test } from "bun:test";
import { MediaWikiClient, RequestLimiter, wikiHost } from "../src/lore/mediawiki.ts";
import fandom from "./fixtures/lore/fandom.json";
import results from "./fixtures/lore/search.json";
import wikipedia from "./fixtures/lore/wikipedia.json";

const clock = () => {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
};
function fixture(body: unknown) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const client = new MediaWikiClient({
    fetch: async (url, init) => {
      calls.push({ url: new URL(String(url)), init });
      return Response.json(body);
    },
    limiter: new RequestLimiter(clock()),
  });
  return { client, calls };
}

test("recorded Wikipedia extract and search use official API and user agent", async () => {
  const f = fixture(wikipedia);
  const page = await f.client.fetchPage("en.wikipedia.org", "Will-o'-the-wisp");
  expect(page?.text).toContain("wandering light");
  expect(page?.url).toBe("https://en.wikipedia.org/wiki/Will-o'-the-wisp");
  const c = f.calls[0]!;
  expect(c.url.pathname).toBe("/w/api.php");
  expect(c.url.searchParams.get("prop")).toBe("extracts");
  expect(c.url.searchParams.has("explaintext")).toBe(true);
  expect(new Headers(c.init?.headers).get("user-agent")).toBe(
    "WyrdGrimoire/0.1.0 (personal, non-commercial)",
  );
  const s = fixture(results);
  expect(await s.client.search("en.wikipedia.org", "marsh light")).toEqual(["Will-o'-the-wisp"]);
  expect(s.calls[0]!.url.searchParams.get("list")).toBe("search");
  expect(s.calls[0]!.url.searchParams.get("srsearch")).toBe("marsh light");
});

test("Fandom parse wikitext becomes plain text", async () => {
  const f = fixture(fandom);
  const page = await f.client.fetchPage("dc.fandom.com", "Marsh light");
  expect(page?.text).toContain("The light follows wet ground at dusk.");
  expect(page?.text).not.toMatch(/Infobox|Category|hidden|Source text|\[|\{|<ref/);
  expect(f.calls[0]!.url.pathname).toBe("/api.php");
  expect(f.calls[0]!.url.searchParams.get("action")).toBe("parse");
  expect(f.calls[0]!.url.searchParams.get("prop")).toBe("wikitext");
});

test("missing pages and API failures reveal no upstream details", async () => {
  expect(
    await fixture({ query: { pages: { "-1": { title: "Missing", missing: "" } } } }).client.fetchPage(
      "en.wikipedia.org",
      "Missing",
    ),
  ).toBeNull();
  const f = fixture({ error: { info: "secret upstream data" } });
  await expect(f.client.fetchPage("dc.fandom.com", "Missing")).rejects.toThrow("Lore source unavailable");
});

test("wiki selection permits only public Wikipedia/Fandom hosts", () => {
  expect(wikiHost("https://dc.fandom.com/")).toBe("dc.fandom.com");
  for (const bad of [
    "http://dc.fandom.com",
    "localhost",
    "https://user:secret@dc.fandom.com",
    "dc.fandom.com.evil.org",
    "https://dc.fandom.com/api.php?token=secret",
    "../dc.fandom.com",
  ])
    expect(() => wikiHost(bad)).toThrow();
});

test("concurrent calls share one start per second even across wiki hosts", async () => {
  const c = clock();
  const times: number[] = [];
  const client = new MediaWikiClient({
    limiter: new RequestLimiter(c),
    fetch: async () => {
      times.push(c.now());
      return Response.json(results);
    },
  });
  await Promise.all([
    client.search("dc.fandom.com", "a"),
    client.search("en.wikipedia.org", "b"),
    client.search("dc.fandom.com", "c"),
  ]);
  expect(times).toEqual([0, 1000, 2000]);
});

test("a failed HTTP request consumes its rate-limit slot and does not poison the queue", async () => {
  const c = clock();
  const times: number[] = [];
  const client = new MediaWikiClient({
    limiter: new RequestLimiter(c),
    fetch: async () => {
      times.push(c.now());
      return times.length === 1
        ? new Response("private upstream diagnostics", { status: 402 })
        : Response.json(results);
    },
  });
  await expect(client.search("dc.fandom.com", "a")).rejects.toThrow("Lore source unavailable");
  expect(await client.search("en.wikipedia.org", "b")).toEqual(["Will-o'-the-wisp"]);
  expect(times).toEqual([0, 1000]);
  expect(
    await fixture({ error: { code: "missingtitle", info: "Missing page" } }).client.fetchPage(
      "dc.fandom.com",
      "Missing",
    ),
  ).toBeNull();
});

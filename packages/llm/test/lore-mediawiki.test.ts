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

import pageFandom from "./fixtures/lore/pageimages-fandom.json";
import pageMissing from "./fixtures/lore/pageimages-missing.json";
import pageNone from "./fixtures/lore/pageimages-none.json";
import pageWikipedia from "./fixtures/lore/pageimages-wikipedia.json";

test("a page's lead image comes from PageImages on Wikipedia and Fandom alike", async () => {
  const w = fixture(pageWikipedia);
  const wisp = await w.client.pageImage("en.wikipedia.org", "Will-o'-the-wisp");
  expect(wisp).toEqual({
    title: "Will-o'-the-wisp",
    pageUrl: "https://en.wikipedia.org/wiki/Will-o'-the-wisp",
    imageUrl: expect.stringMatching(/^https:\/\/thumb\.wikimedia\.org\//),
    width: 640,
    height: 425,
  });
  const q = w.calls[0]!.url.searchParams;
  expect(w.calls[0]!.url.pathname).toBe("/w/api.php");
  expect(q.get("prop")).toBe("pageimages");
  expect(q.get("pithumbsize")).toBe("640");
  expect(q.get("redirects")).toBe("1");

  const f = fixture(pageFandom);
  const bat = await f.client.pageImage("dc.fandom.com", "Bruce_Wayne_(Prime_Earth)");
  expect(f.calls[0]!.url.pathname).toBe("/api.php");
  // Redirects resolve: the image belongs to the page the title led to.
  expect(bat?.title).toBe("Batman (Bruce Wayne)");
  expect(bat?.pageUrl).toBe("https://dc.fandom.com/wiki/Batman_(Bruce_Wayne)");
});

test("a page without an image, or no page at all, has no lead image", async () => {
  expect(await fixture(pageNone).client.pageImage("dc.fandom.com", "Old Magda")).toBeNull();
  expect(await fixture(pageMissing).client.pageImage("dc.fandom.com", "Nonexistent Page Xyz")).toBeNull();
});

test("image bytes come over https with the honest user agent; a refusal or a redirect is an error", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const client = (status: number, type = "image/png") =>
    new MediaWikiClient({
      fetch: async (url, init) => {
        seen.push({ url: String(url), ...(init ? { init } : {}) });
        return new Response(new Uint8Array([0x89, 0x50]), { status, headers: { "content-type": type } });
      },
      limiter: new RequestLimiter(clock()),
    });
  const ok = await client(200).fetchBytes("https://thumb.wikimedia.org/a.png");
  expect(ok.mime).toBe("image/png");
  expect(ok.bytes).toEqual(new Uint8Array([0x89, 0x50]));
  expect(new Headers(seen[0]!.init?.headers).get("user-agent")).toBe(
    "WyrdGrimoire/0.1.0 (personal, non-commercial)",
  );
  expect(seen[0]!.init?.redirect).toBe("error");
  await expect(
    client(403, "text/html").fetchBytes("https://static.wikia.nocookie.net/x.jpg"),
  ).rejects.toThrow("Image source refused (403)");
  await expect(client(200).fetchBytes("http://example.org/a.png")).rejects.toThrow(
    "Images are fetched over https only",
  );
});

test("an image download is refused by its declared size or type, and capped while streaming", async () => {
  const respond = (body: BodyInit, headers: Record<string, string>) =>
    new MediaWikiClient({
      fetch: async () => new Response(body, { headers }),
      limiter: new RequestLimiter(clock()),
    });
  await expect(
    respond("x", { "content-type": "image/png", "content-length": "40000000" }).fetchBytes(
      "https://a/big.png",
    ),
  ).rejects.toThrow("Image too large");
  await expect(
    respond("<html>", { "content-type": "text/html" }).fetchBytes("https://a/page"),
  ).rejects.toThrow("Not an image");
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1_000_000));
    },
  });
  await expect(
    respond(endless, { "content-type": "image/jpeg" }).fetchBytes("https://a/endless.jpg"),
  ).rejects.toThrow("Image too large");
  // It stopped soon after the cap instead of buffering forever.
  expect(pulled).toBeLessThan(10);
});

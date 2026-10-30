import { describe, expect, test } from "bun:test";
import { resolveImage } from "../src/resolve.ts";

type Page = { title: string; pageUrl: string; imageUrl: string };
/** A fake wiki: pages with images per host, and search results per host. */
function wiki(pages: Record<string, Record<string, Page | null>>, searches: Record<string, string[]> = {}) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      pageImage: async (host: string, title: string) => {
        calls.push(`page ${host} ${title}`);
        return pages[host]?.[title] ?? null;
      },
      search: async (host: string, query: string) => {
        calls.push(`search ${host} ${query}`);
        return searches[host] ?? [];
      },
    },
  };
}
const page = (host: string, title: string): Page => ({
  title,
  pageUrl: `https://${host}/wiki/${title}`,
  imageUrl: `https://img.${host}/${title}.jpg`,
});

describe("resolving an entity's picture", () => {
  test("an exact page with an image on the source wiki is confident", async () => {
    const w = wiki({ "dc.fandom.com": { Batman: page("dc.fandom.com", "Batman") } });
    const out = await resolveImage({
      entity: { id: "npc:bat", name: "Batman", kind: "npc" },
      wiki: "dc.fandom.com",
      wikiClient: w.client,
    });
    expect(out).toEqual({
      kind: "confident",
      hit: { ...page("dc.fandom.com", "Batman"), origin: "wiki" },
    });
  });

  test("a name without its own page offers search results that have images", async () => {
    const w = wiki(
      {
        "dc.fandom.com": {
          "Batman (Bruce Wayne)": page("dc.fandom.com", "Batman (Bruce Wayne)"),
          "Batman Beyond": page("dc.fandom.com", "Batman Beyond"),
          "Bat-Signal": null,
        },
      },
      { "dc.fandom.com": ["Batman (Bruce Wayne)", "Bat-Signal", "Batman Beyond"] },
    );
    const out = await resolveImage({
      entity: { id: "npc:x", name: "the Bat", kind: "npc" },
      wiki: "dc.fandom.com",
      wikiClient: w.client,
    });
    expect(out.kind).toBe("candidates");
    if (out.kind === "candidates")
      expect(out.hits.map((h) => h.title)).toEqual(["Batman (Bruce Wayne)", "Batman Beyond"]);
  });

  test("people in a campaign with no source wiki never touch Wikipedia or search", async () => {
    const w = wiki({ "en.wikipedia.org": { "Old Magda": page("en.wikipedia.org", "Old Magda") } });
    const search = async () => {
      throw new Error("must not search for a person without a source wiki");
    };
    const out = await resolveImage({
      entity: { id: "npc:magda", name: "Old Magda", kind: "npc" },
      wiki: null,
      wikiClient: w.client,
      search,
    });
    expect(out).toEqual({ kind: "none" });
    expect(w.calls).toEqual([]);
  });

  test("a place in an original world falls back to Wikipedia, as a candidate to confirm", async () => {
    const w = wiki({ "en.wikipedia.org": { Lighthouse: page("en.wikipedia.org", "Lighthouse") } });
    const out = await resolveImage({
      entity: { id: "site:light", name: "Lighthouse", kind: "site" },
      wiki: null,
      wikiClient: w.client,
    });
    expect(out).toEqual({
      kind: "candidates",
      hits: [{ ...page("en.wikipedia.org", "Lighthouse"), origin: "wikipedia" }],
    });
  });

  test("a failing wiki is no picture, not an error", async () => {
    const out = await resolveImage({
      entity: { id: "npc:bat", name: "Batman", kind: "npc" },
      wiki: "dc.fandom.com",
      wikiClient: {
        pageImage: async () => {
          throw new Error("Lore source unavailable");
        },
        search: async () => [],
      },
    });
    expect(out).toEqual({ kind: "none" });
  });
});

describe("never real people", () => {
  test("a person is never looked up on Wikipedia, even when it is the campaign's wiki", async () => {
    const w = wiki({
      "en.wikipedia.org": { "Abraham Lincoln": page("en.wikipedia.org", "Abraham Lincoln") },
    });
    for (const kind of ["pc", "npc", "companion"]) {
      const out = await resolveImage({
        entity: { id: "x", name: "Abraham Lincoln", kind },
        wiki: "en.wikipedia.org",
        wikiClient: w.client,
      });
      expect(out).toEqual({ kind: "none" });
    }
    expect(w.calls).toEqual([]);
  });

  test("Wikipedia only ever offers candidates for places, so a band or a person is never auto-attached", async () => {
    const w = wiki(
      {
        "en.wikipedia.org": {
          Nirvana: page("en.wikipedia.org", "Nirvana"),
          "Nirvana (band)": page("en.wikipedia.org", "Nirvana (band)"),
        },
      },
      { "en.wikipedia.org": ["Nirvana (band)"] },
    );
    const out = await resolveImage({
      entity: { id: "site:n", name: "Nirvana", kind: "site" },
      wiki: null,
      wikiClient: w.client,
    });
    expect(out.kind).toBe("candidates");
  });
});

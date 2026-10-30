import { describe, expect, test } from "bun:test";
import { draft, MAIN_WORLD, type MediaAsset } from "@wyrd/core";
import { campaignWiki, mediaOf } from "../src/media.ts";
import { reduce } from "../src/reduce.ts";
import { Sim } from "./sim.ts";

const asset = (n: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id: n.repeat(64).slice(0, 64),
  mime: "image/png",
  origin: "wiki",
  pageUrl: "https://dc.fandom.com/wiki/Batman",
  ...extra,
});

describe("media assets are events (First Light)", () => {
  test("an attached portrait is projected, and a later one replaces it", () => {
    const s = new Sim();
    s.commit([
      draft("AssetAttached", { entityId: "npc:bat", role: "portrait", asset: asset("a") }, "engine"),
    ]);
    expect(mediaOf(s.state).portraits["npc:bat"]?.id).toBe(asset("a").id);
    s.commit([
      draft("AssetAttached", { entityId: "npc:bat", role: "portrait", asset: asset("b") }, "engine"),
    ]);
    expect(mediaOf(s.state).portraits["npc:bat"]?.id).toBe(asset("b").id);
    s.commit([
      draft("AssetAttached", { entityId: "loc:alley", role: "banner", asset: asset("c") }, "engine"),
    ]);
    expect(mediaOf(s.state).banners["loc:alley"]?.id).toBe(asset("c").id);
    expect(mediaOf(s.state).portraits["loc:alley"]).toBeUndefined();
  });

  test("replaying the log gives the same media, and an old log has none", () => {
    const s = new Sim();
    s.commit([
      draft("AssetAttached", { entityId: "npc:bat", role: "portrait", asset: asset("a") }, "engine"),
    ]);
    let replayed = undefined as unknown as typeof s.state;
    for (const e of s.events) replayed = reduce(replayed, e);
    expect(mediaOf(replayed)).toEqual(mediaOf(s.state));
    expect(mediaOf(new Sim().state)).toEqual({ portraits: {}, banners: {} });
  });

  test("a non-image asset is rejected by the schema", () => {
    const s = new Sim();
    expect(() =>
      s.commit([
        draft(
          "AssetAttached",
          { entityId: "npc:bat", role: "portrait", asset: { ...asset("a"), mime: "text/html" } as never },
          "engine",
        ),
      ]),
    ).toThrow();
  });

  test("the campaign wiki comes from the source, else the most used lore wiki, else none", () => {
    const s = new Sim();
    expect(campaignWiki(s.state)).toBeNull();
    const lore = (id: string, wiki: string) =>
      draft(
        "LoreRecorded",
        {
          record: {
            id,
            entityId: "concept:x",
            worldId: MAIN_WORLD,
            query: "q",
            wiki,
            title: "T",
            summary: "S",
            confidence: "high",
          },
        },
        "model",
      );
    s.commit([lore("l1", "en.wikipedia.org"), lore("l2", "dc.fandom.com"), lore("l3", "dc.fandom.com")]);
    expect(campaignWiki(s.state)).toBe("dc.fandom.com");
    s.commit([
      draft("CanonSourceSet", { worldId: MAIN_WORLD, source: "DC Comics", wiki: "dccomics.fandom.com" }),
    ]);
    expect(campaignWiki(s.state)).toBe("dccomics.fandom.com");
  });
});

test("research on Wikipedia never makes Wikipedia the campaign's picture wiki", () => {
  const s = new Sim();
  s.commit([
    draft(
      "LoreRecorded",
      {
        record: {
          id: "l1",
          entityId: "concept:x",
          worldId: MAIN_WORLD,
          query: "q",
          wiki: "en.wikipedia.org",
          title: "T",
          summary: "S",
          confidence: "high",
        },
      },
      "model",
    ),
  ]);
  expect(campaignWiki(s.state)).toBeNull();
});

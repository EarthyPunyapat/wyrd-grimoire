import { defaultTuning, type MediaAsset } from "@wyrd/core";

export type ImageHit = {
  title: string;
  pageUrl: string;
  imageUrl: string;
  width?: number;
  height?: number;
  origin: MediaAsset["origin"];
};
export type Resolution =
  | { kind: "confident"; hit: ImageHit }
  | { kind: "candidates"; hits: ImageHit[] }
  | { kind: "none" };
type WikiPage = { title: string; pageUrl: string; imageUrl: string; width?: number; height?: number };
type WikiClient = {
  pageImage(wiki: string, title: string): Promise<WikiPage | null>;
  search(wiki: string, query: string): Promise<string[]>;
};

const WIKIPEDIA = "en.wikipedia.org";
const PEOPLE = new Set(["pc", "npc", "companion"]);

/**
 * Where an entity's picture comes from (D168). Asking the wiki for the entity's exact name and getting an
 * image (redirects included) is confident; otherwise the wiki's search results that have images are
 * candidates for the player. People only ever come from the campaign's source wiki, which is fiction;
 * Wikipedia is for places, so a real person is never fetched.
 */
export async function resolveImage(input: {
  entity: { id: string; name: string; kind: string };
  wiki: string | null;
  wikiClient: WikiClient;
  search?: (query: string) => Promise<ImageHit[]>;
}): Promise<Resolution> {
  const person = PEOPLE.has(input.entity.kind);
  const wikis = [input.wiki, person ? null : WIKIPEDIA].filter(
    (w, i, all): w is string => Boolean(w) && all.indexOf(w) === i,
  );
  try {
    for (const wiki of wikis) {
      const origin = wiki === WIKIPEDIA ? "wikipedia" : "wiki";
      const exact = await input.wikiClient.pageImage(wiki, input.entity.name);
      if (exact) return { kind: "confident", hit: { ...exact, origin } };
      const hits: ImageHit[] = [];
      for (const title of await input.wikiClient.search(wiki, input.entity.name)) {
        if (hits.length >= defaultTuning.media.candidates) break;
        const found = await input.wikiClient.pageImage(wiki, title);
        if (found) hits.push({ ...found, origin });
      }
      if (hits.length) return { kind: "candidates", hits };
    }
    if (input.search && (!person || input.wiki)) {
      const hits = (await input.search(input.entity.name)).slice(0, defaultTuning.media.candidates);
      if (hits.length) return { kind: "candidates", hits };
    }
  } catch {
    // A wiki or search that fails is a source without pictures; the worker tries again later.
  }
  return { kind: "none" };
}

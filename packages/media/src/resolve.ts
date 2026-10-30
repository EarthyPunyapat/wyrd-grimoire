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
  | { kind: "none" }
  | { kind: "stopped" };
type WikiPage = { title: string; pageUrl: string; imageUrl: string; width?: number; height?: number };
type WikiClient = {
  pageImage(wiki: string, title: string): Promise<WikiPage | null>;
  search(wiki: string, query: string): Promise<string[]>;
};

const WIKIPEDIA = "en.wikipedia.org";
const PEOPLE = new Set(["pc", "npc", "companion"]);
/** Wikipedia and Wikimedia describe the real world: places only, and never auto-attached. */
export const isRealWorldWiki = (wiki: string) => /(^|\.)(wikipedia|wikimedia)\.org$/i.test(wiki.trim());

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
  /** Checked before every request: true stops at once (a turn started and needs the wiki). */
  stop?: () => boolean;
}): Promise<Resolution> {
  const stopped = () => input.stop?.() ?? false;
  const person = PEOPLE.has(input.entity.kind);
  // People come only from a fiction wiki; a real-world wiki is never used for them, whatever the campaign says.
  const sourceWiki = input.wiki && !(person && isRealWorldWiki(input.wiki)) ? input.wiki : null;
  const wikis = [sourceWiki, person ? null : WIKIPEDIA].filter(
    (w, i, all): w is string => Boolean(w) && all.indexOf(w) === i,
  );
  try {
    for (const wiki of wikis) {
      const real = isRealWorldWiki(wiki);
      const origin = real ? "wikipedia" : "wiki";
      if (stopped()) return { kind: "stopped" };
      const exact = await input.wikiClient.pageImage(wiki, input.entity.name);
      // A real-world page sharing a fantasy place's name is often a band or a person: offer it, never attach it.
      if (exact && !real) return { kind: "confident", hit: { ...exact, origin } };
      const hits: ImageHit[] = exact ? [{ ...exact, origin }] : [];
      if (stopped()) return { kind: "stopped" };
      for (const title of await input.wikiClient.search(wiki, input.entity.name)) {
        if (hits.length >= defaultTuning.media.candidates) break;
        if (stopped()) return { kind: "stopped" };
        const found = await input.wikiClient.pageImage(wiki, title);
        if (found && !hits.some((h) => h.imageUrl === found.imageUrl)) hits.push({ ...found, origin });
      }
      if (hits.length) return { kind: "candidates", hits };
    }
    if (input.search && (!person || sourceWiki)) {
      const hits = (await input.search(input.entity.name)).slice(0, defaultTuning.media.candidates);
      if (hits.length) return { kind: "candidates", hits };
    }
  } catch {
    // A wiki or search that fails is a source without pictures; the worker tries again later.
  }
  return { kind: "none" };
}

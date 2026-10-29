import type { RoleRouter } from "../router.ts";
import { type LorePage, MediaWikiClient, wikiHost } from "./mediawiki.ts";
import { type LoreSummary, summarise } from "./summarise.ts";

/** Structural boundary: llm never depends on filesystem storage. Cache text is summaries only. */
export type SummaryCache = {
  get(wiki: string, title: string): { title: string; url: string; fetchedAt: string; text: string } | null;
  put(
    wiki: string,
    title: string,
    record: { title: string; url: string; fetchedAt: string; text: string },
  ): void;
};
export type LoreLookup = { lookup(wiki: string, query: string): Promise<LoreSummary> };

export class LoreResearch implements LoreLookup {
  private client: Pick<MediaWikiClient, "fetchPage" | "search">;
  private pending = new Map<string, Promise<LoreSummary>>();
  constructor(
    private options: {
      cache: SummaryCache;
      router: RoleRouter;
      client?: Pick<MediaWikiClient, "fetchPage" | "search">;
      now?: () => Date;
    },
  ) {
    this.client = options.client ?? new MediaWikiClient();
  }
  lookup(wiki: string, query: string): Promise<LoreSummary> {
    const host = wikiHost(wiki);
    const key = `${host}:${query}`;
    const previous = this.pending.get(key);
    if (previous) return previous;
    const task = this.research(host, query).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  private async research(host: string, query: string): Promise<LoreSummary> {
    try {
      const cached = this.options.cache.get(host, query);
      if (cached)
        return {
          title: cached.title,
          facts: cached.text.split("\n\n"),
          source: "lore",
          confidence: "high",
          evidence: { quote: cached.url },
        };
      let page: LorePage | null = null;
      try {
        page = await this.client.fetchPage(host, query);
        if (!page) {
          const [title] = await this.client.search(host, query);
          if (title) {
            const hit = this.options.cache.get(host, title);
            if (hit)
              return {
                title: hit.title,
                facts: hit.text.split("\n\n"),
                source: "lore",
                confidence: "high",
                evidence: { quote: hit.url },
              };
            page = await this.client.fetchPage(host, title);
          }
        }
      } catch {
        /* No upstream error text is sent to the model or player. */
      }
      let result: LoreSummary;
      try {
        result = await summarise(this.options.router, page, query);
      } catch {
        if (!page) throw new Error("Lore research unavailable");
        result = await summarise(this.options.router, null, query, page.text);
      }
      if (page && result.confidence === "high") {
        const record = {
          title: page.title,
          url: page.url,
          fetchedAt: (this.options.now?.() ?? new Date()).toISOString(),
          text: result.facts.join("\n\n"),
        };
        this.options.cache.put(host, query, record);
        if (query !== page.title) this.options.cache.put(host, page.title, record);
      }
      return result;
    } catch {
      throw new Error("Lore research unavailable");
    }
  }
}

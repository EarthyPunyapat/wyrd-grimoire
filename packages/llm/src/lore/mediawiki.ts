import { defaultTuning } from "@wyrd/core";
import { version } from "../../package.json";

export type LorePage = { title: string; url: string; text: string };
export type LoreFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

/** One queue across hosts; failures consume their slot too. */
export class RequestLimiter {
  private queue: Promise<unknown> = Promise.resolve();
  private last = -Infinity;
  constructor(
    private clock: Clock = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    private intervalMs = defaultTuning.lore.requestIntervalMs,
  ) {}
  run<T>(request: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const wait = this.last + this.intervalMs - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      this.last = this.clock.now();
      return request();
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
const sharedLimiter = new RequestLimiter();

/** No arbitrary endpoints, credentials, ports or query strings. */
export function wikiHost(wiki: string): string {
  const url = new URL(wiki.includes("://") ? wiki : `https://${wiki}`);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^(?:[a-z][a-z0-9-]*\.wikipedia\.org|[a-z0-9][a-z0-9-]*\.fandom\.com)$/.test(url.hostname)
  )
    throw new Error("Choose a Wikipedia or Fandom wiki");
  return url.hostname;
}

/** Conservative wikitext reduction: strip templates, refs and markup, retaining visible link labels. */
export function plainWikitext(input: string): string {
  let text = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>|<ref\b[^>]*\/\s*>/gi, "");
  while (/\{\{[^{}]*\}\}/.test(text)) text = text.replace(/\{\{[^{}]*\}\}/g, "");
  return text
    .replace(/\{\|[\s\S]*?\|\}/g, "")
    .replace(/\[\[(?:Category|File|Image):[^\]]*\]\]/gi, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, label?: string) => label ?? target)
    .replace(/\[https?:\/\/\S+(?:\s+([^\]]+))?\]/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/'{2,5}/g, "")
    .replace(/^=+\s*(.*?)\s*=+$/gm, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class MediaWikiClient {
  private fetch: LoreFetch;
  private limiter: RequestLimiter;
  constructor(private options: { fetch?: LoreFetch; limiter?: RequestLimiter; timeoutMs?: number } = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.limiter = options.limiter ?? sharedLimiter;
  }
  private async request(wiki: string, params: Record<string, string>) {
    const host = wikiHost(wiki);
    const url = new URL(
      host.endsWith(".wikipedia.org") ? `https://${host}/w/api.php` : `https://${host}/api.php`,
    );
    url.search = new URLSearchParams({ format: "json", ...params }).toString();
    try {
      return await this.limiter.run(async () => {
        const response = await this.fetch(url.href, {
          headers: { "User-Agent": `WyrdGrimoire/${version} (personal, non-commercial)` },
          redirect: "error",
          signal: AbortSignal.timeout(this.options.timeoutMs ?? defaultTuning.lore.requestTimeoutMs),
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data?.error?.code === "missingtitle") return {};
        if (!data || data.error) throw new Error();
        return data;
      });
    } catch {
      throw new Error("Lore source unavailable");
    }
  }
  async search(wiki: string, query: string): Promise<string[]> {
    const data = await this.request(wiki, {
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: String(defaultTuning.lore.searchLimit),
    });
    return (data.query?.search ?? [])
      .map((p: { title: string }) => p.title)
      .filter((t: unknown): t is string => typeof t === "string");
  }
  async fetchPage(wiki: string, title: string): Promise<LorePage | null> {
    const host = wikiHost(wiki);
    let text: string;
    let name: string;
    if (host.endsWith(".wikipedia.org")) {
      const data = await this.request(host, {
        action: "query",
        prop: "extracts",
        explaintext: "1",
        redirects: "1",
        titles: title,
      });
      const page = Object.values(data.query?.pages ?? {})[0] as
        | { title?: string; extract?: string; missing?: unknown }
        | undefined;
      if (!page || "missing" in page || !page.extract) return null;
      name = page.title ?? title;
      text = page.extract;
    } else {
      const data = await this.request(host, {
        action: "parse",
        prop: "wikitext",
        page: title,
        redirects: "1",
      });
      if (!data.parse?.wikitext?.["*"]) return null;
      name = data.parse.title ?? title;
      text = plainWikitext(data.parse.wikitext["*"]);
    }
    return { title: name, url: pageUrl(host, name), text };
  }
  /** The page's lead image (PageImages), following redirects; null for a missing page or one without an image. */
  async pageImage(
    wiki: string,
    title: string,
  ): Promise<{ title: string; pageUrl: string; imageUrl: string; width?: number; height?: number } | null> {
    const host = wikiHost(wiki);
    const data = await this.request(host, {
      action: "query",
      prop: "pageimages",
      piprop: "thumbnail|name",
      pithumbsize: String(defaultTuning.media.thumbSize),
      redirects: "1",
      titles: title,
    });
    const page = Object.values(data.query?.pages ?? {})[0] as
      | {
          title?: string;
          missing?: unknown;
          thumbnail?: { source?: string; width?: number; height?: number };
        }
      | undefined;
    const source = page?.thumbnail?.source;
    if (!page || "missing" in page || !source?.startsWith("https://")) return null;
    const name = page.title ?? title;
    return {
      title: name,
      pageUrl: pageUrl(host, name),
      imageUrl: source,
      ...(page.thumbnail?.width ? { width: page.thumbnail.width } : {}),
      ...(page.thumbnail?.height ? { height: page.thumbnail.height } : {}),
    };
  }
  /**
   * Image bytes, with the same honest user agent and limiter as API calls. A host that refuses that agent
   * is a source without images: nothing here retries as anyone else.
   */
  async fetchBytes(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
    if (!url.startsWith("https://")) throw new Error("Images are fetched over https only");
    const response = await this.limiter.run(() =>
      this.fetch(url, {
        headers: { "User-Agent": `WyrdGrimoire/${version} (personal, non-commercial)` },
        redirect: "error",
        signal: AbortSignal.timeout(defaultTuning.media.timeoutMs),
      }),
    );
    if (!response.ok) throw new Error(`Image source refused (${response.status})`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime: response.headers.get("content-type") ?? "",
    };
  }
}

const pageUrl = (host: string, name: string) =>
  `https://${host}/wiki/${encodeURI(name.replaceAll(" ", "_")).replaceAll("?", "%3F").replaceAll("#", "%23")}`;

const client = new MediaWikiClient();
export const fetchPage = (wiki: string, title: string) => client.fetchPage(wiki, title);
export const search = (wiki: string, query: string) => client.search(wiki, query);

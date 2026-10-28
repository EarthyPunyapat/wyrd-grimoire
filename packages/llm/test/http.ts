/** Mock HTTP for adapter contract tests: record requests, answer with canned responses or SSE streams. */

export type Recorded = { url: string; method: string; headers: Record<string, string>; body: unknown };

export function sse(events: Array<{ event?: string; data: unknown }>): ReadableStream<Uint8Array> {
  const text = events
    .map(
      (e) =>
        `${e.event ? `event: ${e.event}\n` : ""}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`,
    )
    .join("");
  // Split into small pieces so parsers must handle chunk boundaries mid-line.
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
}

export function mockFetch(handler: (r: Recorded, n: number) => Response | Promise<Response>) {
  const requests: Recorded[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // form bodies stay as strings
      }
    }
    const r: Recorded = { url: String(input), method: init?.method ?? "GET", headers, body };
    requests.push(r);
    return handler(r, requests.length);
  }) as typeof fetch;
  return { fetch: fn, requests };
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const stream = (s: ReadableStream<Uint8Array>) =>
  new Response(s, { status: 200, headers: { "content-type": "text/event-stream" } });

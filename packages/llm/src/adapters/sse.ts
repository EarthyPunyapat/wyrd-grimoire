/** Parses a server-sent-events body into `{ event, data }` records (data lines joined with \n). */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<{ event: string | null; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | null = null;
  let data: string[] = [];
  const flush = () => {
    const out = data.length ? { event, data: data.join("\n") } : null;
    event = null;
    data = [];
    return out;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line === "") {
        const rec = flush();
        if (rec) yield rec;
      } else if (line.startsWith(":")) {
        // comment / keep-alive
      } else {
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const val = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "data") data.push(val);
        else if (field === "event") event = val;
      }
      nl = buffer.indexOf("\n");
    }
  }
  const rec = flush();
  if (rec) yield rec;
}

/** Maps an HTTP status to the router's error codes. */
export function codeForStatus(status: number): {
  code: "auth" | "rate_limited" | "bad_request" | "server";
  retryable: boolean;
} {
  if (status === 401 || status === 403) return { code: "auth", retryable: false };
  if (status === 429) return { code: "rate_limited", retryable: true };
  if (status >= 500) return { code: "server", retryable: true };
  return { code: "bad_request", retryable: false };
}

/** Pulls a readable message out of a JSON error body, falling back to the raw text. */
export function errorMessage(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string; code?: string } | string; message?: string };
    if (typeof j.error === "string") return j.error;
    return j.error?.message ?? j.message ?? text;
  } catch {
    return text.slice(0, 500);
  }
}

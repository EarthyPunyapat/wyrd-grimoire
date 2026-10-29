type Method = "POST" | "PUT" | "PATCH" | "DELETE";

function errorMessage(data: unknown, fallback = "Could not reach the grimoire"): string {
  if (data && typeof data === "object") {
    if ("error" in data && data.error) return String(data.error);
    if ("message" in data && data.message) return String(data.message);
  }
  return fallback;
}

export async function api<T>(
  path: string,
  parse: (data: unknown) => T,
  body?: unknown,
  method: Method = "POST",
): Promise<T> {
  const actual = body === undefined && method === "POST" ? "GET" : method;
  const response = await fetch(`/api${path}`, {
    method: actual,
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
          body: JSON.stringify(body),
        }),
  });
  if (response.status === 204) return parse(null);
  const data: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("wyrd:locked"));
    throw new Error(errorMessage(data));
  }
  return parse(data);
}

/**
 * POSTs JSON and reads a server-sent-event stream. Used for long jobs that report real progress
 * (`progress` / `done` / `failed`) instead of one opaque request.
 */
export async function streamApi<T>(
  path: string,
  body: unknown,
  parse: (data: unknown) => T,
  onProgress?: (data: unknown) => void,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Wyrd": "1" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("wyrd:locked"));
    const data: unknown = await response.json().catch(() => null);
    throw new Error(errorMessage(data));
  }
  if (!response.body) throw new Error("The server did not stream a response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  let failure: { message: string; detail?: string } | undefined;

  const handle = (frame: string) => {
    let event = "message";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    const parsed: unknown = JSON.parse(data);
    if (event === "progress") onProgress?.(parsed);
    else if (event === "done") result = parse(parsed);
    else if (event === "failed") failure = parsed as { message: string; detail?: string };
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at = buffer.indexOf("\n\n");
    while (at >= 0) {
      handle(buffer.slice(0, at));
      buffer = buffer.slice(at + 2);
      at = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) handle(buffer);
  if (failure) {
    const error = new Error(failure.message) as Error & { detail?: string };
    if (failure.detail) error.detail = failure.detail;
    throw error;
  }
  if (result === undefined) throw new Error("The stream ended before the world was ready.");
  return result;
}

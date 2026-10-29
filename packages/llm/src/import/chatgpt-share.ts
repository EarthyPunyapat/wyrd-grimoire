/**
 * Reading ChatGPT share pages (D142). A share page embeds its conversation as a React Router
 * turbo-stream: one flat JSON array where objects map "_<index of key name>" to the index of their
 * value. The conversation is `linear_conversation`; hidden reasoning and tool output are skipped.
 */
export type ChatTurn = { role: "user" | "assistant"; text: string };
export type SharedChat = { title: string; turns: ChatTurn[] };

const SHARE = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/share\/[0-9a-f-]{20,64}$/i;
const HIDDEN = new Set(["thoughts", "reasoning_recap", "model_editable_context", "code", "execution_output"]);

/** The canonical share URL, or null for anything that is not a ChatGPT share link. */
export function parseShareUrl(url: string): string | null {
  const trimmed = url.trim().replace(/[?#].*$/, "");
  return SHARE.test(trimmed) ? trimmed : null;
}

export function decodeSharePage(html: string): SharedChat {
  const chunks = enqueuedStrings(html);
  if (!chunks.length) throw new Error("This page has no shared conversation in it");
  const longest = chunks.reduce((a, b) => (b.length > a.length ? b : a));
  const arr = JSON.parse(JSON.parse(longest) as string) as unknown[];
  const memo = new Map<number, unknown>();
  const val = (i: number): unknown => {
    if (i < 0) return null;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      memo.set(i, out);
      for (const x of v) out.push(typeof x === "number" ? val(x) : x);
      return out;
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      memo.set(i, out);
      for (const [k, vi] of Object.entries(v as Record<string, number>))
        if (k.startsWith("_")) out[String(arr[Number(k.slice(1))])] = val(vi);
      return out;
    }
    memo.set(i, v);
    return v;
  };
  const root = val(0);
  const title = String(find(root, "title") ?? "Shared chat");
  const nodes = (find(root, "linear_conversation") ?? []) as unknown[];
  const turns: ChatTurn[] = [];
  for (const node of nodes) {
    const m = (node as { message?: Record<string, unknown> } | null)?.message;
    const role = (m?.author as { role?: string } | undefined)?.role;
    const content = (m?.content ?? {}) as { content_type?: string; parts?: unknown[] };
    if ((role !== "user" && role !== "assistant") || HIDDEN.has(content.content_type ?? "")) continue;
    const text = (content.parts ?? [])
      .filter((p): p is string => typeof p === "string")
      .join("\n")
      .trim();
    if (text) turns.push({ role, text });
  }
  return { title, turns };
}

/**
 * The JS string literals passed to `streamController.enqueue(...)`. Scanned by hand: a regex over a
 * multi-megabyte literal fails silently in the JS engine on real pages.
 */
function enqueuedStrings(html: string): string[] {
  const out: string[] = [];
  const marker = "streamController.enqueue(";
  let from = 0;
  for (;;) {
    const at = html.indexOf(marker, from);
    if (at === -1) return out;
    let i = at + marker.length;
    if (html[i] !== '"') {
      from = i;
      continue;
    }
    const start = i;
    for (i++; i < html.length && html[i] !== '"'; i++) if (html[i] === "\\") i++;
    out.push(html.slice(start, i + 1));
    from = i + 1;
  }
}

function find(o: unknown, key: string, depth = 0): unknown {
  if (depth > 40 || !o || typeof o !== "object") return undefined;
  if (!Array.isArray(o) && key in o) return (o as Record<string, unknown>)[key];
  for (const v of Object.values(o)) {
    const r = find(v, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Fetches and decodes one share page; the caller supplies `fetch` so tests stay offline. */
export async function fetchSharedChat(url: string, fetchImpl: typeof fetch = fetch): Promise<SharedChat> {
  const canonical = parseShareUrl(url);
  if (!canonical) throw new Error(`${url} is not a ChatGPT share link`);
  const response = await fetchImpl(canonical, {
    headers: { "User-Agent": "Mozilla/5.0 (WyrdGrimoire import; personal use)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`The share link answered ${response.status}`);
  return decodeSharePage(await response.text());
}

/** The player's substantial messages: their recaps restate their state and their moves name who matters. */
const RECAP_CHARS = 150;

/**
 * Shrinks whole chats to what an extraction model needs: every long player recap plus the latest
 * assistant scenes. Each chat gets an equal share of the budget, so one very long chat cannot crowd
 * out the others; inside a chat the newest material is kept first, returned in reading order.
 */
export function condenseChats(chats: SharedChat[], budget: number): string {
  const share = Math.floor(budget / Math.max(1, chats.length)) - 2;
  return chats
    .map((chat) => {
      const recaps = chat.turns.filter((t) => t.role === "user" && t.text.length >= RECAP_CHARS);
      const latest = chat.turns.filter((t) => t.role === "assistant").slice(-4);
      const pieces = [
        ...recaps.map((t) => `[player recap] ${t.text}`),
        ...latest.map((t) => `[latest scene] ${t.text.slice(0, 3000)}`),
      ];
      const head = `# ${chat.title}`;
      const kept: string[] = [];
      let used = head.length;
      for (let i = pieces.length - 1; i >= 0; i--) {
        const piece = pieces[i]!;
        const room = share - used - 2;
        if (piece.length > room) {
          if (room > 200) kept.unshift(piece.slice(0, room));
          break;
        }
        kept.unshift(piece);
        used += piece.length + 2;
      }
      return [head, ...kept].join("\n\n");
    })
    .join("\n\n")
    .slice(0, budget);
}

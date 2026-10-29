import type { ChatProvider, GenerateEvent, GenerateRequest, Message, ModelInfo } from "../types.ts";
import { codeForStatus, errorMessage, parseSse } from "./sse.ts";
import { parseToolArgs } from "./tool-json.ts";

/**
 * OpenAI-compatible Chat Completions adapter (spec 09): DeepSeek, OpenRouter, Ollama, LM Studio,
 * vLLM, llama.cpp. Streams text and tool calls, reports usage, and strips optional parameters a
 * server rejects (remembering them for later calls).
 */
export type OpenAICompatibleConfig = {
  id: string;
  /** e.g. https://api.deepseek.com or http://127.0.0.1:11434/v1; `/chat/completions` is appended. */
  baseUrl: string;
  apiKey?: string;
  /** Explicit provider mode; omitted for servers that do not implement this extension. */
  thinking?: "enabled" | "disabled";
  /** Optional parameters this server is known not to accept. */
  unsupported?: Array<"temperature" | "max_tokens" | "stream_options" | "response_format" | "tool_choice">;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

type OptionalParam = NonNullable<OpenAICompatibleConfig["unsupported"]>[number];
const OPTIONAL: readonly OptionalParam[] = [
  "temperature",
  "max_tokens",
  "stream_options",
  "response_format",
  "tool_choice",
];

function toWire(instructions: string, messages: Message[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: instructions }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((t) => ({
                id: t.id,
                type: "function",
                function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) },
              })),
            }
          : {}),
      });
    } else out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

type Chunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    prompt_cache_hit_tokens?: number; // DeepSeek's name for cached input
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
};

export class OpenAICompatibleProvider implements ChatProvider {
  readonly kind = "openai-compatible" as const;
  readonly id: string;
  private readonly unsupported: Set<OptionalParam>;
  private readonly fetch: typeof fetch;

  constructor(private readonly cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.unsupported = new Set(cfg.unsupported ?? []);
    this.fetch = cfg.fetch ?? fetch;
  }

  private url(path: string) {
    return `${this.cfg.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
      ...this.cfg.headers,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.fetch(this.url("/models"), { headers: this.headers() });
    if (!res.ok) throw new Error(`listModels failed: ${res.status} ${errorMessage(await res.text())}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => ({
      id: m.id,
      contextWindow: 0,
      supports: {
        tools: true,
        jsonSchema: !this.unsupported.has("response_format"),
        temperature: !this.unsupported.has("temperature"),
        maxOutputTokens: !this.unsupported.has("max_tokens"),
        streaming: true,
      },
    }));
  }

  private body(req: GenerateRequest): Record<string, unknown> {
    const b: Record<string, unknown> = {
      model: req.model,
      messages: toWire(req.instructions, req.messages),
      stream: true,
    };
    if (this.cfg.thinking !== undefined) b.thinking = { type: this.cfg.thinking };
    const opt = (k: OptionalParam, v: unknown) => {
      if (v !== undefined && !this.unsupported.has(k)) b[k] = v;
    };
    opt("stream_options", { include_usage: true });
    opt("temperature", req.temperature);
    opt("max_tokens", req.maxOutputTokens);
    if (req.tools?.length) {
      b.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      const choice = req.toolChoice;
      opt(
        "tool_choice",
        choice === undefined
          ? undefined
          : typeof choice === "string"
            ? choice
            : { type: "function", function: { name: choice.name } },
      );
    }
    if (req.responseSchema) {
      opt("response_format", {
        type: "json_schema",
        json_schema: { name: req.responseSchema.name, schema: req.responseSchema.schema },
      });
    }
    return b;
  }

  async *generate(req: GenerateRequest): AsyncIterable<GenerateEvent> {
    let res: Response | undefined;
    // One retry per rejected optional parameter, at most once each.
    for (let attempt = 0; attempt <= OPTIONAL.length; attempt++) {
      try {
        res = await this.fetch(this.url("/chat/completions"), {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(this.body(req)),
          ...(req.signal ? { signal: req.signal } : {}),
        });
      } catch (e) {
        yield req.signal?.aborted
          ? { type: "error", code: "aborted", retryable: false, message: "aborted" }
          : { type: "error", code: "network", retryable: true, message: (e as Error).message };
        return;
      }
      if (res.ok) break;
      const text = await res.text();
      const message = errorMessage(text);
      if (res.status === 400 || res.status === 422) {
        const sent = this.body(req);
        const culprit = OPTIONAL.find((p) => p in sent && message.toLowerCase().includes(p));
        if (culprit) {
          this.unsupported.add(culprit);
          continue;
        }
      }
      const { code, retryable } = codeForStatus(res.status);
      yield { type: "error", code, retryable, message: `${res.status}: ${message}` };
      return;
    }
    if (!res?.ok || !res.body) {
      yield { type: "error", code: "server", retryable: true, message: "No response body" };
      return;
    }

    const calls = new Map<number, { id: string; name: string; args: string }>();
    let finish = "stop";
    try {
      for await (const { data } of parseSse(res.body)) {
        if (data === "[DONE]") break;
        let chunk: Chunk;
        try {
          chunk = JSON.parse(data) as Chunk;
        } catch {
          continue;
        }
        for (const choice of chunk.choices ?? []) {
          const d = choice.delta;
          if (d?.content) yield { type: "text", delta: d.content };
          for (const tc of d?.tool_calls ?? []) {
            const cur = calls.get(tc.index) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            calls.set(tc.index, cur);
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }
        if (chunk.usage) {
          const u = chunk.usage;
          yield {
            type: "usage",
            usage: {
              input: u.prompt_tokens ?? 0,
              cachedInput: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0,
              output: u.completion_tokens ?? 0,
              ...(u.completion_tokens_details?.reasoning_tokens !== undefined
                ? { reasoning: u.completion_tokens_details.reasoning_tokens }
                : {}),
            },
          };
        }
      }
    } catch (e) {
      yield req.signal?.aborted
        ? { type: "error", code: "aborted", retryable: false, message: "aborted" }
        : { type: "error", code: "network", retryable: true, message: (e as Error).message };
      return;
    }
    for (const [index, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      let args: unknown;
      try {
        args = parseToolArgs(c.args);
      } catch {
        const cutOff = finish === "length" || finish === "max_tokens";
        yield {
          type: "error",
          code: "invalid_output",
          retryable: true,
          message: cutOff
            ? `Tool call ${c.name} was cut off at the model's output limit (${c.args.length} characters). Try again or raise the model's max output.`
            : `Tool call ${c.name} returned invalid JSON (${c.args.length} characters).`,
        };
        return;
      }
      yield { type: "toolCall", id: c.id || `call_${index}`, name: c.name, args };
    }
    yield { type: "done", finishReason: finish };
  }
}

import type { ChatGptAuth } from "../chatgpt-auth.ts";
import type {
  ChatProvider,
  ErrorCode,
  GenerateEvent,
  GenerateRequest,
  Message,
  ModelInfo,
} from "../types.ts";
import { parseSse } from "./sse.ts";

/**
 * ChatGPT plan adapter: the public Responses API with a "Sign in with ChatGPT" access token
 * (spec 09; OpenAI's token-sharing guide, "Models and inference" and "Errors and recovery").
 *
 * - Every request sets `store: false` and `stream: true`; instructions go in `instructions`
 *   (no system role); sampling and length parameters are never sent.
 * - Success is only `response.completed`; usage limits can also arrive mid-stream as
 *   `response.failed`. A usage limit or not-eligible error is never retried here: the router
 *   benches the plan and moves the role to its fallback.
 * - A 401 triggers one token refresh and one retry.
 * - `subscription_sharing_unsupported_capability` names the offending `error.param`; optional
 *   parameters are stripped once and remembered.
 */
export type ChatGptPlanConfig = {
  id?: string;
  auth: ChatGptAuth;
  baseUrl?: string;
  fetch?: typeof fetch;
};

/** Structured error codes from the guide, mapped to what the router should do. */
const PLAN_ERRORS: Record<string, { code: ErrorCode; retryable: boolean; message?: string }> = {
  subscription_sharing_usage_limit_exceeded: {
    code: "usage_limit",
    retryable: false,
    message: "ChatGPT plan limit reached for this app (see ChatGPT Settings → Usage)",
  },
  subscription_sharing_usage_unavailable: { code: "server", retryable: true },
  subscription_sharing_user_unavailable: { code: "server", retryable: true },
  subscription_sharing_user_not_eligible: {
    code: "not_eligible",
    retryable: false,
    message:
      "ChatGPT plan usage isn't available for this account, workspace or policy; signing in again won't help",
  },
  subscription_sharing_route_not_supported: { code: "bad_request", retryable: false },
  subscription_sharing_unsupported_capability: { code: "bad_request", retryable: false },
  subscription_sharing_invalid_user: { code: "auth", retryable: false },
  chatpass_v2_scope_not_authorized: { code: "auth", retryable: false },
  chatpass_v2_invalid_authorization_context: { code: "auth", retryable: false },
};

const OPTIONAL = ["tool_choice", "text", "parallel_tool_calls"] as const;
type Optional = (typeof OPTIONAL)[number];

function toInput(messages: Message[], providerId: string): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: [{ type: "input_text", text: m.content }] });
    else if (m.role === "tool")
      out.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content });
    else if (m.raw?.provider === providerId && Array.isArray(m.raw.content)) out.push(...m.raw.content);
    else {
      if (m.content) out.push({ role: "assistant", content: [{ type: "output_text", text: m.content }] });
      for (const t of m.toolCalls ?? []) {
        out.push({
          type: "function_call",
          call_id: t.id,
          name: t.name,
          arguments: JSON.stringify(t.args ?? {}),
        });
      }
    }
  }
  return out;
}

type FailedBody = { error?: { code?: string; message?: string; param?: string } | null; detail?: string };

export class ChatGptPlanProvider implements ChatProvider {
  readonly kind = "chatgpt-plan" as const;
  readonly id: string;
  private readonly fetch: typeof fetch;
  private readonly base: string;
  private readonly unsupported = new Set<Optional>();

  constructor(private readonly cfg: ChatGptPlanConfig) {
    this.id = cfg.id ?? "chatgpt-plan";
    this.fetch = cfg.fetch ?? fetch;
    this.base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  }

  /** Display-ready models for the signed-in account, in the server's order. */
  async listModels(): Promise<ModelInfo[]> {
    const res = await this.fetch(`${this.base}/models`, {
      headers: { authorization: `Bearer ${await this.cfg.auth.accessToken()}` },
    });
    if (!res.ok) throw new Error(`Listing ChatGPT models failed: ${res.status}`);
    const body = (await res.json()) as {
      models?: Array<{ slug: string; display_name?: string; visibility?: string }>;
    };
    return (body.models ?? [])
      .filter((m) => m.visibility === "list")
      .map((m) => ({
        id: m.slug,
        contextWindow: 0,
        supports: {
          tools: true,
          jsonSchema: true,
          temperature: false,
          maxOutputTokens: false,
          streaming: true,
        },
        price: "plan" as const,
      }));
  }

  private body(req: GenerateRequest): Record<string, unknown> {
    const b: Record<string, unknown> = {
      model: req.model,
      instructions: req.instructions,
      input: toInput(req.messages, this.id),
      store: false,
      stream: true,
    };
    const opt = (k: Optional, v: unknown) => {
      if (v !== undefined && !this.unsupported.has(k)) b[k] = v;
    };
    if (req.tools?.length) {
      b.tools = req.tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
      const c = req.toolChoice;
      opt(
        "tool_choice",
        c === undefined ? undefined : typeof c === "string" ? c : { type: "function", name: c.name },
      );
      if (c !== undefined && c !== "auto") opt("parallel_tool_calls", false);
    }
    if (req.responseSchema) {
      opt("text", {
        format: { type: "json_schema", name: req.responseSchema.name, schema: req.responseSchema.schema },
      });
    }
    return b;
  }

  private mapError(status: number, body: FailedBody): Extract<GenerateEvent, { type: "error" }> {
    const code = body.error?.code;
    const known = code ? PLAN_ERRORS[code] : undefined;
    const text = body.error?.message ?? body.detail ?? `HTTP ${status}`;
    if (known)
      return {
        type: "error",
        code: known.code,
        retryable: known.retryable,
        message: known.message ?? `${code}: ${text}`,
      };
    if (status === 401) return { type: "error", code: "auth", retryable: false, message: text };
    if (status === 403)
      return {
        type: "error",
        code: "auth",
        retryable: false,
        message: `Blocked by policy or permission: ${text}`,
      };
    if (status === 429) return { type: "error", code: "rate_limited", retryable: true, message: text };
    if (status >= 500) return { type: "error", code: "server", retryable: true, message: text };
    return { type: "error", code: "bad_request", retryable: false, message: text };
  }

  async *generate(req: GenerateRequest): AsyncIterable<GenerateEvent> {
    let res: Response | undefined;
    let refreshed = false;
    for (let attempt = 0; attempt < 2 + OPTIONAL.length; attempt++) {
      let token: string;
      try {
        token = await this.cfg.auth.accessToken();
      } catch (e) {
        const err = e as { code?: ErrorCode; retryable?: boolean; message: string };
        yield {
          type: "error",
          code: err.code ?? "auth",
          retryable: err.retryable ?? false,
          message: err.message,
        };
        return;
      }
      try {
        res = await this.fetch(`${this.base}/responses`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "text/event-stream",
          },
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
      let body: FailedBody = {};
      try {
        body = (await res.json()) as FailedBody;
      } catch {
        // body without JSON
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        try {
          await this.cfg.auth.refresh();
          continue;
        } catch (e) {
          const err = e as { code?: ErrorCode; message: string };
          yield { type: "error", code: err.code ?? "auth", retryable: false, message: err.message };
          return;
        }
      }
      const param = body.error?.param as Optional | undefined;
      if (
        body.error?.code === "subscription_sharing_unsupported_capability" &&
        param &&
        OPTIONAL.includes(param) &&
        !this.unsupported.has(param)
      ) {
        this.unsupported.add(param);
        continue;
      }
      yield this.mapError(res.status, body);
      return;
    }
    if (!res?.ok || !res.body) {
      yield { type: "error", code: "server", retryable: true, message: "No response stream" };
      return;
    }

    const output: unknown[] = [];
    let completed = false;
    try {
      for await (const { data } of parseSse(res.body)) {
        if (data === "[DONE]") break;
        let e: {
          type: string;
          delta?: string;
          item?: { type: string; call_id?: string; name?: string; arguments?: string };
          response?: {
            status?: string;
            error?: { code?: string; message?: string } | null;
            incomplete_details?: { reason?: string } | null;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              input_tokens_details?: { cached_tokens?: number };
              output_tokens_details?: { reasoning_tokens?: number };
            };
          };
          code?: string;
          message?: string;
        };
        try {
          e = JSON.parse(data);
        } catch {
          continue;
        }
        switch (e.type) {
          case "response.output_text.delta":
            if (e.delta) yield { type: "text", delta: e.delta };
            break;
          case "response.output_item.done":
            if (e.item) {
              output.push(e.item);
              if (e.item.type === "function_call") {
                let args: unknown;
                try {
                  args = e.item.arguments ? JSON.parse(e.item.arguments) : {};
                } catch {
                  yield {
                    type: "error",
                    code: "invalid_output",
                    retryable: true,
                    message: `Tool call ${e.item.name} had invalid JSON`,
                  };
                  return;
                }
                yield { type: "toolCall", id: e.item.call_id ?? "", name: e.item.name ?? "", args };
              }
            }
            break;
          case "response.completed": {
            completed = true;
            const u = e.response?.usage;
            yield {
              type: "usage",
              usage: {
                input: u?.input_tokens ?? 0,
                cachedInput: u?.input_tokens_details?.cached_tokens ?? 0,
                output: u?.output_tokens ?? 0,
                ...(u?.output_tokens_details?.reasoning_tokens !== undefined
                  ? { reasoning: u.output_tokens_details.reasoning_tokens }
                  : {}),
              },
            };
            break;
          }
          case "response.failed":
            yield this.mapError(200, { error: e.response?.error ?? null });
            return;
          case "response.incomplete":
            yield {
              type: "error",
              code: "server",
              retryable: true,
              message: `Response incomplete: ${e.response?.incomplete_details?.reason ?? "unknown"}`,
            };
            return;
          case "error":
            yield this.mapError(200, {
              error: { ...(e.code ? { code: e.code } : {}), ...(e.message ? { message: e.message } : {}) },
            });
            return;
        }
      }
    } catch (err) {
      yield req.signal?.aborted
        ? { type: "error", code: "aborted", retryable: false, message: "aborted" }
        : { type: "error", code: "network", retryable: true, message: (err as Error).message };
      return;
    }
    if (!completed) {
      yield {
        type: "error",
        code: "network",
        retryable: true,
        message: "Stream ended before response.completed",
      };
      return;
    }
    yield { type: "raw", raw: { provider: this.id, content: output } };
    yield { type: "done", finishReason: "completed" };
  }
}

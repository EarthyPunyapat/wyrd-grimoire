import Anthropic from "@anthropic-ai/sdk";
import type { Role } from "@wyrd/core";
import type { ChatProvider, GenerateEvent, GenerateRequest, Message, ModelInfo } from "../types.ts";
import { codeForStatus } from "./sse.ts";

/**
 * Anthropic Messages API adapter (spec 09) on the official SDK.
 *
 * - The stable instructions go in a cached system block (`cache_control`), so sections 1–4 of the
 *   context are a cache hit from the second turn on.
 * - Current models reject forced tool choice, so "required" / a named tool become `auto` plus an
 *   instruction; the pipeline validates the reply and repairs if needed.
 * - Sampling parameters are not sent (current models reject them); effort is set per role.
 * - The assistant's own content (including thinking blocks) is returned as raw content and echoed
 *   back unchanged on the next turn, so multi-turn history is never edited.
 * - A `refusal` stop is reported as `refused`, so the router can move to the next target. On
 *   models that support it, server-side fallbacks are requested too.
 */
export type AnthropicConfig = {
  id: string;
  apiKey: string;
  baseURL?: string;
  /** Effort per role; omitted roles use the model's default. */
  effort?: Partial<Record<Role, "low" | "medium" | "high" | "xhigh" | "max">>;
  /** Ask the API to re-run a refused request on a fallback model (Claude API only). Default true. */
  serverFallbacks?: boolean;
  maxOutputTokens?: number;
  fetch?: typeof fetch;
};

/** Models that accept `fallbacks: "default"` (see the Claude API docs on refusals and fallbacks). */
const SERVER_FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const DEFAULT_EFFORT: Partial<Record<Role, "low" | "medium">> = { parser: "low" };

type Content = Anthropic.Beta.BetaContentBlockParam;

function toWire(messages: Message[], providerId: string): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  const push = (role: "user" | "assistant", blocks: Content[]) => {
    const last = out.at(-1);
    if (last && last.role === role && Array.isArray(last.content))
      (last.content as Content[]).push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === "user") push("user", [{ type: "text", text: m.content }]);
    else if (m.role === "tool")
      push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
    else if (m.raw?.provider === providerId) push("assistant", m.raw.content as Content[]);
    else {
      const blocks: Content[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const t of m.toolCalls ?? [])
        blocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.args ?? {} });
      push("assistant", blocks);
    }
  }
  return out;
}

export class AnthropicProvider implements ChatProvider {
  readonly kind = "anthropic" as const;
  readonly id: string;
  private readonly client: Anthropic;

  constructor(private readonly cfg: AnthropicConfig) {
    this.id = cfg.id;
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
      // The role router owns retries and fallbacks.
      maxRetries: 0,
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    for await (const m of this.client.models.list()) {
      const info = m as unknown as { id: string; max_input_tokens?: number };
      models.push({
        id: info.id,
        contextWindow: info.max_input_tokens ?? 0,
        supports: {
          tools: true,
          jsonSchema: true,
          temperature: false,
          maxOutputTokens: true,
          streaming: true,
        },
      });
    }
    return models;
  }

  async *generate(req: GenerateRequest): AsyncIterable<GenerateEvent> {
    // Forced tool use is rejected by current models: ask in words, keep tool_choice auto.
    let system = req.instructions;
    if (req.tools?.length && req.toolChoice && req.toolChoice !== "auto") {
      system +=
        typeof req.toolChoice === "string"
          ? "\n\nReply by calling exactly one of the provided tools."
          : `\n\nReply by calling the ${req.toolChoice.name} tool.`;
    }
    if (req.responseSchema) {
      system += `\n\nReply with only JSON matching this schema:\n${JSON.stringify(req.responseSchema.schema)}`;
    }
    const effort = this.cfg.effort?.[req.role] ?? DEFAULT_EFFORT[req.role];
    const fallbacks = (this.cfg.serverFallbacks ?? true) && SERVER_FALLBACK_MODELS.has(req.model);

    const params: Anthropic.Beta.MessageCreateParamsStreaming = {
      model: req.model,
      max_tokens: req.maxOutputTokens ?? this.cfg.maxOutputTokens ?? 16_000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: toWire(req.messages, this.id),
      stream: true,
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
            })),
            tool_choice: {
              type: "auto" as const,
              disable_parallel_tool_use: req.toolChoice !== undefined && req.toolChoice !== "auto",
            },
          }
        : {}),
      ...(effort ? { output_config: { effort } } : {}),
      ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    };

    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = this.client.beta.messages.stream(params, req.signal ? { signal: req.signal } : {});
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", delta: event.delta.text };
        }
      }
      message = await stream.finalMessage();
    } catch (e) {
      yield this.error(e, req.signal);
      return;
    }

    if (message.stop_reason === "refusal") {
      const details = (message as { stop_details?: { category?: string | null } }).stop_details;
      yield {
        type: "error",
        code: "refused",
        retryable: false,
        message: `Declined (${details?.category ?? "unspecified"})`,
      };
      return;
    }
    for (const block of message.content) {
      if (block.type === "tool_use")
        yield { type: "toolCall", id: block.id, name: block.name, args: block.input };
    }
    yield { type: "raw", raw: { provider: this.id, content: message.content } };
    const u = message.usage;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    yield {
      type: "usage",
      // input_tokens excludes cache reads and writes; the router's usage record counts all input.
      usage: {
        input: u.input_tokens + cacheRead + cacheWrite,
        cachedInput: cacheRead,
        output: u.output_tokens,
      },
    };
    yield { type: "done", finishReason: message.stop_reason ?? "end_turn" };
  }

  private error(e: unknown, signal?: AbortSignal): Extract<GenerateEvent, { type: "error" }> {
    if (e instanceof Anthropic.APIUserAbortError || signal?.aborted) {
      return { type: "error", code: "aborted", retryable: false, message: "aborted" };
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) {
      return { type: "error", code: "timeout", retryable: true, message: e.message };
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return { type: "error", code: "network", retryable: true, message: e.message };
    }
    if (e instanceof Anthropic.APIError && typeof e.status === "number") {
      // 529 overloaded counts as a server error.
      const { code, retryable } = codeForStatus(e.status);
      return { type: "error", code, retryable, message: `${e.status}: ${e.message}` };
    }
    return { type: "error", code: "network", retryable: true, message: (e as Error).message };
  }
}

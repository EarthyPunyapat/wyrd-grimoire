import type { Role } from "@wyrd/core";

export type { Role } from "@wyrd/core";

export type JsonSchema = Record<string, unknown>;

/** A conversation message. Tool results carry the call's ID so providers can pair them. */
export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; raw?: RawContent }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolCall = { id: string; name: string; args: unknown };

/**
 * A provider's own assistant content (e.g. Anthropic thinking blocks), echoed back unchanged on the
 * next turn to the same provider so the conversation history stays intact.
 */
export type RawContent = { provider: string; content: unknown };

export type ToolDef = { name: string; description: string; parameters: JsonSchema };

export type GenerateRequest = {
  role: Role;
  model: string;
  /** Stable, cache-friendly system text. */
  instructions: string;
  messages: Message[];
  tools?: ToolDef[];
  toolChoice?: "auto" | "required" | { name: string };
  /** Structured output without tools. */
  responseSchema?: { name: string; schema: JsonSchema };
  /** Dropped by adapters whose provider doesn't support them. */
  maxOutputTokens?: number;
  temperature?: number;
  /** How many leading context sections are byte-stable (for explicit cache breakpoints). */
  cacheHints?: { stablePrefixChars: number };
  signal?: AbortSignal;
};

export type Usage = { input: number; cachedInput: number; output: number; reasoning?: number };

export type GenerateEvent =
  | { type: "text"; delta: string }
  | { type: "toolCall"; id: string; name: string; args: unknown }
  | { type: "usage"; usage: Usage }
  | { type: "raw"; raw: RawContent }
  | { type: "done"; finishReason: string }
  | { type: "error"; code: ErrorCode; retryable: boolean; message: string };

/**
 * Error codes the router acts on. `usage_limit` (ChatGPT plan weekly allowance) and `not_eligible`
 * must never be retried in a loop: the router switches to the fallback instead.
 */
export type ErrorCode =
  | "timeout"
  | "rate_limited"
  | "usage_limit"
  | "not_eligible"
  | "auth"
  | "bad_request"
  | "server"
  | "network"
  | "aborted"
  | "invalid_output"
  /** The model declined on safety grounds; the router moves to the next target. */
  | "refused";

export type ModelInfo = {
  id: string;
  contextWindow: number;
  supports: {
    tools: boolean;
    jsonSchema: boolean;
    temperature: boolean;
    maxOutputTokens: boolean;
    streaming: boolean;
  };
  price?: { inputPerM: number; cachedInputPerM?: number; outputPerM: number; currency: "USD" } | "plan";
};

export type ProviderKind = "chatgpt-plan" | "openai-compatible" | "anthropic" | "openai-api" | "fake";

export interface ChatProvider {
  id: string;
  kind: ProviderKind;
  listModels(): Promise<ModelInfo[]>;
  generate(req: GenerateRequest): AsyncIterable<GenerateEvent>;
}

/** Everything one call produced, collected from the stream. */
export type Completion = {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: string;
  raw?: RawContent;
};

export class ProviderError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly provider?: string,
  ) {
    super(message);
  }
}

import type { ChatProvider, GenerateEvent, GenerateRequest, ModelInfo, Role, Usage } from "./types.ts";

/** One scripted reply. Functions see the request, so a script can react to what was asked. */
export type FakeReply =
  | { text: string; usage?: Partial<Usage> }
  | { toolCall: { name: string; args: unknown }; usage?: Partial<Usage> }
  | {
      error: {
        code: Extract<GenerateEvent, { type: "error" }>["code"];
        retryable?: boolean;
        message?: string;
      };
    };

export type FakeRule = {
  role?: Role;
  /** Extra condition on the request (e.g. "the last message mentions the door"). */
  match?: (req: GenerateRequest) => boolean;
  reply: FakeReply | ((req: GenerateRequest) => FakeReply);
  /** How many times this rule may answer; omitted = unlimited. */
  times?: number;
};

/**
 * Scripted provider for development without keys and for every CI test (spec 15). Rules are
 * tried in order; the first matching rule with uses left answers. Every request is recorded.
 */
export class FakeProvider implements ChatProvider {
  readonly kind = "fake" as const;
  readonly requests: GenerateRequest[] = [];
  private readonly rules: Array<FakeRule & { used: number }>;

  constructor(
    rules: FakeRule[] = [],
    readonly id = "fake",
  ) {
    this.rules = rules.map((r) => ({ ...r, used: 0 }));
  }

  /** Adds rules; earlier rules still win, so add specific rules before general ones. */
  script(...rules: FakeRule[]): this {
    this.rules.push(...rules.map((r) => ({ ...r, used: 0 })));
    return this;
  }

  calls(role?: Role): GenerateRequest[] {
    return role ? this.requests.filter((r) => r.role === role) : this.requests;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "fake-model",
        contextWindow: 1_000_000,
        supports: {
          tools: true,
          jsonSchema: true,
          temperature: true,
          maxOutputTokens: true,
          streaming: true,
        },
        price: { inputPerM: 0, outputPerM: 0, currency: "USD" },
      },
    ];
  }

  async *generate(req: GenerateRequest): AsyncIterable<GenerateEvent> {
    this.requests.push(req);
    const rule = this.rules.find(
      (r) =>
        (r.role === undefined || r.role === req.role) &&
        (r.match?.(req) ?? true) &&
        (r.times === undefined || r.used < r.times),
    );
    if (!rule) {
      yield {
        type: "error",
        code: "bad_request",
        retryable: false,
        message: `FakeProvider has no script for role ${req.role}`,
      };
      return;
    }
    rule.used++;
    const reply = typeof rule.reply === "function" ? rule.reply(req) : rule.reply;
    if ("error" in reply) {
      yield {
        type: "error",
        code: reply.error.code,
        retryable: reply.error.retryable ?? false,
        message: reply.error.message ?? reply.error.code,
      };
      return;
    }
    const input = Math.ceil((req.instructions.length + JSON.stringify(req.messages).length) / 4);
    if ("text" in reply) {
      // Stream in a few chunks so consumers exercise delta handling.
      const words = reply.text.split(/(?<= )/);
      const step = Math.max(1, Math.ceil(words.length / 4));
      for (let i = 0; i < words.length; i += step)
        yield { type: "text", delta: words.slice(i, i + step).join("") };
    } else {
      yield {
        type: "toolCall",
        id: `call_${this.requests.length}`,
        name: reply.toolCall.name,
        args: reply.toolCall.args,
      };
    }
    yield {
      type: "usage",
      usage: { input, cachedInput: 0, output: 10, ...reply.usage },
    };
    yield { type: "done", finishReason: "toolCall" in reply ? "tool_calls" : "stop" };
  }
}

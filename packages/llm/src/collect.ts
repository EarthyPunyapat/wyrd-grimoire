import { type Completion, type GenerateEvent, ProviderError } from "./types.ts";

/**
 * Drains a generate stream into a Completion. `onText` sees text deltas as they arrive (for
 * streaming to the UI); `maxChars` aborts runaway output on routes without max_output_tokens.
 */
export async function collect(
  stream: AsyncIterable<GenerateEvent>,
  opts: { onText?: (delta: string) => void; maxChars?: number; provider?: string } = {},
): Promise<Completion> {
  const out: Completion = {
    text: "",
    toolCalls: [],
    usage: { input: 0, cachedInput: 0, output: 0 },
    finishReason: "unknown",
  };
  for await (const e of stream) {
    switch (e.type) {
      case "text":
        out.text += e.delta;
        opts.onText?.(e.delta);
        if (opts.maxChars !== undefined && out.text.length > opts.maxChars) {
          out.text = out.text.slice(0, opts.maxChars);
          out.finishReason = "length";
          return out;
        }
        break;
      case "toolCall":
        out.toolCalls.push({ id: e.id, name: e.name, args: e.args });
        break;
      case "usage":
        out.usage = {
          input: out.usage.input + e.usage.input,
          cachedInput: out.usage.cachedInput + e.usage.cachedInput,
          output: out.usage.output + e.usage.output,
          ...(e.usage.reasoning !== undefined
            ? { reasoning: (out.usage.reasoning ?? 0) + e.usage.reasoning }
            : {}),
        };
        break;
      case "raw":
        out.raw = e.raw;
        break;
      case "done":
        out.finishReason = e.finishReason;
        break;
      case "error":
        throw new ProviderError(e.code, e.message, e.retryable, opts.provider);
    }
  }
  return out;
}

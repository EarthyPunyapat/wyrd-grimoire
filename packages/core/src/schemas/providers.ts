import { z } from "zod";

const Target = z.object({ provider: z.string(), model: z.string() });

const ProviderConfig = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("openai-compatible"),
    baseUrl: z.string().url(),
    /** File name in WYRD_HOME/secrets holding the API key (local servers need none). */
    apiKeySecret: z.string().optional(),
    thinking: z.enum(["enabled", "disabled"]).optional(),
    unsupported: z
      .array(z.enum(["temperature", "max_tokens", "stream_options", "response_format", "tool_choice"]))
      .optional(),
  }),
  z.object({ kind: z.literal("chatgpt-plan") }),
  z.object({
    kind: z.literal("anthropic"),
    apiKeySecret: z.string(),
    effort: z.record(z.string(), z.enum(["low", "medium", "high", "xhigh", "max"])).optional(),
    serverFallbacks: z.boolean().optional(),
  }),
]);

const Price = z.union([
  z.literal("plan"),
  z.object({ inputPerM: z.number(), cachedInputPerM: z.number().optional(), outputPerM: z.number() }),
]);

export const WyrdConfig = z.object({
  providers: z.record(z.string(), ProviderConfig),
  preset: z.enum(["balanced", "cheap", "maxQuality", "fullyLocal"]).default("balanced"),
  /** Which provider and model fills each preset slot. Model IDs are always chosen by the user. */
  models: z
    .object({ plan: Target, deepseek: Target, anthropic: Target, local: Target, best: Target })
    .partial()
    .default({}),
  /** Per-role overrides on top of the preset. */
  routing: z
    .record(
      z.string(),
      z.object({ provider: z.string(), model: z.string(), fallbacks: z.array(Target).default([]) }),
    )
    .default({}),
  prices: z.record(z.string(), Price).default({}),
});
export type WyrdConfig = z.infer<typeof WyrdConfig>;

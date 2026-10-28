import { z } from "zod";

/** A job a model does (spec 09). Each role can route to a different provider and model. */
export const Role = z.enum([
  "parser",
  "narrator",
  "npcDialogue",
  "worldGen",
  "sessionZero",
  "guard",
  "summarizer",
  "embeddings",
]);
export type Role = z.infer<typeof Role>;

/** One record per model call, shown only in Settings → Usage (spec 09). */
export const UsageRecord = z.object({
  at: z.string(),
  campaignId: z.string().optional(),
  turnId: z.string().optional(),
  role: Role,
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  input: z.number().int().nonnegative(),
  cachedInput: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  reasoning: z.number().int().nonnegative().optional(),
  latencyMs: z.number().nonnegative(),
  costEstimate: z.union([z.number().nonnegative(), z.literal("plan")]),
  ok: z.boolean(),
  errorCode: z.string().optional(),
});
export type UsageRecord = z.infer<typeof UsageRecord>;

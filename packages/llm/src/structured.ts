import { defaultTuning, type Role } from "@wyrd/core";
import { z } from "zod";
import type { RoleRouter } from "./router.ts";
import { type Message, ProviderError } from "./types.ts";

export type StructuredSpec<T> = {
  role: Role;
  /** Tool name, forced via toolChoice {name}. */
  tool: string;
  schema: z.ZodType<T>;
  instructions: string;
  /** First user message. */
  input: string;
  promptVersion: string;
  maxOutputTokens?: number;
  maxChars?: number;
  repairs?: number;
  /** Overrides the role's timeout, for a role the caller knows can be slower or faster. */
  timeoutMs?: number;
};

/**
 * Calls a model for one tool call, validates it with zod, and feeds validation or invalid-output
 * errors back for `repairs` more attempts before failing. The helper owns the repairs, so the
 * router is called with `retries: 0`.
 */
export async function proposeStructured<T>(
  router: RoleRouter,
  spec: StructuredSpec<T>,
  opts: { campaignId?: string } = {},
): Promise<T> {
  const repairs = spec.repairs ?? defaultTuning.structuredOutput.repairs;
  const parameters = z.toJSONSchema(spec.schema) as Record<string, unknown>;
  delete parameters.$schema;
  const messages: Message[] = [{ role: "user", content: spec.input }];
  let lastError = "The generated content did not match its format.";

  for (let attempt = 0; attempt <= repairs; attempt++) {
    let completion: Awaited<ReturnType<RoleRouter["complete"]>>;
    try {
      completion = await router.complete(
        spec.role,
        {
          instructions: spec.instructions,
          messages,
          tools: [{ name: spec.tool, description: `Answer with ${spec.tool}.`, parameters }],
          toolChoice: { name: spec.tool },
        },
        {
          promptVersion: spec.promptVersion,
          ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
          retries: 0,
          maxChars: spec.maxChars ?? 80000,
          maxOutputTokens: spec.maxOutputTokens ?? 16384,
          ...(spec.timeoutMs ? { timeoutMs: spec.timeoutMs } : {}),
        },
      );
    } catch (error) {
      // The router already handled the fallbacks for every other code.
      if (!(error instanceof ProviderError) || error.code !== "invalid_output") throw error;
      lastError = error.message;
      if (attempt === repairs) break;
      messages.push({
        role: "user",
        content: `${lastError}\nCall ${spec.tool} again with corrected arguments.`,
      });
      continue;
    }

    const call = completion.toolCalls.find((c) => c.name === spec.tool);
    if (call) {
      const parsed = spec.schema.safeParse(call.args);
      if (parsed.success) return parsed.data;
      lastError = z.prettifyError(parsed.error);
    } else {
      lastError = `No ${spec.tool} tool call was returned.`;
    }
    if (attempt === repairs) break;

    const content = `${JSON.stringify({ rejected: true, errors: lastError })}\nCall ${spec.tool} again with corrected arguments.`;
    if (call) {
      messages.push({
        role: "assistant",
        content: completion.text,
        toolCalls: [call],
        ...(completion.raw ? { raw: completion.raw } : {}),
      });
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content });
    } else {
      messages.push({ role: "user", content });
    }
  }

  throw new ProviderError("invalid_output", lastError, false);
}

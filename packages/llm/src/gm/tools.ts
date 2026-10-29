import { delegationReportCards } from "@wyrd/engine";
import { z } from "zod";
import type { ToolCall, ToolDef } from "../types.ts";
import { gmTool, gmTools } from "./registry.ts";
import type { ToolContext, ToolEffects, ToolOutcome } from "./tool-types.ts";
import "./tools/index.ts";

export type { ToolContext, ToolEffects, ToolOutcome, ToolProgress } from "./tool-types.ts";

/** The tools the GM may call in this situation, from the registry (W2 roadmap spine). */
export function gmToolDefs(o: { inCombat: boolean }): ToolDef[] {
  return gmTools()
    .filter((t) => t.available?.(o) ?? true)
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(t.schema) as ToolDef["parameters"],
    }));
}

const none = (): ToolEffects => ({ drafts: [], mechanics: [], cards: [], choices: [] });

/** Executes one GM tool call against the working state. Never throws: failures are results. */
export async function executeTool(call: ToolCall, x: ToolContext): Promise<ToolOutcome> {
  const fail = (errors: unknown): ToolOutcome => ({
    ok: false,
    result: JSON.stringify({ ok: false, errors }),
    effects: none(),
  });
  const tool = gmTool(call.name);
  if (!tool) return fail(`Unknown tool ${call.name}`);
  const parsed = tool.schema.safeParse(call.args);
  if (!parsed.success) return fail(z.prettifyError(parsed.error));
  try {
    const run = await tool.run(parsed.data, x);
    const reports = delegationReportCards(run.effects?.drafts ?? []);
    return {
      ok: run.ok,
      result: JSON.stringify({ ok: run.ok, ...run.body, ...(reports.length ? { reports } : {}) }),
      effects: { ...none(), ...run.effects, cards: [...(run.effects?.cards ?? []), ...reports] },
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

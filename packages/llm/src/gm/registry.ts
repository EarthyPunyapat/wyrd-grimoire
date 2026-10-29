import type { z } from "zod";
import type { ToolContext, ToolRun } from "./tool-types.ts";

/**
 * The GM tool registry (W2 roadmap spine). Each step 3 workstream registers its tools from its own
 * file under `gm/tools/`, imported once from `gm/tools/index.ts`, so no two workstreams edit one switch.
 */
export type GmToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  /** One sentence the model reads to decide when to call it. */
  description: string;
  schema: S;
  /** Hide the tool where it makes no sense (outside a fight, before a system is switched on). */
  available?: (o: { inCombat: boolean }) => boolean;
  /** Runs against the working state; throwing is allowed and becomes a failed result. */
  run: (args: z.infer<S>, x: ToolContext) => ToolRun | Promise<ToolRun>;
};

const tools = new Map<string, GmToolDef>();

export function registerGmTool<S extends z.ZodType>(def: GmToolDef<S>): void {
  if (tools.has(def.name)) throw new Error(`GM tool ${def.name} is already registered`);
  tools.set(def.name, def as unknown as GmToolDef);
}

/** For tests that register a temporary tool. */
export function unregisterGmTool(name: string): void {
  tools.delete(name);
}

export function gmTools(): GmToolDef[] {
  return [...tools.values()];
}

export function gmTool(name: string): GmToolDef | undefined {
  return tools.get(name);
}

import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import { registerGmTool, unregisterGmTool } from "../src/gm/registry.ts";
import { executeTool, gmToolDefs } from "../src/gm/tools.ts";

afterEach(() => unregisterGmTool("ping"));
const x = {} as Parameters<typeof executeTool>[1];

test("a registered tool is offered and dispatched", async () => {
  registerGmTool({
    name: "ping",
    description: "Answer pong.",
    schema: z.object({ n: z.number() }),
    run: (args) => ({ ok: true, body: { pong: args.n } }),
  });
  expect(gmToolDefs({ inCombat: false }).map((t) => t.name)).toContain("ping");
  const r = await executeTool({ id: "c1", name: "ping", args: { n: 2 } }, x);
  expect(r.ok).toBe(true);
  expect(JSON.parse(r.result)).toEqual({ ok: true, pong: 2 });
});

test("a tool can hide itself outside its situation", () => {
  registerGmTool({
    name: "ping",
    description: "Only in a fight.",
    schema: z.object({}),
    available: (o) => o.inCombat,
    run: () => ({ ok: true, body: {} }),
  });
  expect(gmToolDefs({ inCombat: false }).map((t) => t.name)).not.toContain("ping");
  expect(gmToolDefs({ inCombat: true }).map((t) => t.name)).toContain("ping");
});

test("two tools cannot share a name", () => {
  const def = { name: "ping", description: "x", schema: z.object({}), run: () => ({ ok: true, body: {} }) };
  registerGmTool(def);
  expect(() => registerGmTool(def)).toThrow(/already registered/);
});

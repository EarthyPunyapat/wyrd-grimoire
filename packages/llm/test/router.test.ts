import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CassetteProvider } from "../src/cassette.ts";
import { collect } from "../src/collect.ts";
import { FakeProvider } from "../src/fake.ts";
import { type FallbackNotice, presetRouting, RoleRouter, type Routing } from "../src/router.ts";
import type { ChatProvider, GenerateEvent, GenerateRequest } from "../src/types.ts";
import { estimateCost, MemoryUsageSink } from "../src/usage.ts";

const req = {
  instructions: "You narrate.",
  messages: [{ role: "user" as const, content: "Open the door." }],
};
const opts = { promptVersion: "narrator@1" };

function setup(
  plan: FakeProvider,
  deepseek: FakeProvider,
  extra: Partial<ConstructorParameters<typeof RoleRouter>[0]> = {},
) {
  const usage = new MemoryUsageSink();
  const notices: FallbackNotice[] = [];
  const routing: Routing = {
    narrator: { provider: "plan", model: "sol", fallbacks: [{ provider: "deepseek", model: "flash" }] },
  };
  const router = new RoleRouter({
    providers: { plan, deepseek },
    routing,
    usage,
    prices: {
      "plan/*": "plan",
      "deepseek/flash": { inputPerM: 0.14, cachedInputPerM: 0.014, outputPerM: 0.3 },
    },
    onFallback: (n) => notices.push(n),
    ...extra,
  });
  return { router, usage, notices };
}

describe("FakeProvider", () => {
  test("streams scripted text and tool calls, matching by role and request", async () => {
    const fake = new FakeProvider([
      {
        role: "parser",
        match: (r) => JSON.stringify(r.messages).includes("door"),
        reply: { toolCall: { name: "propose_actions", args: { a: 1 } } },
      },
      { role: "narrator", reply: { text: "The door groans open onto a cold yard." }, times: 1 },
    ]);
    const parsed = await collect(fake.generate({ ...req, role: "parser", model: "m" }));
    expect(parsed.toolCalls).toEqual([{ id: "call_1", name: "propose_actions", args: { a: 1 } }]);
    const deltas: string[] = [];
    const told = await collect(fake.generate({ ...req, role: "narrator", model: "m" }), {
      onText: (d) => deltas.push(d),
    });
    expect(told.text).toBe("The door groans open onto a cold yard.");
    expect(deltas.length).toBeGreaterThan(1);
    // `times: 1` is used up; nothing else matches.
    await expect(collect(fake.generate({ ...req, role: "narrator", model: "m" }))).rejects.toThrow(
      /no script/,
    );
    expect(fake.calls("narrator")).toHaveLength(2);
  });
});

describe("RoleRouter", () => {
  test("routes a role to its provider and model and records usage", async () => {
    const plan = new FakeProvider([
      { reply: { text: "Rain on the thatch.", usage: { input: 1000, output: 50 } } },
    ]);
    const { router, usage } = setup(plan, new FakeProvider());
    const out = await router.complete("narrator", req, { ...opts, campaignId: "c1", turnId: "t1" });
    expect(out).toMatchObject({ text: "Rain on the thatch.", provider: "plan", model: "sol" });
    expect(plan.requests[0]).toMatchObject({ role: "narrator", model: "sol" });
    expect(usage.records).toEqual([
      expect.objectContaining({
        role: "narrator",
        provider: "plan",
        model: "sol",
        promptVersion: "narrator@1",
        campaignId: "c1",
        turnId: "t1",
        input: 1000,
        output: 50,
        costEstimate: "plan",
        ok: true,
      }),
    ]);
  });

  test("a plan usage limit (429) switches to the fallback without retrying, and benches the plan", async () => {
    const plan = new FakeProvider([
      { reply: { error: { code: "usage_limit", message: "subscription_sharing_usage_limit_exceeded" } } },
    ]);
    const deepseek = new FakeProvider([{ reply: { text: "Narrated by the fallback." } }]);
    const { router, usage, notices } = setup(plan, deepseek);
    const out = await router.complete("narrator", req, opts);
    expect(out.provider).toBe("deepseek");
    expect(plan.requests).toHaveLength(1); // no retry loop
    expect(notices).toEqual([
      {
        role: "narrator",
        from: { provider: "plan", model: "sol" },
        to: { provider: "deepseek", model: "flash" },
        reason: "usage_limit",
      },
    ]);
    expect(usage.records.map((r) => [r.provider, r.ok, r.errorCode])).toEqual([
      ["plan", false, "usage_limit"],
      ["deepseek", true, undefined],
    ]);
    // Benched: the next call goes straight to the fallback.
    await router.complete("narrator", req, opts);
    expect(plan.requests).toHaveLength(1);
    expect(router.isBenched("plan")).toBe(true);
  });

  test("the bench expires", async () => {
    let t = 0;
    const plan = new FakeProvider([
      { reply: { error: { code: "usage_limit" } }, times: 1 },
      { reply: { text: "Back on the plan." } },
    ]);
    const deepseek = new FakeProvider([{ reply: { text: "fallback" } }]);
    const { router } = setup(plan, deepseek, { now: () => t, benchMs: 1000 });
    await router.complete("narrator", req, opts);
    t = 1001;
    expect((await router.complete("narrator", req, opts)).provider).toBe("plan");
  });

  test("retryable errors retry the same target once, then fall back", async () => {
    const plan = new FakeProvider([{ reply: { error: { code: "server", retryable: true } } }]);
    const deepseek = new FakeProvider([{ reply: { text: "ok" } }]);
    const { router } = setup(plan, deepseek);
    expect((await router.complete("narrator", req, opts)).provider).toBe("deepseek");
    expect(plan.requests).toHaveLength(2);
  });

  test("a transient failure followed by success stays on the primary", async () => {
    const plan = new FakeProvider([
      { reply: { error: { code: "rate_limited", retryable: true } }, times: 1 },
      { reply: { text: "second try" } },
    ]);
    const { router, notices } = setup(plan, new FakeProvider());
    expect((await router.complete("narrator", req, opts)).text).toBe("second try");
    expect(notices).toEqual([]);
  });

  test("timeouts abort the call and count as retryable", async () => {
    const slow: ChatProvider = {
      id: "plan",
      kind: "fake",
      listModels: async () => [],
      async *generate(r: GenerateRequest): AsyncIterable<GenerateEvent> {
        await new Promise((resolve) => r.signal?.addEventListener("abort", resolve));
        yield { type: "error", code: "aborted", retryable: false, message: "aborted" };
      },
    };
    const deepseek = new FakeProvider([{ reply: { text: "fast" } }]);
    const usage = new MemoryUsageSink();
    const router = new RoleRouter({
      providers: { plan: slow, deepseek },
      routing: {
        narrator: { provider: "plan", model: "sol", fallbacks: [{ provider: "deepseek", model: "flash" }] },
      },
      usage,
    });
    const out = await router.complete("narrator", req, { ...opts, timeoutMs: 20, retries: 0 });
    expect(out.provider).toBe("deepseek");
    expect(usage.records[0]).toMatchObject({ ok: false, errorCode: "timeout" });
  });

  test("when every target fails the last error is thrown", async () => {
    const plan = new FakeProvider([{ reply: { error: { code: "not_eligible" } } }]);
    const deepseek = new FakeProvider([{ reply: { error: { code: "auth" } } }]);
    const { router } = setup(plan, deepseek);
    await expect(router.complete("narrator", req, opts)).rejects.toMatchObject({ code: "auth" });
  });

  test("maxChars cuts runaway output", async () => {
    const plan = new FakeProvider([{ reply: { text: "word ".repeat(200) } }]);
    const { router } = setup(plan, new FakeProvider());
    const out = await router.complete("narrator", req, { ...opts, maxChars: 50 });
    expect(out.text.length).toBe(50);
    expect(out.finishReason).toBe("length");
  });
});

describe("usage cost", () => {
  test("cached input is cheaper; plan calls are 'plan'", () => {
    const price = { inputPerM: 1, cachedInputPerM: 0.1, outputPerM: 2 };
    expect(estimateCost(price, { input: 1_000_000, cachedInput: 500_000, output: 1_000_000 })).toBeCloseTo(
      0.5 + 0.05 + 2,
    );
    expect(estimateCost("plan", { input: 1, cachedInput: 0, output: 1 })).toBe("plan");
    expect(estimateCost(undefined, { input: 1, cachedInput: 0, output: 1 })).toBe(0);
  });
});

describe("presets", () => {
  const m = {
    plan: { provider: "chatgpt-plan", model: "user-picked" },
    deepseek: { provider: "deepseek", model: "ds" },
    local: { provider: "ollama", model: "qwen" },
  };
  test("balanced: prose on the plan, structured jobs on DeepSeek, with the spec's fallback chains", () => {
    const r = presetRouting("balanced", m);
    expect(r.narrator).toEqual({ ...m.plan, fallbacks: [m.deepseek] });
    expect(r.parser).toEqual({ ...m.deepseek, fallbacks: [m.plan, m.local] });
    expect(r.guard?.provider).toBe("deepseek");
  });
  test("single puts every job on the primary model", () => {
    const r = presetRouting("single", m);
    for (const role of ["parser", "narrator", "guard", "worldGen", "summarizer"] as const) {
      expect(r[role]).toEqual({ ...m.deepseek, fallbacks: [m.plan, m.local] });
    }
  });
  test("balanced routes gm to the plan first, with a deepseek fallback", () => {
    const r = presetRouting("balanced", m);
    expect(r.gm?.provider).toBe(m.plan.provider);
    expect(r.gm?.fallbacks[0]).toEqual(m.deepseek);
  });
  test("balanced routes check like the parser", () => {
    const r = presetRouting("balanced", m);
    expect(r.check).toEqual(r.parser!);
  });
  test("single routes gm and check", () => {
    const r = presetRouting("single", m);
    expect(r.gm).toEqual({ ...m.deepseek, fallbacks: [m.plan, m.local] });
    expect(r.check).toEqual({ ...m.deepseek, fallbacks: [m.plan, m.local] });
  });
  test("placeholder models never win a route", () => {
    const r = presetRouting("balanced", {
      plan: { provider: "chatgpt-plan", model: "PICK-WITH: sign in" },
      deepseek: m.deepseek,
    });
    expect(r.narrator).toEqual({ ...m.deepseek, fallbacks: [] });
    expect(r.worldGen).toEqual({ ...m.deepseek, fallbacks: [] });
  });
  test("single with only one model configured leaves other providers out", () => {
    const r = presetRouting("single", { deepseek: m.deepseek });
    expect(r.worldGen).toEqual({ ...m.deepseek, fallbacks: [] });
  });
  test("fully local uses only the local model; unconfigured targets are skipped", () => {
    expect(presetRouting("fullyLocal", m).narrator).toEqual({ ...m.local, fallbacks: [] });
    expect(presetRouting("fullyLocal", {}).narrator).toBeUndefined();
  });
});

describe("cassettes", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wyrd-cassette-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("record once, replay offline; secrets are scrubbed", async () => {
    const real = new FakeProvider([{ reply: { text: "Recorded prose mentioning sk-secret-123." } }]);
    const recorder = new CassetteProvider(real, { dir, mode: "record", secrets: ["sk-secret-123"] });
    const r = { ...req, role: "narrator" as const, model: "m" };
    expect((await collect(recorder.generate(r))).text).toContain("sk-secret-123");
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(readFileSync(join(dir, files[0]!), "utf8")).not.toContain("sk-secret-123");

    const player = new CassetteProvider(null, { dir, mode: "replay" });
    expect((await collect(player.generate(r))).text).toBe("Recorded prose mentioning [REDACTED].");
    expect(real.requests).toHaveLength(1);
    await expect(collect(player.generate({ ...r, instructions: "different" }))).rejects.toThrow(
      /No cassette/,
    );
  });

  test("the key ignores the abort signal but not the content", () => {
    const a = { ...req, role: "narrator" as const, model: "m" };
    expect(CassetteProvider.keyOf({ ...a, signal: new AbortController().signal })).toBe(
      CassetteProvider.keyOf(a),
    );
    expect(CassetteProvider.keyOf({ ...a, model: "n" })).not.toBe(CassetteProvider.keyOf(a));
  });
});

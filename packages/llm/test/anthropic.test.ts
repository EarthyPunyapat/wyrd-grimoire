import { describe, expect, test } from "bun:test";
import { AnthropicProvider } from "../src/adapters/anthropic.ts";
import { collect } from "../src/collect.ts";
import type { GenerateRequest } from "../src/types.ts";
import { json, mockFetch, sse, stream } from "./http.ts";

const usage = {
  input_tokens: 40,
  output_tokens: 1,
  cache_read_input_tokens: 900,
  cache_creation_input_tokens: 0,
};
const start = (content: unknown[] = []) => ({
  event: "message_start",
  data: {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content,
      stop_reason: null,
      stop_sequence: null,
      usage,
    },
  },
});
const ev = (type: string, body: Record<string, unknown>) => ({ event: type, data: { type, ...body } });

function toolTurn(stop = "tool_use") {
  return sse([
    start(),
    ev("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }),
    ev("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig-abc" } }),
    ev("content_block_stop", { index: 0 }),
    ev("content_block_start", { index: 1, content_block: { type: "text", text: "" } }),
    ev("content_block_delta", { index: 1, delta: { type: "text_delta", text: "Moving " } }),
    ev("content_block_delta", { index: 1, delta: { type: "text_delta", text: "on." } }),
    ev("content_block_stop", { index: 1 }),
    ev("content_block_start", {
      index: 2,
      content_block: { type: "tool_use", id: "toolu_1", name: "propose_actions", input: {} },
    }),
    ev("content_block_delta", {
      index: 2,
      delta: { type: "input_json_delta", partial_json: '{"actions":[{"type":' },
    }),
    ev("content_block_delta", {
      index: 2,
      delta: { type: "input_json_delta", partial_json: '"wait","minutes":5}],"intent":"wait"}' },
    }),
    ev("content_block_stop", { index: 2 }),
    ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 30 } }),
    ev("message_stop", {}),
  ]);
}

const req: GenerateRequest = {
  role: "parser",
  model: "claude-opus-5-5",
  instructions: "You parse.",
  messages: [{ role: "user", content: "I wait." }],
  tools: [{ name: "propose_actions", description: "d", parameters: { type: "object", properties: {} } }],
  toolChoice: "required",
  temperature: 0.7,
};

const provider = (f: typeof fetch, extra: Partial<ConstructorParameters<typeof AnthropicProvider>[0]> = {}) =>
  new AnthropicProvider({
    id: "anthropic",
    apiKey: "sk-ant-test",
    baseURL: "http://anthropic.test",
    fetch: f,
    ...extra,
  });

describe("Anthropic adapter", () => {
  test("streams text, assembles the tool call, reports usage with cache reads", async () => {
    const m = mockFetch(() => stream(toolTurn()));
    const out = await collect(provider(m.fetch).generate(req));
    expect(out.text).toBe("Moving on.");
    expect(out.toolCalls).toEqual([
      {
        id: "toolu_1",
        name: "propose_actions",
        args: { actions: [{ type: "wait", minutes: 5 }], intent: "wait" },
      },
    ]);
    expect(out.usage).toEqual({ input: 940, cachedInput: 900, output: 30 });
    expect(out.finishReason).toBe("tool_use");
    expect(out.raw?.provider).toBe("anthropic");
  });

  test("request: cached system block, auto tool choice with an instruction, no sampling params, fallbacks and effort", async () => {
    const m = mockFetch(() => stream(toolTurn()));
    await collect(provider(m.fetch).generate(req));
    const r = m.requests[0]!;
    expect(r.url).toStartWith("http://anthropic.test/v1/messages");
    expect(r.headers.authorization).toBe("Bearer sk-ant-test");
    expect(r.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    const body = r.body as Record<string, unknown>;
    expect(body.system).toEqual([
      {
        type: "text",
        text: "You parse.\n\nReply by calling exactly one of the provided tools.",
        cache_control: { type: "ephemeral" },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(body.fallbacks).toBe("default");
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body).not.toHaveProperty("temperature");
    expect(body.stream).toBe(true);
  });

  test("no server fallbacks on models that don't take them", async () => {
    const m = mockFetch(() => stream(toolTurn()));
    await collect(provider(m.fetch).generate({ ...req, model: "claude-haiku-5-5" }));
    expect(m.requests[0]!.body).not.toHaveProperty("fallbacks");
  });

  test("the previous assistant turn (thinking included) goes back unchanged", async () => {
    const m = mockFetch(() => stream(toolTurn()));
    const p = provider(m.fetch);
    const first = await collect(p.generate(req));
    const tc = first.toolCalls[0]!;
    await collect(
      p.generate({
        ...req,
        messages: [
          ...req.messages,
          {
            role: "assistant",
            content: first.text,
            toolCalls: [tc],
            ...(first.raw ? { raw: first.raw } : {}),
          },
          { role: "tool", toolCallId: tc.id, name: tc.name, content: "rejected: fix it" },
        ],
      }),
    );
    const msgs = (
      m.requests[1]!.body as { messages: Array<{ role: string; content: Array<Record<string, unknown>> }> }
    ).messages;
    expect(msgs.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[1]!.content.map((b) => b.type)).toEqual(["thinking", "text", "tool_use"]);
    expect(msgs[1]!.content[0]).toMatchObject({ signature: "sig-abc" });
    expect(msgs[2]!.content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "rejected: fix it" },
    ]);
  });

  test("a refusal stop becomes a non-retryable `refused` error", async () => {
    const m = mockFetch(() => stream(toolTurn("refusal")));
    await expect(collect(provider(m.fetch).generate(req))).rejects.toMatchObject({
      code: "refused",
      retryable: false,
    });
  });

  test("HTTP errors map to router codes", async () => {
    for (const [status, code] of [
      [401, "auth"],
      [429, "rate_limited"],
      [529, "server"],
      [400, "bad_request"],
    ] as const) {
      const m = mockFetch(() => json(status, { type: "error", error: { type: "x", message: "nope" } }));
      await expect(collect(provider(m.fetch).generate(req))).rejects.toMatchObject({ code });
      expect(m.requests).toHaveLength(1); // no SDK retries: the router decides
    }
  });
});

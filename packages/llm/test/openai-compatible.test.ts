import { describe, expect, test } from "bun:test";
import { OpenAICompatibleProvider } from "../src/adapters/openai-compatible.ts";
import { collect } from "../src/collect.ts";
import type { GenerateRequest } from "../src/types.ts";
import { json, mockFetch, sse, stream } from "./http.ts";

const req: GenerateRequest = {
  role: "parser",
  model: "deepseek-model",
  instructions: "You parse.",
  messages: [
    { role: "user", content: "go north" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "propose_actions", args: { a: 1 } }] },
    { role: "tool", toolCallId: "c1", name: "propose_actions", content: "rejected" },
  ],
  tools: [{ name: "propose_actions", description: "d", parameters: { type: "object" } }],
  toolChoice: "required",
  temperature: 0.2,
  maxOutputTokens: 500,
};

const textStream = () =>
  sse([
    { data: { choices: [{ delta: { content: "Hello " } }] } },
    { data: { choices: [{ delta: { content: "world" }, finish_reason: "stop" }] } },
    {
      data: {
        choices: [],
        usage: { prompt_tokens: 120, completion_tokens: 5, prompt_cache_hit_tokens: 100 },
      },
    },
    { data: "[DONE]" },
  ]);

describe("OpenAI-compatible adapter", () => {
  test("sends a Chat Completions request with system instructions, history, tools and auth", async () => {
    const m = mockFetch(() => stream(textStream()));
    const p = new OpenAICompatibleProvider({
      id: "deepseek",
      baseUrl: "https://api.example.com/",
      apiKey: "sk-test",
      fetch: m.fetch,
    });
    const out = await collect(p.generate(req));
    expect(out.text).toBe("Hello world");
    expect(out.usage).toEqual({ input: 120, cachedInput: 100, output: 5 });
    const sent = m.requests[0]!;
    expect(sent.url).toBe("https://api.example.com/chat/completions");
    expect(sent.headers.authorization).toBe("Bearer sk-test");
    expect(sent.body).toMatchObject({
      model: "deepseek-model",
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      max_tokens: 500,
      tool_choice: "required",
      tools: [{ type: "function", function: { name: "propose_actions" } }],
      messages: [
        { role: "system", content: "You parse." },
        { role: "user", content: "go north" },
        {
          role: "assistant",
          tool_calls: [
            { id: "c1", type: "function", function: { name: "propose_actions", arguments: '{"a":1}' } },
          ],
        },
        { role: "tool", tool_call_id: "c1", content: "rejected" },
      ],
    });
  });

  test("assembles streamed tool-call fragments", async () => {
    const m = mockFetch(() =>
      stream(
        sse([
          {
            data: {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: "call_9", function: { name: "propose_", arguments: '{"act' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            data: {
              choices: [
                {
                  delta: {
                    tool_calls: [{ index: 0, function: { name: "actions", arguments: 'ions":[]}' } }],
                  },
                },
              ],
            },
          },
          { data: { choices: [{ delta: {}, finish_reason: "tool_calls" }] } },
          { data: "[DONE]" },
        ]),
      ),
    );
    const p = new OpenAICompatibleProvider({ id: "x", baseUrl: "http://h", fetch: m.fetch });
    const out = await collect(p.generate(req));
    expect(out.toolCalls).toEqual([{ id: "call_9", name: "propose_actions", args: { actions: [] } }]);
    expect(out.finishReason).toBe("tool_calls");
  });

  test("maps HTTP errors to router codes", async () => {
    const cases: Array<[number, string, boolean]> = [
      [401, "auth", false],
      [429, "rate_limited", true],
      [503, "server", true],
      [404, "bad_request", false],
    ];
    for (const [status, code, retryable] of cases) {
      const m = mockFetch(() => json(status, { error: { message: "nope" } }));
      const p = new OpenAICompatibleProvider({ id: "x", baseUrl: "http://h", fetch: m.fetch });
      await expect(collect(p.generate(req))).rejects.toMatchObject({ code, retryable });
    }
  });

  test("strips an unsupported parameter once and remembers it", async () => {
    const m = mockFetch((r) =>
      (r.body as Record<string, unknown>).temperature !== undefined
        ? json(400, {
            error: { message: "Unsupported parameter: 'temperature' is not supported with this model." },
          })
        : stream(textStream()),
    );
    const p = new OpenAICompatibleProvider({ id: "x", baseUrl: "http://h", fetch: m.fetch });
    expect((await collect(p.generate(req))).text).toBe("Hello world");
    expect(m.requests).toHaveLength(2);
    expect(m.requests[1]?.body).not.toHaveProperty("temperature");
    await collect(p.generate({ ...req })).catch(() => {});
    expect(m.requests[2]?.body).not.toHaveProperty("temperature"); // remembered
  });

  test("network failures are retryable; aborts are not", async () => {
    const down = mockFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      collect(
        new OpenAICompatibleProvider({ id: "x", baseUrl: "http://h", fetch: down.fetch }).generate(req),
      ),
    ).rejects.toMatchObject({
      code: "network",
      retryable: true,
    });
    const ac = new AbortController();
    ac.abort();
    const aborted = mockFetch(() => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      collect(
        new OpenAICompatibleProvider({ id: "x", baseUrl: "http://h", fetch: aborted.fetch }).generate({
          ...req,
          signal: ac.signal,
        }),
      ),
    ).rejects.toMatchObject({ code: "aborted" });
  });

  test("invalid tool JSON is reported as invalid output", async () => {
    const m = mockFetch(() =>
      stream(
        sse([
          {
            data: {
              choices: [
                {
                  delta: { tool_calls: [{ index: 0, id: "c", function: { name: "t", arguments: "{oops" } }] },
                },
              ],
            },
          },
          { data: "[DONE]" },
        ]),
      ),
    );
    await expect(
      collect(new OpenAICompatibleProvider({ id: "x", baseUrl: "http://h", fetch: m.fetch }).generate(req)),
    ).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  test("lists models", async () => {
    const m = mockFetch(() => json(200, { data: [{ id: "a" }, { id: "b" }] }));
    const models = await new OpenAICompatibleProvider({
      id: "x",
      baseUrl: "http://h/v1",
      fetch: m.fetch,
    }).listModels();
    expect(models.map((x) => x.id)).toEqual(["a", "b"]);
    expect(m.requests[0]?.url).toBe("http://h/v1/models");
  });
});

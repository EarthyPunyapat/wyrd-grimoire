import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { webcrypto } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptPlanProvider } from "../src/adapters/chatgpt-plan.ts";
import { ChatGptAuth, type ChatGptRecord, SIWC } from "../src/chatgpt-auth.ts";
import { collect } from "../src/collect.ts";
import { FakeProvider } from "../src/fake.ts";
import { RoleRouter } from "../src/router.ts";
import { SecretStore } from "../src/secrets.ts";
import type { GenerateRequest } from "../src/types.ts";
import { json, mockFetch, type Recorded, sse, stream } from "./http.ts";

let keys: webcrypto.CryptoKeyPair;
let jwk: webcrypto.JsonWebKey;
beforeAll(async () => {
  keys = (await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as webcrypto.CryptoKeyPair;
  jwk = { ...(await webcrypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1" } as webcrypto.JsonWebKey;
});

async function idToken(claims: Record<string, unknown>): Promise<string> {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${enc({ alg: "RS256", kid: "k1" })}.${enc(claims)}`;
  const sig = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(head),
  );
  return `${head}.${Buffer.from(sig).toString("base64url")}`;
}

let dir: string;
let secrets: SecretStore;
let now = 1_800_000_000_000;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wyrd-siwc-"));
  secrets = new SecretStore(join(dir, "secrets"));
  now = 1_800_000_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Mock OpenAI auth: discovery, JWKS and the token endpoint. `token` decides each token response. */
function authServer(token: (form: URLSearchParams, n: number) => Response | Promise<Response>) {
  let tokenCalls = 0;
  const m = mockFetch(async (r: Recorded) => {
    if (r.url === SIWC.discovery) return json(200, { jwks_uri: "https://auth.openai.com/jwks" });
    if (r.url === "https://auth.openai.com/jwks") return json(200, { keys: [jwk] });
    if (r.url === SIWC.token) return token(new URLSearchParams(String(r.body)), ++tokenCalls);
    return json(404, {});
  });
  return { ...m, tokenCalls: () => tokenCalls };
}

const grant = async (nonce: string, scope: string = SIWC.scope, refresh = "rt-1") =>
  json(200, {
    access_token: "at-1",
    refresh_token: refresh,
    expires_in: 3600,
    token_type: "Bearer",
    scope,
    id_token: await idToken({
      iss: SIWC.issuer,
      aud: "oaiapp_123",
      exp: Math.floor(now / 1000) + 600,
      nonce,
      sub: "user-1",
      email: "wren@example.com",
    }),
  });

/** Runs connect(), playing the browser: checks the authorize URL, then hits the loopback callback. */
async function signIn(
  auth: ChatGptAuth,
  onUrl: (u: URL) => Record<string, string> = (u) => ({
    code: "code-1",
    state: u.searchParams.get("state")!,
    client_id: "oaiapp_123",
  }),
) {
  let authorizeUrl: URL | undefined;
  const done = auth.connect({
    port: 0,
    open: (url) => {
      authorizeUrl = new URL(url);
      const cb = new URL(authorizeUrl.searchParams.get("redirect_uri")!);
      for (const [k, v] of Object.entries(onUrl(authorizeUrl))) cb.searchParams.set(k, v);
      void fetch(cb).catch(() => {});
    },
  });
  const rec = await done;
  return { rec, authorizeUrl: authorizeUrl! };
}

describe("Sign in with ChatGPT", () => {
  test("first sign-in: dynamic registration, PKCE, loopback redirect, verified ID token, plan scope", async () => {
    let nonce = "";
    const srv = authServer(async (form) => {
      expect(form.get("grant_type")).toBe("authorization_code");
      expect(form.get("client_id")).toBe("oaiapp_123");
      expect(form.get("code_verifier")?.length).toBeGreaterThan(40);
      expect(form.get("resource")).toBe(SIWC.resource);
      return grant(nonce);
    });
    const auth = new ChatGptAuth({ secrets, fetch: srv.fetch, now: () => now });
    const { rec, authorizeUrl } = await signIn(auth, (u) => {
      nonce = u.searchParams.get("nonce")!;
      return { code: "code-1", state: u.searchParams.get("state")!, client_id: "oaiapp_123" };
    });
    const q = authorizeUrl.searchParams;
    expect(`${authorizeUrl.origin}${authorizeUrl.pathname}`).toBe(SIWC.authorize);
    expect(q.get("client_id")).toBe("dynamic_agent_client");
    expect(q.get("agent_name_hint")).toBe("Wyrd Grimoire");
    expect(q.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(q.get("scope")).toBe(SIWC.scope);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("ext_agent_host_id")).toMatch(/^urn:uuid:/);
    expect(rec).toMatchObject({
      client_id: "oaiapp_123",
      subject: "user-1",
      plan_usage: true,
      refresh_token: "rt-1",
    });
    expect(auth.isConnected()).toBe(true);
    if (process.platform !== "win32")
      expect(statSync(join(dir, "secrets/chatgpt-plan.json")).mode & 0o777).toBe(0o600);
    expect(await auth.accessToken()).toBe("at-1");
  });

  test("later sign-ins reuse the issued client ID and the host ID", async () => {
    let nonce = "";
    const srv = authServer(async () => grant(nonce));
    const auth = new ChatGptAuth({ secrets, fetch: srv.fetch, now: () => now });
    const capture = (u: URL) => {
      nonce = u.searchParams.get("nonce")!;
      return { code: "c", state: u.searchParams.get("state")!, client_id: "oaiapp_123" };
    };
    const first = await signIn(auth, capture);
    const second = await signIn(auth, (u) => {
      nonce = u.searchParams.get("nonce")!;
      return { code: "c", state: u.searchParams.get("state")! };
    });
    expect(second.authorizeUrl.searchParams.get("client_id")).toBe("oaiapp_123");
    expect(second.authorizeUrl.searchParams.get("agent_name_hint")).toBeNull();
    expect(second.authorizeUrl.searchParams.get("id_token_hint")).toBe(first.rec.id_token);
    expect(second.authorizeUrl.searchParams.get("ext_agent_host_id")).toBe(
      first.authorizeUrl.searchParams.get("ext_agent_host_id"),
    );
  });

  test("a denied plan scope keeps the sign-in but disables plan usage", async () => {
    let nonce = "";
    const srv = authServer(async () => grant(nonce, "openid profile email offline_access"));
    const auth = new ChatGptAuth({ secrets, fetch: srv.fetch, now: () => now });
    await signIn(auth, (u) => {
      nonce = u.searchParams.get("nonce")!;
      return { code: "c", state: u.searchParams.get("state")!, client_id: "oaiapp_123" };
    });
    expect(auth.isConnected()).toBe(false);
    await expect(auth.accessToken()).rejects.toMatchObject({ code: "not_eligible" });
  });

  test("rejects a wrong state, a denied consent and a forged ID token", async () => {
    const srv = authServer(async () => grant("not-the-nonce"));
    const auth = new ChatGptAuth({ secrets, fetch: srv.fetch, now: () => now });
    await expect(
      signIn(auth, () => ({ code: "c", state: "forged", client_id: "oaiapp_123" })),
    ).rejects.toThrow(/state/);
    await expect(
      signIn(auth, (u) => ({ error: "access_denied", state: u.searchParams.get("state")! })),
    ).rejects.toThrow(/access_denied/);
    await expect(signIn(auth)).rejects.toThrow(/nonce/);
    expect(srv.requests.filter((r) => r.url === SIWC.token)).toHaveLength(1); // only the forged-nonce attempt exchanged a code
  });

  describe("refresh", () => {
    const seed = (over: Partial<ChatGptRecord> = {}) =>
      secrets.writeJson("chatgpt-plan.json", {
        issuer: SIWC.issuer,
        subject: "user-1",
        client_id: "oaiapp_123",
        ext_agent_host_id: "urn:uuid:x",
        id_token: "x.e30.x",
        access_token: "at-old",
        refresh_token: "rt-old",
        token_type: "Bearer",
        expires_at: now - 1,
        scopes: SIWC.scope.split(" "),
        saved_at: "",
        plan_usage: true,
        ...over,
      } satisfies ChatGptRecord);

    test("rotates: one refresh for concurrent callers, new refresh token stored with the new access token", async () => {
      seed();
      const srv = authServer(async (form) => {
        expect(form.get("grant_type")).toBe("refresh_token");
        expect(form.get("refresh_token")).toBe("rt-old");
        expect(form.get("client_id")).toBe("oaiapp_123");
        return json(200, {
          access_token: "at-new",
          refresh_token: "rt-new",
          expires_in: 3600,
          scope: SIWC.scope,
        });
      });
      const auth = new ChatGptAuth({ secrets, fetch: srv.fetch, now: () => now });
      const tokens = await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()]);
      expect(tokens).toEqual(["at-new", "at-new", "at-new"]);
      expect(srv.tokenCalls()).toBe(1);
      expect(auth.record()).toMatchObject({
        access_token: "at-new",
        refresh_token: "rt-new",
        plan_usage: true,
      });
      expect(await auth.accessToken()).toBe("at-new"); // still fresh: no second refresh
      expect(srv.tokenCalls()).toBe(1);
    });

    test("a dead refresh token clears the tokens but keeps the client ID for the next sign-in", async () => {
      seed();
      const srv = authServer(async () => json(400, { error: "refresh_token_reused" }));
      const auth = new ChatGptAuth({ secrets, fetch: srv.fetch, now: () => now });
      await expect(auth.accessToken()).rejects.toMatchObject({ code: "auth" });
      expect(auth.record()).toMatchObject({ client_id: "oaiapp_123", refresh_token: "", plan_usage: false });
    });

    test("a network failure during refresh keeps the credentials", async () => {
      seed();
      const srv = authServer(async () => json(503, { error: "temporarily_unavailable" }));
      const auth = new ChatGptAuth({ secrets, fetch: srv.fetch, now: () => now });
      await expect(auth.accessToken()).rejects.toMatchObject({ code: "network", retryable: true });
      expect(auth.record()?.refresh_token).toBe("rt-old");
    });
  });
});

describe("ChatGPT plan adapter", () => {
  /** A connected auth whose token never expires in these tests. */
  function connected() {
    secrets.writeJson("chatgpt-plan.json", {
      issuer: SIWC.issuer,
      subject: "u",
      client_id: "oaiapp_123",
      ext_agent_host_id: "urn:uuid:x",
      id_token: "x.e30.x",
      access_token: "at-live",
      refresh_token: "rt-live",
      token_type: "Bearer",
      expires_at: now + 3_600_000,
      scopes: SIWC.scope.split(" "),
      saved_at: "",
      plan_usage: true,
    } satisfies ChatGptRecord);
  }

  const req: GenerateRequest = {
    role: "narrator",
    model: "gpt-sol",
    instructions: "You narrate.",
    messages: [
      { role: "user", content: "Open the door." },
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "t", args: { a: 1 } }] },
      { role: "tool", toolCallId: "call_1", name: "t", content: "ok" },
    ],
    tools: [{ name: "t", description: "d", parameters: { type: "object" } }],
    toolChoice: "required",
    temperature: 0.9,
    maxOutputTokens: 400,
  };

  const completed = (
    usage = { input_tokens: 500, output_tokens: 40, input_tokens_details: { cached_tokens: 450 } },
  ) => ({
    data: { type: "response.completed", response: { status: "completed", usage } },
  });
  const okStream = () =>
    sse([
      { data: { type: "response.created", response: { status: "in_progress" } } },
      { data: { type: "response.output_text.delta", delta: "The door " } },
      { data: { type: "response.output_text.delta", delta: "groans." } },
      {
        data: {
          type: "response.output_item.done",
          item: { type: "message", role: "assistant", content: [] },
        },
      },
      {
        data: {
          type: "response.output_item.done",
          item: { type: "function_call", call_id: "call_2", name: "t", arguments: '{"b":2}' },
        },
      },
      completed(),
    ]);

  function plan(handler: (r: Recorded, n: number) => Response | Promise<Response>) {
    connected();
    const m = mockFetch(async (r, n) => {
      if (r.url === SIWC.token)
        return json(200, {
          access_token: "at-refreshed",
          refresh_token: "rt-2",
          expires_in: 3600,
          scope: SIWC.scope,
        });
      return handler(r, n);
    });
    const auth = new ChatGptAuth({ secrets, fetch: m.fetch, now: () => now });
    return { m, p: new ChatGptPlanProvider({ auth, fetch: m.fetch }) };
  }

  test("posts to /v1/responses with store false, stream true, instructions and no sampling or length params", async () => {
    const { m, p } = plan(() => stream(okStream()));
    const out = await collect(p.generate(req));
    expect(out.text).toBe("The door groans.");
    expect(out.toolCalls).toEqual([{ id: "call_2", name: "t", args: { b: 2 } }]);
    expect(out.usage).toEqual({ input: 500, cachedInput: 450, output: 40 });
    const sent = m.requests[0]!;
    expect(sent.url).toBe("https://api.openai.com/v1/responses");
    expect(sent.headers.authorization).toBe("Bearer at-live");
    const body = sent.body as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-sol",
      instructions: "You narrate.",
      store: false,
      stream: true,
      tool_choice: "required",
    });
    for (const k of [
      "temperature",
      "max_output_tokens",
      "top_p",
      "metadata",
      "user",
      "previous_response_id",
      "truncation",
    ]) {
      expect(body).not.toHaveProperty(k);
    }
    expect(body.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Open the door." }] },
      { type: "function_call", call_id: "call_1", name: "t", arguments: '{"a":1}' },
      { type: "function_call_output", call_id: "call_1", output: "ok" },
    ]);
    expect(JSON.stringify(body)).not.toContain('"system"');
  });

  test("usage limit (429) is reported as usage_limit, never retried", async () => {
    const { m, p } = plan(() =>
      json(429, { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } }),
    );
    await expect(collect(p.generate(req))).rejects.toMatchObject({ code: "usage_limit", retryable: false });
    expect(m.requests).toHaveLength(1);
  });

  test("a usage limit mid-stream (response.failed) is a usage limit too", async () => {
    const { p } = plan(() =>
      stream(
        sse([
          { data: { type: "response.output_text.delta", delta: "The do" } },
          {
            data: {
              type: "response.failed",
              response: {
                status: "failed",
                error: { code: "subscription_sharing_usage_limit_exceeded", message: "x" },
              },
            },
          },
        ]),
      ),
    );
    await expect(collect(p.generate(req))).rejects.toMatchObject({ code: "usage_limit" });
  });

  test("the router moves the narrator to its fallback on a mocked plan 429, without a retry loop", async () => {
    const { m, p } = plan(() => json(429, { error: { code: "subscription_sharing_usage_limit_exceeded" } }));
    const deepseek = new FakeProvider([{ reply: { text: "Narrated by DeepSeek." } }], "deepseek");
    const notices: unknown[] = [];
    const router = new RoleRouter({
      providers: { "chatgpt-plan": p, deepseek },
      routing: {
        narrator: {
          provider: "chatgpt-plan",
          model: "gpt-sol",
          fallbacks: [{ provider: "deepseek", model: "flash" }],
        },
      },
      onFallback: (n) => notices.push(n),
    });
    const out = await router.complete(
      "narrator",
      { instructions: "x", messages: [{ role: "user", content: "y" }] },
      { promptVersion: "n@1" },
    );
    expect(out).toMatchObject({ provider: "deepseek", text: "Narrated by DeepSeek." });
    expect(m.requests.filter((r) => r.url.endsWith("/responses"))).toHaveLength(1);
    expect(notices).toEqual([expect.objectContaining({ reason: "usage_limit" })]);
    await router.complete(
      "narrator",
      { instructions: "x", messages: [{ role: "user", content: "y" }] },
      { promptVersion: "n@1" },
    );
    expect(m.requests.filter((r) => r.url.endsWith("/responses"))).toHaveLength(1); // benched
  });

  test("403 not eligible says signing in again won't help", async () => {
    const { p } = plan(() => json(403, { error: { code: "subscription_sharing_user_not_eligible" } }));
    await expect(collect(p.generate(req))).rejects.toMatchObject({
      code: "not_eligible",
      message: expect.stringContaining("won't help"),
    });
  });

  test("a 401 refreshes the token once and retries", async () => {
    const { m, p } = plan((r) =>
      r.headers.authorization === "Bearer at-live" ? json(401, { detail: "expired" }) : stream(okStream()),
    );
    expect((await collect(p.generate(req))).text).toBe("The door groans.");
    expect(m.requests.map((r) => r.url)).toEqual([
      "https://api.openai.com/v1/responses",
      SIWC.token,
      "https://api.openai.com/v1/responses",
    ]);
    expect(m.requests[2]?.headers.authorization).toBe("Bearer at-refreshed");
  });

  test("an unsupported optional parameter named in error.param is stripped once", async () => {
    const { m, p } = plan((r) =>
      (r.body as Record<string, unknown>).tool_choice !== undefined
        ? json(400, { error: { code: "subscription_sharing_unsupported_capability", param: "tool_choice" } })
        : stream(okStream()),
    );
    expect((await collect(p.generate(req))).text).toBe("The door groans.");
    expect(m.requests).toHaveLength(2);
  });

  test("a stream that ends without response.completed is not a success", async () => {
    const { p } = plan(() => stream(sse([{ data: { type: "response.output_text.delta", delta: "half" } }])));
    await expect(collect(p.generate(req))).rejects.toMatchObject({ code: "network", retryable: true });
  });

  test("lists only display-ready models, in the server's order", async () => {
    const { p } = plan(() =>
      json(200, {
        models: [
          { slug: "gpt-terra", display_name: "Terra", visibility: "list" },
          { slug: "internal", visibility: "hide" },
          { slug: "gpt-sol", display_name: "Sol", visibility: "list" },
        ],
      }),
    );
    expect((await p.listModels()).map((x) => x.id)).toEqual(["gpt-terra", "gpt-sol"]);
  });
});

# 09 — Models and providers

Every model call goes through one adapter interface and a **role router**. The engine never knows which model is behind a role.

## Roles

| Role | Job | Needs |
|---|---|---|
| `parser` | Free text → action plan, clarifications, OOC answers, action suggestions | Reliable tool calling; fast; cheap |
| `narrator` | Narration passages | Best prose; follows constraints |
| `npcDialogue` | NPC speech and validated NPC tool calls | Good prose + tool calling |
| `worldGen` | World bible, lazy generation, news batches, zone maps | Structured output; creativity |
| `sessionZero` | Character interview with tools | Conversation + tool calling |
| `guard` | Canon guard reports | Careful structured extraction; cheap (runs every turn) |
| `summarizer` | Scene, chapter, arc summaries; session recaps | Faithful compression; cheap |
| `embeddings` | Vectors for retrieval | Local, free |

## Adapter interface

```ts
interface ChatProvider {
  id: string;                                   // "chatgpt-plan", "deepseek", "anthropic", "ollama", …
  kind: "chatgpt-plan" | "openai-compatible" | "anthropic" | "openai-api";
  listModels(): Promise<ModelInfo[]>;
  generate(req: GenerateRequest): AsyncIterable<GenerateEvent>;
}

type GenerateRequest = {
  role: Role; model: string;
  instructions: string;                         // stable, cache-friendly system text
  messages: Message[];                          // assembled context + turn content
  tools?: ToolDef[];                            // JSON schema from zod
  toolChoice?: "auto" | "required" | { name: string };
  responseSchema?: JsonSchema;                  // when structured output without tools
  maxOutputTokens?: number; temperature?: number; // dropped when the provider doesn't support them
  cacheHints?: { stablePrefixSections: number };
  signal: AbortSignal;
};

type GenerateEvent =
  | { type: "text"; delta: string }
  | { type: "toolCall"; name: string; args: unknown }
  | { type: "usage"; input: number; cachedInput: number; output: number; reasoning?: number }
  | { type: "done"; finishReason: string }
  | { type: "error"; code: string; retryable: boolean; message: string };

type ModelInfo = {
  id: string; contextWindow: number;
  supports: { tools: boolean; jsonSchema: boolean; temperature: boolean; maxOutputTokens: boolean; streaming: boolean };
  price?: { inputPerM: number; cachedInputPerM?: number; outputPerM: number; currency: "USD" } | "plan";
};
```

**Structured output strategy:** use native tool calling with a JSON schema when the model supports it; otherwise put the schema in the instructions, parse JSON, validate with zod, and do one repair retry with the validation errors. Every adapter has a **"Test connection"** probe in Settings that runs a tiny tool call and records the model's real capabilities.

## Adapters

### 1. ChatGPT plan (`chatgpt-plan`, via Sign in with ChatGPT)

Lets the owner's **ChatGPT Plus** plan pay for text model calls.

What was true in October 2026 (**VERIFY all of it against OpenAI's SIWC docs before implementing**):

- Announced at OpenAI DevDay, 29 September 2026. Plan usage is available to **Plus and Pro** users.
- **Open-source apps running locally** can use plan usage **without partner approval**; private or hosted apps need OpenAI's approval. This is why the repo is public (MIT).
- **Auth:** OAuth 2.0 authorisation-code flow with PKCE against `https://auth.openai.com/api/accounts/authorize` and `/api/accounts/oauth/token`, resource `https://api.openai.com/v1`.
  - First sign-in uses `client_id=dynamic_agent_client`; the user names the app on the consent page; the redirect returns a real client ID to save and reuse.
  - Generate a random `ext_agent_host_id` per machine and keep it.
  - Redirect URI must be `http://127.0.0.1:1455/auth/callback` (only the port may change; `localhost` is not accepted).
  - The plan scope is `chatgpt.tokens.use.direct`. The user can deny it, so check it is present in the token response.
  - Access tokens last about an hour; refresh tokens about 30 days and **rotate on every use** (store the new one atomically).
- **Calls:** the Responses API at `https://api.openai.com/v1` with the access token as the bearer.
  - `store: false` and `stream: true` are required.
  - Not supported: `temperature`, `top_p`, `max_output_tokens`, `metadata`, `truncation`, `user`, `previous_response_id`, the `system` role (use `instructions`), and hosted tools (**no image generation**, file search, code interpreter). **Your own function tools work.**
  - Text and image *input* work; audio does not.
  - Models: `GET /v1/models`, keep entries with `visibility === "list"`. The owner uses **GPT-6.1 Sol / Terra**; never hardcode names, let the user pick per role.
- **Limits:** usage counts against the plan's weekly Codex/ChatGPT work allowance. The user can cap this app at 10–100% of weekly usage in ChatGPT's Settings → Usage.
- **Errors:** `429 subscription_sharing_usage_limit_exceeded` → do **not** retry in a loop; switch the role to its fallback (below). `403 subscription_sharing_user_not_eligible` → re-login won't help; show a clear message.
- **Branding:** the button must say **"Continue with ChatGPT"** and follow OpenAI's branding rules.

**Checked against OpenAI's token-sharing guide on 28 October 2026** (`developers.openai.com/siwc/token-sharing-open-source`):

- Authorize also takes `agent_name_hint` (first registration only), `id_token_hint` and `login_hint` (later sign-ins), fresh `state` and `nonce` per attempt. Scope string: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`.
- The new-registration callback returns the issued `client_id` (`oaiapp_…`); reauthorization may omit it, and a different one must be rejected. Exchange the code with the same `redirect_uri` and `resource`.
- Validate the ID token (signature against OpenAI's JWKS, issuer `https://auth.openai.com`, audience = the issued client ID, expiry, nonce). Plan usage needs the `chatgpt.tokens.use.direct` scope; without it, keep the sign-in but mark plan usage off.
- Store one record per client ID and identity, written atomically with owner-only permissions; replace access token, expiry, scopes and the rotated refresh token together. Refresh tokens last 30 days and each refresh returns a replacement.
- Inference: `POST /v1/responses` with `store: false` and `stream: true` on every request; success only on `response.completed`; `response.failed` can carry a usage-limit code mid-stream. Models: `GET /v1/models` returns `models[]`; keep `visibility == "list"`, keep the order, show `display_name`, send `slug`.
- Errors: `subscription_sharing_usage_limit_exceeded` (429, pause plan requests, no reset time given), `subscription_sharing_user_not_eligible` (403, don't retry or re-login), `subscription_sharing_usage_unavailable` / `subscription_sharing_user_unavailable` (503, bounded backoff), `subscription_sharing_unsupported_capability` (400, remove what `error.param` names), plus `subscription_sharing_route_not_supported`, `subscription_sharing_invalid_user`, `chatpass_v2_*`. Terminal refresh errors (`invalid_grant`, `refresh_token_reused`, …) mean sign in again with the saved client ID.
- Still VERIFY: the refresh request's exact form fields and the JWKS URL (the implementation uses the standard OAuth refresh grant plus `resource`, and OpenID discovery).

**Sign-in on a self-hosted server:** because the redirect goes to `127.0.0.1` on the machine running the browser, the sign-in must be done **in a browser on the main PC itself**. If the Settings page is opened from another device, it shows: "Open Wyrd on the PC that runs it to connect ChatGPT." After that, the server holds and refreshes the tokens and every device can play.

Because `max_output_tokens` isn't available on this route, passage length is controlled by instructions, and the client aborts generation past a hard character cap.

### 2. OpenAI-compatible (`openai-compatible`, Chat Completions)

One adapter for anything that speaks the OpenAI Chat Completions API.

Provider config may include `thinking: "enabled" | "disabled"` for servers that support this
extension; otherwise the field is omitted. The DeepSeek playtest defaults to `"disabled"` so the
parser and guard can use forced tool choice. Verified on 2026-10-28 against the
[DeepSeek thinking-mode guide](https://api-docs.deepseek.com/guides/thinking_mode/) and a live
host probe: thinking is enabled by default and rejects the forced tool-choice setting. Malformed
plans still require engine validation and repair regardless of the selected mode.

Malformed provider JSON marked retryable gets one regeneration attempt on the same target within
the router's existing retry budget, then falls back. Engine plan-validation repairs remain a separate
step; regenerating parser JSON happens before any game action is resolved.

| Preset | Base URL | Notes |
|---|---|---|
| **DeepSeek** | `https://api.deepseek.com` (VERIFY) | **DeepSeek V4.1 Flash** (released 10 Sept 2026): tool calling, strict JSON output, streaming, ~1M context; roughly $0.14/M input, $0.30–0.54/M output depending on provider; cache hits much cheaper. VERIFY the official model ID and prices. |
| OpenRouter | `https://openrouter.ai/api/v1` | Any model |
| Ollama | `http://127.0.0.1:11434/v1` | Local models on the 5070 Ti |
| LM Studio | `http://127.0.0.1:1234/v1` | Local |
| Custom | user-entered | vLLM, llama.cpp server, etc. |

### 3. Anthropic (`anthropic`, Messages API)

Tool use, streaming, and explicit prompt caching (`cache_control` on the stable prefix sections). API key auth.

### 4. OpenAI API key (`openai-api`, Responses API)

For users who prefer pay-as-you-go OpenAI over the plan. Also used by the media adapters for images and speech ([10](10-media.md)).

## Role routing and presets

```ts
type RoleRoute = { provider: string; model: string; fallbacks: Array<{ provider: string; model: string }>; options?: object };
type Routing = Record<Role, RoleRoute>;
```

| Role | **Balanced** (default) | Cheap | Max quality | Fully local |
|---|---|---|---|---|
| parser | DeepSeek V4.1 Flash | DeepSeek | best tool-calling model available | Ollama (12–14B instruct) |
| narrator | ChatGPT plan (Sol/Terra) | DeepSeek | best prose model available | Ollama |
| npcDialogue | ChatGPT plan | DeepSeek | best prose model | Ollama |
| worldGen | ChatGPT plan | DeepSeek | best model | Ollama |
| sessionZero | ChatGPT plan | DeepSeek | best model | Ollama |
| guard | DeepSeek V4.1 Flash | DeepSeek | strong reasoning model | Ollama |
| summarizer | DeepSeek V4.1 Flash | DeepSeek | strong model | Ollama |
| embeddings | local | local | local | local |

Presets are starting points; every role is editable in Settings → Models. "Fully local" quality depends on what fits in 16 GB VRAM alongside ComfyUI and TTS; the UI warns that running image generation and a local LLM at the same time may not fit.

### Fallbacks

Each role has an ordered fallback chain (default: ChatGPT-plan roles → DeepSeek → Anthropic if configured; DeepSeek roles → ChatGPT plan → local). A fallback triggers on timeout, 5xx, rate limits, the ChatGPT-plan usage-limit error, or a configured spending cap. When a switch happens because of a limit or cap, the UI shows **one small toast** ("ChatGPT plan limit reached — narrating with DeepSeek until it resets"). Nothing else about cost appears in the play UI.

## Usage meter (Settings → Usage only)

Every model call writes a usage record:

```ts
type UsageRecord = {
  at: string; campaignId?: string; turnId?: string;
  role: Role; provider: string; model: string; promptVersion: string;
  input: number; cachedInput: number; output: number; reasoning?: number;
  latencyMs: number; costEstimate: number | "plan"; ok: boolean; errorCode?: string;
};
```

- **Settings → Usage** shows tokens and estimated cost by day, session, campaign, role and provider, with simple charts. ChatGPT-plan calls show tokens and "included in plan" instead of a price.
- Prices come from an editable price table (pre-filled with the VERIFY values above).
- Optional **monthly spending cap** per paid provider (default: none). When reached: switch affected roles to their fallback, or to Fully local, or pause, as configured.
- **The play UI never shows cost or tokens** (owner preference), apart from the fallback toast.

## Embeddings

| Option | How | Notes |
|---|---|---|
| Ollama (default when detected) | `POST /api/embed` with a local embedding model | VERIFY model names available in the owner's Ollama |
| In-process | A small ONNX embedding model via transformers.js | VERIFY Bun compatibility; CPU is fine for this volume |
| OpenAI-compatible | `POST /v1/embeddings` | Any compatible server |

The embedding model ID is stored with every vector. Changing it triggers a background re-embed ([07](07-memory.md#retrieval-index)).

## Prompt caching

The context assembler puts byte-stable sections first ([07](07-memory.md#context-assembler)) so every provider's caching benefits:

- **Anthropic:** explicit `cache_control` breakpoints after the stable sections.
- **OpenAI (API and plan route) and DeepSeek:** automatic prefix caching (VERIFY behaviour on the plan route); cached input is reported in usage and priced lower.

## Secrets

API keys and OAuth tokens live in `WYRD_HOME/secrets/` with user-only permissions, are never sent to the browser, never logged, and are redacted from error reports. Refresh-token rotation writes the new token atomically (write temp file, then rename).

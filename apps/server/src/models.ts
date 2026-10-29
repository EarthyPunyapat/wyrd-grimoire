import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProviderKeyInput, UsageRecord, WyrdConfig } from "@wyrd/core";
import { ChatGptAuth, offlineProvider, presetRouting, RoleRouter, type SecretStore } from "@wyrd/llm";
import type { AppStore } from "@wyrd/storage";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { buildProviders, EXAMPLE_CONFIG } from "../../cli/src/providers.ts";
import type { AppEnvironment } from "./app.ts";

export class ModelServices {
  readonly auth: ChatGptAuth;
  private cached: RoleRouter | undefined;
  private connecting = false;
  private connectionError: string | null = null;
  constructor(
    readonly store: AppStore,
    readonly secrets: SecretStore,
    readonly home: string,
    readonly offline: boolean,
    readonly injected?: RoleRouter,
  ) {
    this.auth = new ChatGptAuth({ secrets, appName: "Wyrd Grimoire" });
    const legacy = join(home, "config.json");
    if (!store.providerConfig() && existsSync(legacy)) {
      try {
        const parsed = WyrdConfig.safeParse(JSON.parse(readFileSync(legacy, "utf8")));
        if (parsed.success) store.saveProviderConfig(parsed.data);
      } catch {
        this.connectionError = "The previous provider config could not be imported. Configure models here.";
      }
    }
    const usage = join(home, "usage.jsonl");
    if (existsSync(usage)) {
      for (const line of readFileSync(usage, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const record = UsageRecord.safeParse(JSON.parse(line));
          if (record.success) store.recordUsage(record.data, true);
        } catch {
          /* An interrupted trailing JSONL record is not imported. */
        }
      }
    }
  }
  config(): WyrdConfig {
    return WyrdConfig.parse(this.store.providerConfig() ?? EXAMPLE_CONFIG);
  }
  ready(): boolean {
    const cfg = this.config();
    const routing = { ...presetRouting(cfg.preset, cfg.models), ...cfg.routing };
    return ["parser", "narrator", "guard"].every((role) => {
      const route = routing[role as "parser" | "narrator" | "guard"];
      return route && cfg.providers[route.provider] && !route.model.startsWith("PICK-WITH");
    });
  }
  save(cfg: WyrdConfig): void {
    this.store.saveProviderConfig(cfg);
    this.cached = undefined;
  }
  router(): RoleRouter {
    if (this.injected) return this.injected;
    if (this.cached) return this.cached;
    const usage = { record: (r: UsageRecord) => this.store.recordUsage(r) };
    if (this.offline)
      this.cached = new RoleRouter({
        providers: { offline: offlineProvider() },
        routing: Object.fromEntries(
          ["parser", "narrator", "guard"].map((role) => [
            role,
            { provider: "offline", model: "offline", fallbacks: [] },
          ]),
        ),
        usage,
      });
    else {
      if (!this.ready())
        throw new HTTPException(422, { message: "Choose models in Settings before starting a turn" });
      const cfg = this.config();
      try {
        this.cached = new RoleRouter({
          providers: buildProviders(cfg, this.secrets),
          routing: { ...presetRouting(cfg.preset, cfg.models), ...cfg.routing },
          prices: cfg.prices,
          usage,
        });
      } catch {
        throw new HTTPException(422, {
          message: "A provider needs its key. Open Settings → Connection on the host PC.",
        });
      }
    }
    return this.cached;
  }
  status(c: Context<AppEnvironment>) {
    return {
      offline: this.offline,
      configured: this.ready(),
      chatgptConnected: this.auth.isConnected(),
      email: this.auth.record()?.email ?? null,
      hostLocal: isHost(c),
      connecting: this.connecting,
      error: this.connectionError,
    };
  }
  async connect(): Promise<string> {
    if (this.offline)
      throw new HTTPException(409, { message: "ChatGPT sign-in is unavailable in offline preview" });
    if (this.connecting)
      throw new HTTPException(409, { message: "A sign-in is already waiting in the browser" });
    this.connecting = true;
    this.connectionError = null;
    return new Promise<string>((resolve, reject) => {
      void this.auth
        .connect({ open: resolve })
        .catch((error) => {
          this.connectionError = "ChatGPT sign-in was not completed. Please try again.";
          reject(error);
        })
        .finally(() => {
          this.connecting = false;
          this.cached = undefined;
        });
    });
  }
}
function isHost(c: Context<AppEnvironment>): boolean {
  return (
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(c.req.url).hostname) &&
    (!c.env?.remoteAddress || ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(c.env.remoteAddress))
  );
}
export function mountModels(app: Hono<AppEnvironment>, services: ModelServices) {
  app.get("/api/providers", (c) => c.json(services.config()));
  app.put("/api/providers", async (c) => {
    let value: unknown;
    try {
      value = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "Expected JSON" });
    }
    const parsed = WyrdConfig.safeParse(value);
    if (!parsed.success)
      throw new HTTPException(422, { message: "Please check provider and model settings" });
    // Secrets may be referenced by filename, never submitted inside provider configuration.
    for (const provider of Object.values(
      (value as { providers: Record<string, Record<string, unknown>> }).providers,
    )) {
      if (["apiKey", "access_token", "refresh_token", "password"].some((key) => key in provider))
        throw new HTTPException(422, {
          message: "Save keys through Connection; provider settings contain references only",
        });
    }
    for (const provider of Object.values(parsed.data.providers))
      if (provider.kind === "openai-compatible") {
        const url = new URL(provider.baseUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
          throw new HTTPException(422, {
            message: "Use an HTTP(S) provider endpoint without embedded credentials",
          });
      }
    services.save(parsed.data);
    return c.json(parsed.data);
  });
  app.get("/api/connection", (c) => c.json(services.status(c)));
  app.post("/api/providers/chatgpt/connect", async (c) => {
    if (!isHost(c))
      throw new HTTPException(403, {
        message: "Open Wyrd on the host PC using localhost to connect ChatGPT",
      });
    return c.json({ url: await services.connect() });
  });
  app.get("/api/providers/:id/models", async (c) => {
    if (services.offline) return c.json([{ id: "offline" }]);
    const id = c.req.param("id");
    const cfg = services.config();
    const provider = cfg.providers[id];
    if (!provider) throw new HTTPException(404, { message: "Provider not found" });
    try {
      const client = buildProviders({ ...cfg, providers: { [id]: provider } }, services.secrets)[id]!;
      return c.json((await client.listModels()).map((m) => ({ id: m.id })));
    } catch (error) {
      console.error("[list-models]", id, error);
      throw new HTTPException(422, {
        message: `Could not list models: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
  app.post("/api/providers/:id/secret", async (c) => {
    if (!isHost(c))
      throw new HTTPException(403, { message: "Add provider keys on the host PC using localhost" });
    if (services.offline)
      throw new HTTPException(409, { message: "Keys are unnecessary in offline preview" });
    const provider = services.config().providers[c.req.param("id")];
    const name = provider && "apiKeySecret" in provider ? provider.apiKeySecret : undefined;
    if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name))
      throw new HTTPException(422, { message: "This provider has no valid key reference" });
    const parsed = ProviderKeyInput.safeParse(await c.req.json());
    if (!parsed.success) throw new HTTPException(422, { message: "Enter the provider API key" });
    services.secrets.write(name, parsed.data.key);
    services.save(services.config());
    return c.json({ ok: true });
  });
  app.get("/api/usage", (c) => c.json(services.store.usage(c.req.query("from"), c.req.query("to"))));
}

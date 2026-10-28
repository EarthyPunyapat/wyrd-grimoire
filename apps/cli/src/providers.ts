import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type UsageRecord, WyrdConfig } from "@wyrd/core";
import {
  AnthropicProvider,
  ChatGptAuth,
  ChatGptPlanProvider,
  type ChatProvider,
  type FallbackNotice,
  OpenAICompatibleProvider,
  type Preset,
  type PresetModels,
  type PriceTable,
  presetRouting,
  RoleRouter,
  type Routing,
  SecretStore,
  type UsageSink,
} from "@wyrd/llm";
import { CliError } from "./errors.ts";

/**
 * Provider configuration for the terminal loop: `WYRD_HOME/config.json` plus secrets in
 * `WYRD_HOME/secrets/`. The server (M3) moves this into app.db and Settings → Models.
 */

export function wyrdHome(): string {
  if (process.env.WYRD_HOME) return process.env.WYRD_HOME;
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "Wyrd");
  return join(homedir(), ".wyrd");
}

export { WyrdConfig } from "@wyrd/core";

/** A starting config: fill in the model IDs (see `wyrd models <provider>`) and add the keys with `wyrd secret set`. */
export const EXAMPLE_CONFIG = {
  providers: {
    deepseek: {
      kind: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      apiKeySecret: "deepseek.key",
      thinking: "disabled",
    },
    "chatgpt-plan": { kind: "chatgpt-plan" },
    ollama: { kind: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1" },
  },
  preset: "balanced",
  models: {
    plan: { provider: "chatgpt-plan", model: "PICK-WITH: bun run wyrd models chatgpt-plan" },
    deepseek: { provider: "deepseek", model: "PICK-WITH: bun run wyrd models deepseek" },
  },
  routing: {},
  prices: { "chatgpt-plan/*": "plan" },
};

export function configPath(override?: string): string {
  return override ?? join(wyrdHome(), "config.json");
}

/** `allowPlaceholders` lets `wyrd models` run while the user is still choosing model IDs. */
export function loadConfig(path?: string, opts: { allowPlaceholders?: boolean } = {}): WyrdConfig {
  const p = configPath(path);
  if (!existsSync(p))
    throw new CliError(`No provider config at ${p}. Run \`bun run wyrd config init\` and edit it.`);
  const parsed = WyrdConfig.safeParse(JSON.parse(readFileSync(p, "utf8")));
  if (!parsed.success) {
    throw new CliError(
      `${p} is invalid:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  for (const [slot, t] of Object.entries(parsed.data.models)) {
    if (!opts.allowPlaceholders && t?.model.startsWith("PICK-WITH"))
      throw new CliError(`Pick a model for "${slot}" in ${p}: ${t.model.slice(10)}`);
  }
  return parsed.data;
}

export function initConfig(path?: string): string {
  const p = configPath(path);
  if (existsSync(p)) throw new CliError(`${p} already exists`);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, `${JSON.stringify(EXAMPLE_CONFIG, null, 2)}\n`);
  return p;
}

export const secretStore = () => new SecretStore(join(wyrdHome(), "secrets"));

export function chatGptAuth(secrets = secretStore()): ChatGptAuth {
  return new ChatGptAuth({ secrets, appName: "Wyrd Grimoire" });
}

export function buildProviders(cfg: WyrdConfig, secrets = secretStore()): Record<string, ChatProvider> {
  const out: Record<string, ChatProvider> = {};
  for (const [id, p] of Object.entries(cfg.providers)) {
    const key = (name: string | undefined) => {
      if (!name) return undefined;
      const v = secrets.read(name);
      if (!v)
        throw new CliError(`Provider ${id} needs its key: printf %s 'KEY' | bun run wyrd secret set ${name}`);
      return v;
    };
    if (p.kind === "openai-compatible") {
      const apiKey = key(p.apiKeySecret);
      out[id] = new OpenAICompatibleProvider({
        id,
        baseUrl: p.baseUrl,
        ...(apiKey ? { apiKey } : {}),
        ...(p.thinking ? { thinking: p.thinking } : {}),
        ...(p.unsupported ? { unsupported: p.unsupported } : {}),
      });
    } else if (p.kind === "chatgpt-plan") {
      out[id] = new ChatGptPlanProvider({ id, auth: chatGptAuth(secrets) });
    } else {
      out[id] = new AnthropicProvider({
        id,
        apiKey: key(p.apiKeySecret)!,
        ...(p.effort ? { effort: p.effort } : {}),
        ...(p.serverFallbacks !== undefined ? { serverFallbacks: p.serverFallbacks } : {}),
      });
    }
  }
  return out;
}

/** Appends usage records to WYRD_HOME/usage.jsonl (app.db's usage table arrives with the server). */
export class JsonlUsageSink implements UsageSink {
  constructor(private readonly file = join(wyrdHome(), "usage.jsonl")) {}
  record(r: UsageRecord): void {
    mkdirSync(join(this.file, ".."), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(r)}\n`);
  }
}

export function loadRouterFromConfig(opts: {
  path?: string;
  onFallback?: (n: FallbackNotice) => void;
}): RoleRouter {
  const cfg = loadConfig(opts.path);
  const providers = buildProviders(cfg);
  const routing: Routing = {
    ...presetRouting(cfg.preset as Preset, cfg.models as PresetModels),
    ...cfg.routing,
  };
  for (const role of ["parser", "narrator", "guard"] as const) {
    if (!routing[role])
      throw new CliError(
        `No route for the ${role} role: set "models" or "routing.${role}" in ${configPath(opts.path)}`,
      );
  }
  return new RoleRouter({
    providers,
    routing,
    prices: cfg.prices as PriceTable,
    usage: new JsonlUsageSink(),
    ...(opts.onFallback ? { onFallback: opts.onFallback } : {}),
  });
}

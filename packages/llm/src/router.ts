import type { Role } from "@wyrd/core";
import { collect } from "./collect.ts";
import type { ChatProvider, Completion, ErrorCode, GenerateRequest } from "./types.ts";
import { ProviderError } from "./types.ts";
import { estimateCost, type PriceTable, priceFor, type UsageSink } from "./usage.ts";

export type Target = { provider: string; model: string };
export type RoleRoute = Target & { fallbacks: Target[] };
export type Routing = Partial<Record<Role, RoleRoute>>;

/** Per-role reliability defaults (spec 08, "Reliability"). */
export const ROLE_TIMEOUTS_MS: Record<Role, number> = {
  parser: 20_000,
  narrator: 60_000,
  npcDialogue: 60_000,
  worldGen: 30_000,
  sessionZero: 60_000,
  guard: 20_000,
  gm: 90_000,
  check: 20_000,
  summarizer: 60_000,
  embeddings: 20_000,
};

/** Errors worth retrying on the same target. */
const RETRY_SAME: ReadonlySet<ErrorCode> = new Set(["timeout", "server", "network", "rate_limited"]);
/** Errors that put a provider out of action for a while: never retried in a loop (spec 09). */
const BENCH: ReadonlySet<ErrorCode> = new Set(["usage_limit", "not_eligible", "auth"]);

export type FallbackNotice = { role: Role; from: Target; to: Target; reason: ErrorCode };

export type CallOptions = {
  promptVersion: string;
  campaignId?: string;
  turnId?: string;
  timeoutMs?: number;
  /** Extra attempts on the same target for retryable errors. Default 1. */
  retries?: number;
  onText?: (delta: string) => void;
  maxChars?: number;
  /** Hard output-token cap for a call (large tool-call JSON needs headroom). */
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type RoutedCompletion = Completion & Target;

export type RouterOptions = {
  providers: Record<string, ChatProvider>;
  routing: Routing;
  prices?: PriceTable;
  usage?: UsageSink;
  now?: () => number;
  /** A role moved to a fallback because of a limit or failure: the UI shows one small toast. */
  onFallback?: (n: FallbackNotice) => void;
  /** How long a provider stays benched after a usage-limit or auth error. Default 1 hour. */
  benchMs?: number;
};

/**
 * Routes each role to its provider and model, walking the fallback chain on failure, and writes
 * one usage record per attempt. Never loops on a plan usage limit: it benches that provider.
 */
export class RoleRouter {
  private readonly benchedUntil = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly opts: RouterOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** True when the role has a route, so callers can choose a pipeline without catching. */
  has(role: Role): boolean {
    return Boolean(this.opts.routing[role]);
  }

  route(role: Role): RoleRoute {
    const r = this.opts.routing[role];
    if (!r) throw new ProviderError("bad_request", `No route configured for role ${role}`, false);
    return r;
  }

  isBenched(providerId: string): boolean {
    return (this.benchedUntil.get(providerId) ?? 0) > this.now();
  }

  async complete(
    role: Role,
    req: Omit<GenerateRequest, "role" | "model" | "signal">,
    opts: CallOptions,
  ): Promise<RoutedCompletion> {
    const route = this.route(role);
    const chain: Target[] = [{ provider: route.provider, model: route.model }, ...route.fallbacks];
    let lastError: ProviderError | undefined;
    let previous: Target | undefined;

    for (const target of chain) {
      if (this.isBenched(target.provider)) continue;
      const provider = this.opts.providers[target.provider];
      if (!provider) continue;
      if (previous && lastError)
        this.opts.onFallback?.({ role, from: previous, to: target, reason: lastError.code });

      const attempts = 1 + (opts.retries ?? 1);
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          return { ...(await this.attempt(provider, target, role, req, opts)), ...target };
        } catch (e) {
          lastError =
            e instanceof ProviderError
              ? e
              : new ProviderError("network", (e as Error).message, true, target.provider);
          if (opts.signal?.aborted) throw lastError;
          if (BENCH.has(lastError.code)) {
            this.benchedUntil.set(target.provider, this.now() + (this.opts.benchMs ?? 3_600_000));
            break;
          }
          const regenerate = lastError.code === "invalid_output" && lastError.retryable;
          if (!RETRY_SAME.has(lastError.code) && !regenerate) break;
        }
      }
      previous = target;
    }
    throw lastError ?? new ProviderError("bad_request", `No available provider for role ${role}`, false);
  }

  private async attempt(
    provider: ChatProvider,
    target: Target,
    role: Role,
    req: Omit<GenerateRequest, "role" | "model" | "signal">,
    opts: CallOptions,
  ): Promise<Completion> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort);
    const timeoutMs = opts.timeoutMs ?? ROLE_TIMEOUTS_MS[role];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const started = this.now();
    const base = {
      at: new Date(started).toISOString(),
      ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
      ...(opts.turnId ? { turnId: opts.turnId } : {}),
      role,
      provider: target.provider,
      model: target.model,
      promptVersion: opts.promptVersion,
    };
    try {
      const completion = await collect(
        provider.generate({
          ...req,
          role,
          model: target.model,
          ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
          signal: controller.signal,
        }),
        {
          provider: target.provider,
          ...(opts.onText ? { onText: opts.onText } : {}),
          ...(opts.maxChars ? { maxChars: opts.maxChars } : {}),
        },
      );
      if (timedOut)
        throw new ProviderError("timeout", `${role} timed out after ${timeoutMs} ms`, true, target.provider);
      this.opts.usage?.record({
        ...base,
        ...completion.usage,
        latencyMs: this.now() - started,
        costEstimate: estimateCost(
          priceFor(this.opts.prices ?? {}, target.provider, target.model),
          completion.usage,
        ),
        ok: true,
      });
      return completion;
    } catch (e) {
      const err =
        timedOut && !(e instanceof ProviderError && e.code === "timeout")
          ? new ProviderError("timeout", `${role} timed out after ${timeoutMs} ms`, true, target.provider)
          : e instanceof ProviderError
            ? e
            : new ProviderError("network", (e as Error).message, true, target.provider);
      this.opts.usage?.record({
        ...base,
        input: 0,
        cachedInput: 0,
        output: 0,
        latencyMs: this.now() - started,
        costEstimate: 0,
        ok: false,
        errorCode: err.code,
      });
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export type Preset = "single" | "balanced" | "cheap" | "maxQuality" | "fullyLocal";

/** Model IDs come from config (never hard-coded); a preset only decides which provider plays which role. */
export type PresetModels = {
  plan?: Target; // ChatGPT plan, e.g. { provider: "chatgpt-plan", model: <picked by the user> }
  deepseek?: Target;
  anthropic?: Target;
  local?: Target;
  best?: Target; // "best model available" for Max quality
};

const TEXT_ROLES = [
  "parser",
  "narrator",
  "npcDialogue",
  "worldGen",
  "sessionZero",
  "guard",
  "gm",
  "check",
  "summarizer",
] as const;
const PROSE_ROLES: ReadonlySet<Role> = new Set(["narrator", "npcDialogue", "worldGen", "sessionZero", "gm"]);

/**
 * Builds routing from a preset (spec 09). Default chains: plan roles → DeepSeek → Anthropic;
 * DeepSeek roles → plan → local. Targets that aren't configured are left out.
 */
export function presetRouting(preset: Preset, m: PresetModels): Routing {
  const routing: Routing = {};
  const chain = (...ts: Array<Target | undefined>): RoleRoute | undefined => {
    const seen = new Set<string>();
    const list = ts.filter((t): t is Target => {
      if (!t) return false;
      // A placeholder or empty model is not a usable route; let the next target win.
      if (!t.model.trim() || t.model.startsWith("PICK-WITH")) return false;
      const key = `${t.provider}/${t.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const [first, ...rest] = list;
    return first ? { ...first, fallbacks: rest } : undefined;
  };
  for (const role of TEXT_ROLES) {
    const prose = PROSE_ROLES.has(role);
    let r: RoleRoute | undefined;
    switch (preset) {
      case "single":
        r = chain(m.deepseek, m.plan, m.local, m.best, m.anthropic);
        break;
      case "balanced":
        r = prose ? chain(m.plan, m.deepseek, m.anthropic) : chain(m.deepseek, m.plan, m.local);
        break;
      case "cheap":
        r = chain(m.deepseek, m.local, m.plan);
        break;
      case "maxQuality":
        r = chain(m.best, m.plan, m.anthropic, m.deepseek);
        break;
      case "fullyLocal":
        r = chain(m.local);
        break;
    }
    if (r) routing[role] = r;
  }
  return routing;
}

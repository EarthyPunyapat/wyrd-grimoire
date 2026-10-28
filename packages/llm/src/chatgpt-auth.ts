import { createHash, randomBytes, randomUUID, webcrypto } from "node:crypto";
import type { SecretStore } from "./secrets.ts";
import { ProviderError } from "./types.ts";

/**
 * "Sign in with ChatGPT" for open-source apps (spec 09), following OpenAI's token-sharing guide
 * (developers.openai.com/siwc/token-sharing-open-source, checked 2026-10-28): OAuth 2.0
 * authorization code + PKCE, public client, dynamic registration on first sign-in, loopback
 * redirect on 127.0.0.1, rotating refresh tokens stored atomically.
 *
 * VERIFY before relying on: the refresh request's exact form fields (the guide links to it but
 * doesn't spell it out; this uses the standard OAuth refresh grant plus `resource`) and the JWKS
 * location (found through OpenID discovery).
 */
export const SIWC = {
  issuer: "https://auth.openai.com",
  authorize: "https://auth.openai.com/api/accounts/authorize",
  token: "https://auth.openai.com/api/accounts/oauth/token",
  discovery: "https://auth.openai.com/.well-known/openid-configuration",
  resource: "https://api.openai.com/v1",
  scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
  planScope: "chatgpt.tokens.use.direct",
  registrationClientId: "dynamic_agent_client",
  defaultPort: 1455,
  callbackPath: "/auth/callback",
} as const;

const RECORD = "chatgpt-plan.json";
const HOST_ID = "chatgpt-host-id";

/** Refresh errors that mean the token set is dead and the user must sign in again. */
const TERMINAL_REFRESH = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

export type ChatGptRecord = {
  issuer: string;
  subject: string;
  email?: string;
  client_id: string;
  ext_agent_host_id: string;
  id_token: string;
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_at: number; // epoch ms
  scopes: string[];
  saved_at: string;
  /** False when the user signed in but didn't grant plan usage. */
  plan_usage: boolean;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

const b64url = (buf: Buffer | Uint8Array) => Buffer.from(buf).toString("base64url");

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
}

export type AuthDeps = {
  secrets: SecretStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** App name shown on OpenAI's consent page at first registration. */
  appName?: string;
};

export class ChatGptAuth {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private refreshing: Promise<ChatGptRecord> | null = null;

  constructor(private readonly d: AuthDeps) {
    this.fetch = d.fetch ?? fetch;
    this.now = d.now ?? Date.now;
  }

  record(): ChatGptRecord | null {
    return this.d.secrets.readJson<ChatGptRecord>(RECORD);
  }

  isConnected(): boolean {
    return this.record()?.plan_usage === true;
  }

  /** A random host identifier, generated once per machine and reused (the guide requires a stable one). */
  hostId(): string {
    const existing = this.d.secrets.read(HOST_ID);
    if (existing) return existing;
    const id = `urn:uuid:${randomUUID()}`;
    this.d.secrets.write(HOST_ID, id);
    return id;
  }

  disconnect(): void {
    this.d.secrets.delete(RECORD);
  }

  /**
   * Interactive sign-in on the host PC. Opens a temporary listener on 127.0.0.1 (never
   * `localhost`), hands the authorize URL to `open`, and waits for the callback.
   */
  async connect(opts: {
    open: (url: string) => void;
    port?: number;
    timeoutMs?: number;
  }): Promise<ChatGptRecord> {
    const prior = this.record();
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const state = b64url(randomBytes(16));
    const nonce = b64url(randomBytes(16));

    let resolveCb!: (u: URL) => void;
    const callback = new Promise<URL>((r) => {
      resolveCb = r;
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: opts.port ?? SIWC.defaultPort,
      fetch: (r) => {
        const url = new URL(r.url);
        if (url.pathname !== SIWC.callbackPath) return new Response("Not found", { status: 404 });
        resolveCb(url);
        return new Response("<p>Wyrd Grimoire is connected to ChatGPT. You can close this tab.</p>", {
          headers: { "content-type": "text/html" },
        });
      },
    });
    const redirectUri = `http://127.0.0.1:${server.port}${SIWC.callbackPath}`;
    try {
      const q = new URLSearchParams({
        response_type: "code",
        client_id: prior?.client_id ?? SIWC.registrationClientId,
        redirect_uri: redirectUri,
        scope: SIWC.scope,
        resource: SIWC.resource,
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        ext_agent_host_id: this.hostId(),
      });
      if (!prior) q.set("agent_name_hint", this.d.appName ?? "Wyrd Grimoire");
      if (prior?.id_token) q.set("id_token_hint", prior.id_token);
      if (prior?.email) q.set("login_hint", prior.email);
      opts.open(`${SIWC.authorize}?${q}`);

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Sign-in timed out")), opts.timeoutMs ?? 300_000),
      );
      const url = await Promise.race([callback, timeout]);
      const p = url.searchParams;
      if (p.get("state") !== state) throw new Error("Sign-in state didn't match; try again");
      if (p.get("error")) throw new Error(`Sign-in was not completed: ${p.get("error")}`);
      const code = p.get("code");
      if (!code) throw new Error("Sign-in returned no code");
      const issued = p.get("client_id");
      if (prior && issued && issued !== prior.client_id)
        throw new Error("Sign-in returned a different client ID; rejected");
      const clientId = issued ?? prior?.client_id;
      if (!clientId) throw new Error("Registration incomplete: no client ID was issued");

      const tokens = await this.tokenRequest({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: SIWC.resource,
      });
      if (!tokens.id_token || !tokens.refresh_token)
        throw new Error("Token response is missing an ID or refresh token");
      const claims = await this.verifyIdToken(tokens.id_token, clientId, nonce);
      return this.save(tokens, clientId, claims, tokens.id_token);
    } finally {
      // Graceful stop, so the browser still receives the "you can close this tab" page.
      void server.stop();
    }
  }

  /** A fresh access token, refreshing (single-flight) when it expires within a minute. */
  async accessToken(): Promise<string> {
    const rec = this.record();
    if (!rec)
      throw new ProviderError(
        "auth",
        "ChatGPT isn't connected: run `wyrd connect chatgpt` on the host PC",
        false,
        "chatgpt-plan",
      );
    if (!rec.plan_usage) {
      throw new ProviderError(
        "not_eligible",
        "ChatGPT is connected but plan usage wasn't granted",
        false,
        "chatgpt-plan",
      );
    }
    if (rec.expires_at - this.now() > 60_000) return rec.access_token;
    return (await this.refresh()).access_token;
  }

  /** Forces a refresh (e.g. after a 401). Concurrent callers share one request, so a rotated token is used once. */
  refresh(): Promise<ChatGptRecord> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<ChatGptRecord> {
    const rec = this.record();
    if (!rec) throw new ProviderError("auth", "ChatGPT isn't connected", false, "chatgpt-plan");
    let tokens: TokenResponse;
    try {
      tokens = await this.tokenRequest({
        grant_type: "refresh_token",
        client_id: rec.client_id,
        refresh_token: rec.refresh_token,
        resource: SIWC.resource,
      });
    } catch (e) {
      if (e instanceof RefreshError && TERMINAL_REFRESH.has(e.code)) {
        // Keep the client ID and identity for the next sign-in; drop the dead tokens.
        this.d.secrets.writeJson(RECORD, {
          ...rec,
          access_token: "",
          refresh_token: "",
          expires_at: 0,
          plan_usage: false,
        });
        throw new ProviderError(
          "auth",
          "ChatGPT sign-in expired: run `wyrd connect chatgpt` again",
          false,
          "chatgpt-plan",
        );
      }
      throw new ProviderError(
        "network",
        `Token refresh failed: ${(e as Error).message}`,
        true,
        "chatgpt-plan",
      );
    }
    const claims = tokens.id_token
      ? decodeJwtPart<{ sub?: string; email?: string }>(tokens.id_token.split(".")[1]!)
      : {};
    // Access token, expiry, scopes and the rotated refresh token are replaced together, atomically.
    return this.save(
      tokens,
      rec.client_id,
      { sub: claims.sub ?? rec.subject, email: claims.email ?? rec.email },
      tokens.id_token ?? rec.id_token,
      rec,
    );
  }

  private save(
    t: TokenResponse,
    clientId: string,
    claims: { sub?: string; email?: string | undefined },
    idToken: string,
    prior?: ChatGptRecord,
  ): ChatGptRecord {
    const scopes = t.scope ? t.scope.split(/\s+/).filter(Boolean) : (prior?.scopes ?? []);
    const rec: ChatGptRecord = {
      issuer: SIWC.issuer,
      subject: claims.sub ?? prior?.subject ?? "",
      ...(claims.email ? { email: claims.email } : {}),
      client_id: clientId,
      ext_agent_host_id: this.hostId(),
      id_token: idToken,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? prior?.refresh_token ?? "",
      token_type: "Bearer",
      expires_at: this.now() + (t.expires_in ?? 3600) * 1000,
      scopes,
      saved_at: new Date(this.now()).toISOString(),
      // A valid ID token alone doesn't grant plan usage: the scope must be present.
      plan_usage: scopes.includes(SIWC.planScope),
    };
    this.d.secrets.writeJson(RECORD, rec);
    return rec;
  }

  private async tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    const res = await this.fetch(SIWC.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // non-JSON error body
    }
    if (!res.ok) {
      const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
      throw new RefreshError(
        code,
        this.d.secrets.redact(String(body.error_description ?? text).slice(0, 300)),
      );
    }
    if (typeof body.access_token !== "string") throw new Error("Token response has no access token");
    return body as unknown as TokenResponse;
  }

  /** Verifies the ID token's signature against OpenAI's published keys, plus issuer, audience, expiry and nonce. */
  async verifyIdToken(
    token: string,
    clientId: string,
    nonce: string,
  ): Promise<{ sub: string; email?: string }> {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) throw new Error("Malformed ID token");
    const header = decodeJwtPart<{ alg: string; kid?: string }>(h);
    const claims = decodeJwtPart<{
      iss: string;
      aud: string | string[];
      exp: number;
      nonce?: string;
      sub: string;
      email?: string;
    }>(p);
    if (header.alg !== "RS256") throw new Error(`Unsupported ID token algorithm ${header.alg}`);

    const discovery = (await (await this.fetch(SIWC.discovery)).json()) as { jwks_uri: string };
    const jwks = (await (await this.fetch(discovery.jwks_uri)).json()) as {
      keys: Array<Record<string, unknown> & { kid?: string }>;
    };
    const jwk = jwks.keys.find((k) => !header.kid || k.kid === header.kid);
    if (!jwk) throw new Error("No signing key matches the ID token");
    const key = await webcrypto.subtle.importKey(
      "jwk",
      jwk as webcrypto.JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await webcrypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      Buffer.from(s, "base64url"),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) throw new Error("ID token signature is invalid");

    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== SIWC.issuer) throw new Error(`Unexpected ID token issuer ${claims.iss}`);
    if (!aud.includes(clientId)) throw new Error("ID token audience doesn't match the client ID");
    if (claims.exp * 1000 < this.now()) throw new Error("ID token has expired");
    if (claims.nonce !== nonce) throw new Error("ID token nonce doesn't match");
    return { sub: claims.sub, ...(claims.email ? { email: claims.email } : {}) };
  }
}

class RefreshError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

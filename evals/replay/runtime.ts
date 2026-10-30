import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProviders, JsonlUsageSink } from "../../apps/cli/src/providers.ts";
import { WyrdConfig } from "../../packages/core/src/index.ts";
import { presetRouting, RoleRouter, SecretStore } from "../../packages/llm/src/index.ts";
import { AppStore } from "../../packages/storage/src/index.ts";

/** Only these deliberately authored messages are safe to print on the terminal. */
export class ReplaySetupError extends Error {}

/** Read-only SQLite serialization includes committed WAL data, unlike copying just the .db file. */
export function snapshotDatabase(path: string): Uint8Array {
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true, strict: true });
    return db.serialize();
  } catch {
    throw new ReplaySetupError("Could not snapshot database. Check --campaign and WYRD_HOME on the host.");
  } finally {
    db?.close();
  }
}

export function readReplayConfig(o: { home: string; config?: string }): WyrdConfig {
  try {
    if (o.config) return WyrdConfig.parse(JSON.parse(readFileSync(o.config, "utf8")));
    const appPath = join(o.home, "app.db");
    if (existsSync(appPath)) {
      const dir = mkdtempSync(join(tmpdir(), "wyrd-replay-config-"));
      let app: AppStore | undefined;
      try {
        const path = join(dir, "app.db");
        writeFileSync(path, snapshotDatabase(appPath), { mode: 0o600 });
        app = new AppStore(path);
        const cfg = app.providerConfig();
        if (cfg) return WyrdConfig.parse(cfg);
      } finally {
        app?.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
    return WyrdConfig.parse(JSON.parse(readFileSync(join(o.home, "config.json"), "utf8")));
  } catch {
    throw new ReplaySetupError(
      "Provider settings unavailable or invalid. Configure Models on the host, or pass --config.",
    );
  }
}

export function createReplayRouter(cfg: WyrdConfig, home: string): RoleRouter {
  const routing = { ...presetRouting(cfg.preset, cfg.models), ...cfg.routing };
  if (!routing.gm)
    throw new ReplaySetupError("Configure a real GM model in Models before running the replay.");
  for (const route of Object.values(routing)) {
    for (const target of [route, ...route.fallbacks]) {
      if (!cfg.providers[target.provider] || !target.model.trim() || target.model.startsWith("PICK-WITH"))
        throw new ReplaySetupError(
          "A model route is missing its provider or model. Check Models on the host.",
        );
    }
  }
  try {
    return new RoleRouter({
      providers: buildProviders(cfg, new SecretStore(join(home, "secrets"))),
      routing,
      prices: cfg.prices,
      usage: new JsonlUsageSink(join(home, "usage.jsonl")),
    });
  } catch {
    throw new ReplaySetupError(
      "Provider credentials unavailable. Configure Connection on the host before running the replay.",
    );
  }
}

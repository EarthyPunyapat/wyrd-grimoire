import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WyrdConfig } from "../../../packages/core/src/index.ts";
import { AppStore } from "../../../packages/storage/src/index.ts";
import { createReplayRouter, readReplayConfig } from "../runtime.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const config = (model: string) =>
  WyrdConfig.parse({
    providers: { local: { kind: "openai-compatible", baseUrl: "http://localhost:11434/v1" } },
    models: { local: { provider: "local", model } },
    preset: "single",
  });

test("web settings outrank legacy config; explicit config overrides both without touching app.db", () => {
  const home = mkdtempSync(join(tmpdir(), "wyrd-config-test-"));
  dirs.push(home);
  writeFileSync(join(home, "config.json"), JSON.stringify(config("legacy")));
  expect(readReplayConfig({ home }).models.local?.model).toBe("legacy");
  const app = new AppStore(join(home, "app.db"));
  try {
    app.saveProviderConfig(config("web"));
    const before = readFileSync(join(home, "app.db-wal"));
    expect(readReplayConfig({ home }).models.local?.model).toBe("web");
    expect(readFileSync(join(home, "app.db-wal"))).toEqual(before);
    expect(readReplayConfig({ home, config: join(home, "config.json") }).models.local?.model).toBe("legacy");
    expect(readdirSync(home).sort()).toEqual(["app.db", "app.db-shm", "app.db-wal", "config.json"]);
  } finally {
    app.close();
  }
});

test("real eval router rejects absent, placeholder and unknown provider GM routes", () => {
  const home = mkdtempSync(join(tmpdir(), "wyrd-config-test-"));
  dirs.push(home);
  const good = config("configured-model");
  expect(createReplayRouter(good, home).route("gm").model).toBe("configured-model");
  expect(() => createReplayRouter({ ...good, models: {}, routing: {} }, home)).toThrow();
  expect(() => createReplayRouter(config("PICK-WITH: models"), home)).toThrow();
  expect(() =>
    createReplayRouter(
      { ...good, routing: { gm: { provider: "missing", model: "x", fallbacks: [] } } },
      home,
    ),
  ).toThrow();
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRouterFromConfig, secretStore, WyrdConfig } from "../src/providers.ts";

let dir: string;
const prev = process.env.WYRD_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wyrd-home-"));
  process.env.WYRD_HOME = dir;
});
afterEach(() => {
  if (prev === undefined) delete process.env.WYRD_HOME;
  else process.env.WYRD_HOME = prev;
  rmSync(dir, { recursive: true, force: true });
});

const config = (models: Record<string, unknown>) =>
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      providers: {
        deepseek: {
          kind: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKeySecret: "deepseek.key",
        },
        "chatgpt-plan": { kind: "chatgpt-plan" },
      },
      preset: "balanced",
      models,
    }),
  );

test("provider config preserves an explicit DeepSeek thinking-mode setting", () => {
  const cfg = WyrdConfig.parse({
    providers: {
      deepseek: { kind: "openai-compatible", baseUrl: "https://api.deepseek.com", thinking: "disabled" },
    },
  });
  expect(cfg.providers.deepseek).toMatchObject({ thinking: "disabled" });
});

test("a filled-in config builds the Balanced routing with the spec's fallback chains", () => {
  config({
    plan: { provider: "chatgpt-plan", model: "sol" },
    deepseek: { provider: "deepseek", model: "ds-flash" },
  });
  secretStore().write("deepseek.key", "sk-test-0123456789");
  const router = loadRouterFromConfig({});
  expect(router.route("narrator")).toEqual({
    provider: "chatgpt-plan",
    model: "sol",
    fallbacks: [{ provider: "deepseek", model: "ds-flash" }],
  });
  expect(router.route("parser")).toEqual({
    provider: "deepseek",
    model: "ds-flash",
    fallbacks: [{ provider: "chatgpt-plan", model: "sol" }],
  });
});

test("a missing key names the command that adds it", () => {
  config({ deepseek: { provider: "deepseek", model: "ds-flash" } });
  expect(() => loadRouterFromConfig({})).toThrow(/wyrd secret set deepseek.key/);
});

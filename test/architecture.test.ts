/**
 * Enforces the dependency rules from docs/spec/01-architecture.md and the pure-engine invariant
 * from AGENTS.md, by reading package manifests and source imports.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Which workspace packages each package may import (spec 01, "Dependency rules"). */
const ALLOWED: Record<string, string[]> = {
  core: [],
  engine: ["core"],
  packs: ["core", "engine"],
  storage: ["core"],
  memory: ["core", "engine", "storage"],
  llm: ["core", "engine", "memory"],
  media: ["core"],
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const importsOf = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g)].map((m) => m[1]!);

const packages = readdirSync(join(ROOT, "packages")).filter((p) =>
  statSync(join(ROOT, "packages", p)).isDirectory(),
);

describe("dependency rules", () => {
  for (const pkg of packages) {
    test(`${pkg} only depends on ${ALLOWED[pkg]?.join(", ") || "nothing internal"}`, () => {
      expect(ALLOWED[pkg]).toBeDefined();
      const allowed = new Set((ALLOWED[pkg] ?? []).map((p) => `@wyrd/${p}`));
      const manifest = JSON.parse(readFileSync(join(ROOT, "packages", pkg, "package.json"), "utf8"));
      const declared = Object.keys(manifest.dependencies ?? {}).filter((d) => d.startsWith("@wyrd/"));
      expect(declared.filter((d) => !allowed.has(d))).toEqual([]);

      const violations: string[] = [];
      for (const file of walk(join(ROOT, "packages", pkg, "src"))) {
        for (const spec of importsOf(file)) {
          const internal = spec.match(/^@wyrd\/([^/]+)/);
          if (internal && !allowed.has(`@wyrd/${internal[1]}`))
            violations.push(`${relative(ROOT, file)} → ${spec}`);
          if (spec.startsWith("../../"))
            violations.push(`${relative(ROOT, file)} reaches into another package: ${spec}`);
        }
      }
      expect(violations).toEqual([]);
    });
  }
});

describe("pure engine", () => {
  const sources = [...walk(join(ROOT, "packages/engine/src")), ...walk(join(ROOT, "packages/core/src"))];

  test("engine and core do no IO and read no clock or global randomness", () => {
    const forbidden: Array<[RegExp, string]> = [
      [/\bMath\.random\b/, "Math.random"],
      [/\bDate\.now\b|\bnew Date\(/, "the wall clock"],
      [/\bperformance\.now\b/, "the wall clock"],
      [/\bfetch\(/, "the network"],
      [/\bBun\.(file|write|spawn|serve|connect)\b/, "Bun IO"],
      [/\bprocess\.(env|argv|stdout|stderr)\b/, "process globals"],
      [/\bcrypto\.(getRandomValues|randomUUID)\b/, "global randomness"],
    ];
    const forbiddenModules =
      /^(node:)?(fs|fs\/promises|net|http|https|child_process|os|crypto|path|bun:sqlite)$/;
    const violations: string[] = [];
    for (const file of sources) {
      // Comments may mention forbidden APIs (e.g. "callers pass Date.now"); only code counts.
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      for (const [re, what] of forbidden)
        if (re.test(text)) violations.push(`${relative(ROOT, file)} uses ${what}`);
      for (const spec of importsOf(file)) {
        if (forbiddenModules.test(spec)) violations.push(`${relative(ROOT, file)} imports ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

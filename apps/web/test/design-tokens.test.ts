import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Wyrd 2.0 tokens are CSS custom properties so U3–U6 can consume them without a runtime
 * theme layer. These tests read the same file the browser does and enforce the two promises
 * the design system makes: every preset ships a complete palette, and every readable colour
 * stays above WCAG AA on its ground.
 */
const css = readFileSync(join(import.meta.dir, "../src/tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A selector can also appear at the end of a shared selector list; the preset's own block
  // is the last match.
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "gs"))];
  const match = matches.at(-1);
  if (!match) throw new Error(`missing ${selector}`);
  const out: Record<string, string> = {};
  for (const line of match[1]!.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const declaration = /^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (declaration) out[declaration[1]!] = declaration[2]!;
  }
  return out;
}

function vars(preset?: "reader" | "cockpit" | "chat"): Record<string, string> {
  return { ...block(":root"), ...(preset ? block(`[data-preset="${preset}"]`) : {}) };
}

function resolve(all: Record<string, string>, name: string, depth = 0): string {
  const value = all[name];
  if (!value) throw new Error(`missing ${name}`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!alias) return value.trim();
  if (depth > 8) throw new Error(`var cycle at ${name}`);
  return resolve(all, alias[1]!, depth + 1);
}

function lum(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PRESETS = ["reader", "cockpit", "chat"] as const;
const REQUIRED = [
  "--bg",
  "--surface",
  "--surface-2",
  "--line",
  "--line-strong",
  "--ink",
  "--ink-muted",
  "--ink-faint",
  "--accent",
  "--accent-soft",
  "--accent-ink",
  "--crit",
  "--success",
  "--failure",
  "--danger",
  "--danger-soft",
  "--ally",
  "--enemy",
  "--pc",
  "--link",
  "--selection",
  "--font-chrome",
  "--font-read",
  "--font-display",
  "--font-ui",
  "--font-body",
  "--font-mono",
  "--text-chapter-numeral",
  "--text-title",
  "--text-prose",
  "--leading-prose",
  "--text-choice",
  "--text-input",
  "--text-meta",
  "--leading-meta",
  "--measure",
  "--rail",
  "--gutter",
  "--rhythm",
  "--status-height",
  "--hotbar-height",
  "--radius-card",
  "--radius-control",
  "--radius-pill",
];

describe("Wyrd 2.0 theme tokens", () => {
  test("the default campaign hue is Lantern Green", () => {
    const all = vars("reader");
    expect(resolve(all, "--hue")).toBe("#3ddc97");
    expect(resolve(all, "--accent")).toBe("#3ddc97");
  });

  test("every preset ships every token", () => {
    for (const preset of PRESETS) {
      const all = vars(preset);
      for (const token of REQUIRED) expect(all[token], `${preset} ${token}`).toBeDefined();
    }
  });

  test("the three presets share the fixed signals and entity tints", () => {
    const first = vars("reader");
    for (const token of [
      "--gold",
      "--red",
      "--cyan",
      "--person",
      "--place",
      "--item",
      "--faction",
      "--companion",
    ]) {
      expect(resolve(first, token)).toBe(resolve(vars("cockpit"), token));
      expect(resolve(first, token)).toBe(resolve(vars("chat"), token));
    }
  });

  test("body and secondary text meet WCAG AA in every preset", () => {
    for (const preset of PRESETS) {
      const all = vars(preset);
      const bg = resolve(all, "--bg");
      const surface = resolve(all, "--surface");
      expect(contrast(resolve(all, "--ink"), bg), `${preset} ink`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(resolve(all, "--ink-muted"), surface), `${preset} muted`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(resolve(all, "--ink-faint"), bg), `${preset} faint`).toBeGreaterThanOrEqual(3);
    }
  });

  test("every meaning-bearing accent meets WCAG AA on the Reader ground", () => {
    const all = vars("reader");
    const bg = resolve(all, "--bg");
    for (const token of [
      "--gold",
      "--red",
      "--cyan",
      "--person",
      "--place",
      "--success",
      "--danger",
      "--link",
    ]) {
      expect(contrast(resolve(all, token), bg), token).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("all four campaign hues are readable text on every ground", () => {
    for (const preset of PRESETS) {
      const all = vars(preset);
      const bg = resolve(all, "--bg");
      for (const token of ["--hue-green", "--hue-gold", "--hue-red", "--hue-cyan"]) {
        expect(contrast(resolve(all, token), bg), `${preset} ${token}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("Reader pairs a serif reading slot with a monospace chrome slot", () => {
    const all = vars("reader");
    expect(resolve(all, "--font-read")).toContain("Newsreader");
    expect(resolve(all, "--font-chrome")).toContain("IBM Plex Mono");
    expect(resolve(all, "--font-read")).not.toBe(resolve(all, "--font-chrome"));
  });
});

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadPack } from "../src/loader.ts";

const FANTASY = join(import.meta.dir, "../../../packs/fantasy-core");

/** WCAG relative luminance and contrast ratio. */
function lum(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("fantasy-core theme", () => {
  const pack = loadPack(FANTASY).pack!;

  test("the pack carries both variants", () => {
    expect(pack.theme).toBeDefined();
    expect(pack.theme!.light.ink).toMatch(/^#[0-9a-f]{6}$/i);
    expect(pack.theme!.dark.ink).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("body text meets WCAG AA contrast in both variants", () => {
    for (const variant of [pack.theme!.light, pack.theme!.dark]) {
      expect(contrast(variant.ink, variant.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(variant.inkMuted, variant.surface)).toBeGreaterThanOrEqual(3);
    }
  });
});

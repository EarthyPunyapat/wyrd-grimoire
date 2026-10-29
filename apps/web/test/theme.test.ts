import { describe, expect, test } from "bun:test";
import { ThemeSpec } from "@wyrd/core";
import { themeVars } from "../src/theme.ts";

const theme = ThemeSpec.parse({
  light: {
    bg: "#ffffff",
    surface: "#fafafa",
    surface2: "#eeeeee",
    ink: "#111111",
    inkMuted: "#555555",
    accent: "#0044cc",
    crit: "#885500",
    success: "#226622",
    failure: "#664422",
    danger: "#aa0000",
    fontDisplay: "Georgia, serif",
    fontBody: "Georgia, serif",
    fontMono: "monospace",
    texture: "none",
  },
  dark: {
    bg: "#111111",
    surface: "#1a1a1a",
    surface2: "#222222",
    ink: "#eeeeee",
    inkMuted: "#bbbbbb",
    accent: "#88aaff",
    crit: "#ddbb55",
    success: "#88cc88",
    failure: "#ccbb99",
    danger: "#ff8888",
    fontDisplay: "Georgia, serif",
    fontBody: "Georgia, serif",
    fontMono: "monospace",
  },
});

describe("pack themes map to CSS variables", () => {
  test("the light variant maps every token", () => {
    const vars = themeVars(theme, false);
    expect(vars["--bg"]).toBe("#ffffff");
    expect(vars["--ink"]).toBe("#111111");
    expect(vars["--font-mono"]).toBe("monospace");
  });

  test("the dark variant is chosen for a dark UI", () => {
    const vars = themeVars(theme, true);
    expect(vars["--bg"]).toBe("#111111");
    expect(vars["--ink"]).toBe("#eeeeee");
  });

  test("no theme leaves the default palette alone", () => {
    expect(themeVars(null, true)).toEqual({});
  });
});

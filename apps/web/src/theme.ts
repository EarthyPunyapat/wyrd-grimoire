import type { ThemeSpec, ThemeVariant } from "@wyrd/core";

/**
 * Maps a pack theme to CSS custom properties (spec 13 Themes). Pure so it can be tested without a
 * DOM; the Play screen applies the result to `document.documentElement.style`.
 */
const VARS: Array<[keyof ThemeVariant, string]> = [
  ["bg", "--bg"],
  ["surface", "--surface"],
  ["surface2", "--surface-2"],
  ["ink", "--ink"],
  ["inkMuted", "--ink-muted"],
  ["accent", "--accent"],
  ["crit", "--crit"],
  ["success", "--success"],
  ["failure", "--failure"],
  ["danger", "--danger"],
  ["fontDisplay", "--font-display"],
  ["fontBody", "--font-body"],
  ["fontMono", "--font-mono"],
  ["texture", "--texture"],
];

export function themeVars(theme: ThemeSpec | null | undefined, dark: boolean): Record<string, string> {
  if (!theme) return {};
  const variant = dark ? theme.dark : theme.light;
  const out: Record<string, string> = {};
  for (const [key, cssVar] of VARS) {
    const value = variant[key];
    if (typeof value === "string" && value) out[cssVar] = value;
  }
  if (out["--texture"]) out["--theme-texture"] = out["--texture"]!;
  return out;
}

/** Keep the original light/dark default when no pack theme is present. */
export function clearThemeVars(style: CSSStyleDeclaration, vars: Record<string, string>) {
  for (const cssVar of Object.keys(vars)) style.removeProperty(cssVar);
}

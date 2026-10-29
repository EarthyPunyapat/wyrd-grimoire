import { z } from "zod";

/**
 * Pack theme tokens (spec 05 `theme.yaml`, spec 13 Themes). The web app maps these to CSS custom
 * properties; light and dark variants must both meet WCAG AA contrast.
 */

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a #rrggbb colour");

export const ThemeVariant = z.object({
  bg: Color,
  surface: Color,
  surface2: Color,
  ink: Color,
  inkMuted: Color,
  accent: Color,
  crit: Color,
  success: Color,
  failure: Color,
  danger: Color,
  fontDisplay: z.string().min(1).default("Georgia, serif"),
  fontBody: z.string().min(1).default("Georgia, serif"),
  fontMono: z.string().min(1).default("ui-monospace, monospace"),
  /** Optional CSS background image or gradient; no external URLs are fetched. */
  texture: z.string().optional(),
});
export type ThemeVariant = z.infer<typeof ThemeVariant>;

export const ThemeSpec = z.object({ light: ThemeVariant, dark: ThemeVariant });
export type ThemeSpec = z.infer<typeof ThemeSpec>;

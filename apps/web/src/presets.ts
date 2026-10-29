import { useCallback, useEffect, useState } from "react";

/**
 * UI 2.0 layout presets and reader dials (D150, spec §12).
 *
 * These are device preferences, like the theme and print size: they live in localStorage so the
 * owner can switch layout mid-campaign from Settings, and the server never has to know. Only the
 * preset changes layout; the dials scale the same tokens in every preset.
 */
export type UiPreset = "reader" | "cockpit" | "chat";
export type TextSize = "small" | "normal" | "large";
export type ColumnWidth = "narrow" | "normal" | "wide";
export type Density = "comfortable" | "compact";
export type Motion = "full" | "reduced" | "none";

export type PlayPreferences = {
  preset: UiPreset;
  textSize: TextSize;
  column: ColumnWidth;
  density: Density;
  motion: Motion;
};

export const PRESET_OPTIONS = [
  { id: "reader", label: "Reader", hint: "Night Codex: a book page with margin notes." },
  { id: "cockpit", label: "Cockpit", hint: "Qud Modern: dense chrome, a log and a watch list." },
  { id: "chat", label: "Chat", hint: "Lantern Glass: true black, rounded cards, a chat bubble." },
] as const satisfies readonly { id: UiPreset; label: string; hint: string }[];

export const TEXT_SIZE_OPTIONS = [
  { id: "small", label: "Small" },
  { id: "normal", label: "Standard" },
  { id: "large", label: "Large" },
] as const satisfies readonly { id: TextSize; label: string }[];

export const COLUMN_OPTIONS = [
  { id: "narrow", label: "Narrow" },
  { id: "normal", label: "Standard" },
  { id: "wide", label: "Wide" },
] as const satisfies readonly { id: ColumnWidth; label: string }[];

export const DENSITY_OPTIONS = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
] as const satisfies readonly { id: Density; label: string }[];

export const MOTION_OPTIONS = [
  { id: "full", label: "Full" },
  { id: "reduced", label: "Reduced" },
  { id: "none", label: "None" },
] as const satisfies readonly { id: Motion; label: string }[];

export const DEFAULT_PLAY_PREFERENCES: PlayPreferences = {
  preset: "reader",
  textSize: "normal",
  column: "normal",
  density: "comfortable",
  motion: "full",
};

export const PLAY_PREFERENCES_KEY = "wyrd-play-preferences";
export const PLAY_PREFERENCES_EVENT = "wyrd:play-preferences";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const PRESETS = PRESET_OPTIONS.map((option) => option.id);
const TEXT_SIZES = TEXT_SIZE_OPTIONS.map((option) => option.id);
const COLUMNS = COLUMN_OPTIONS.map((option) => option.id);
const DENSITIES = DENSITY_OPTIONS.map((option) => option.id);
const MOTIONS = MOTION_OPTIONS.map((option) => option.id);

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** A stored value from an older build, another tab or hand-edited storage still yields a usable preset. */
export function normalisePlayPreferences(value: unknown): PlayPreferences {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    preset: pick(record.preset, PRESETS, DEFAULT_PLAY_PREFERENCES.preset),
    textSize: pick(record.textSize, TEXT_SIZES, DEFAULT_PLAY_PREFERENCES.textSize),
    column: pick(record.column, COLUMNS, DEFAULT_PLAY_PREFERENCES.column),
    density: pick(record.density, DENSITIES, DEFAULT_PLAY_PREFERENCES.density),
    motion: pick(record.motion, MOTIONS, DEFAULT_PLAY_PREFERENCES.motion),
  };
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    // Private mode and blocked storage: preferences fall back to the defaults for this visit.
    return undefined;
  }
}

export function readPlayPreferences(storage: StorageLike | undefined = browserStorage()): PlayPreferences {
  try {
    const raw = storage?.getItem(PLAY_PREFERENCES_KEY);
    return raw ? normalisePlayPreferences(JSON.parse(raw)) : { ...DEFAULT_PLAY_PREFERENCES };
  } catch {
    return { ...DEFAULT_PLAY_PREFERENCES };
  }
}

export function savePlayPreferences(
  preferences: PlayPreferences,
  storage: StorageLike | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(PLAY_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    /* The preset still applies for this visit; only persistence is lost. */
  }
}

/**
 * The dials are data attributes on <html>, so every preset reads the same scales. The preset
 * itself is scoped to the play screen (Play sets it while mounted) so the home screen keeps its theme.
 */
export function applyPlayDials(root: HTMLElement, preferences: PlayPreferences): void {
  root.dataset.textSize = preferences.textSize;
  root.dataset.column = preferences.column;
  root.dataset.density = preferences.density;
  root.dataset.motion = preferences.motion;
}

export function announcePlayPreferences(preferences: PlayPreferences): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PLAY_PREFERENCES_EVENT, { detail: preferences }));
}

const same = (a: PlayPreferences, b: PlayPreferences) =>
  a.preset === b.preset &&
  a.textSize === b.textSize &&
  a.column === b.column &&
  a.density === b.density &&
  a.motion === b.motion;

/** Settings owns the state; the play screen and any other tab hear changes through one event. */
export function usePlayPreferences(): [PlayPreferences, (next: PlayPreferences) => void] {
  const [preferences, setPreferences] = useState(readPlayPreferences);
  useEffect(() => {
    savePlayPreferences(preferences);
    applyPlayDials(document.documentElement, preferences);
  }, [preferences]);
  useEffect(() => {
    const sync = () => {
      const next = readPlayPreferences();
      setPreferences((current) => (same(current, next) ? current : next));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PLAY_PREFERENCES_KEY) sync();
    };
    window.addEventListener(PLAY_PREFERENCES_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PLAY_PREFERENCES_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const update = useCallback((next: PlayPreferences) => {
    setPreferences(next);
    savePlayPreferences(next);
    applyPlayDials(document.documentElement, next);
    announcePlayPreferences(next);
  }, []);
  return [preferences, update];
}

/** The play screen only needs the preset; the dials are global attributes already applied by App. */
export function usePlayPreset(): UiPreset {
  const [preset, setPreset] = useState<UiPreset>(() => readPlayPreferences().preset);
  useEffect(() => {
    const sync = () => {
      const next = readPlayPreferences().preset;
      setPreset((current) => (current === next ? current : next));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PLAY_PREFERENCES_KEY) sync();
    };
    window.addEventListener(PLAY_PREFERENCES_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PLAY_PREFERENCES_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return preset;
}

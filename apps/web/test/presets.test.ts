import { describe, expect, test } from "bun:test";
import {
  applyPlayDials,
  COLUMN_OPTIONS,
  DEFAULT_PLAY_PREFERENCES,
  DENSITY_OPTIONS,
  MOTION_OPTIONS,
  normalisePlayPreferences,
  PLAY_PREFERENCES_KEY,
  PRESET_OPTIONS,
  readPlayPreferences,
  savePlayPreferences,
  TEXT_SIZE_OPTIONS,
} from "../src/presets.ts";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("UI 2.0 play preferences", () => {
  test("Reader, Standard and full motion are the defaults", () => {
    expect(DEFAULT_PLAY_PREFERENCES).toEqual({
      preset: "reader",
      textSize: "normal",
      column: "normal",
      density: "comfortable",
      motion: "full",
    });
    expect(readPlayPreferences(fakeStorage())).toEqual(DEFAULT_PLAY_PREFERENCES);
  });

  test("unknown or hand-edited values fall back field by field", () => {
    expect(
      normalisePlayPreferences({ preset: "holodeck", textSize: "large", column: 12, density: "compact" }),
    ).toEqual({
      preset: "reader",
      textSize: "large",
      column: "normal",
      density: "compact",
      motion: "full",
    });
    expect(normalisePlayPreferences(null)).toEqual(DEFAULT_PLAY_PREFERENCES);
    expect(normalisePlayPreferences("reader")).toEqual(DEFAULT_PLAY_PREFERENCES);
  });

  test("preferences round-trip through storage", () => {
    const storage = fakeStorage();
    const chosen = {
      preset: "cockpit" as const,
      textSize: "small" as const,
      column: "wide" as const,
      density: "compact" as const,
      motion: "none" as const,
    };
    savePlayPreferences(chosen, storage);
    expect(storage.values.get(PLAY_PREFERENCES_KEY)).toContain("cockpit");
    expect(readPlayPreferences(storage)).toEqual(chosen);
  });

  test("broken JSON and blocked storage never break the play screen", () => {
    expect(readPlayPreferences(fakeStorage({ [PLAY_PREFERENCES_KEY]: "{" }))).toEqual(
      DEFAULT_PLAY_PREFERENCES,
    );
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPlayPreferences(blocked)).toEqual(DEFAULT_PLAY_PREFERENCES);
    expect(() => savePlayPreferences(DEFAULT_PLAY_PREFERENCES, blocked)).not.toThrow();
  });

  test("the dials are data attributes on the root, one per scale", () => {
    const root = { dataset: {} as Record<string, string> };
    applyPlayDials(root as unknown as HTMLElement, {
      preset: "chat",
      textSize: "large",
      column: "narrow",
      density: "compact",
      motion: "reduced",
    });
    expect(root.dataset).toEqual({
      textSize: "large",
      column: "narrow",
      density: "compact",
      motion: "reduced",
    });
    expect(root.dataset.preset).toBeUndefined();
  });

  test("every option list offers a distinct, labelled choice", () => {
    for (const options of [
      PRESET_OPTIONS,
      TEXT_SIZE_OPTIONS,
      COLUMN_OPTIONS,
      DENSITY_OPTIONS,
      MOTION_OPTIONS,
    ]) {
      const ids = options.map((option) => option.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const option of options) expect(option.label.length).toBeGreaterThan(0);
    }
  });
});

import {
  CampaignSettings,
  draft,
  type EventDraft,
  type PresetName,
  presetToggles,
  stableStringify,
} from "@wyrd/core";
import { fail, ok, type Result, type RuleError } from "./result.ts";
import type { GameState } from "./state.ts";

/** A partial settings patch: any nested field may be omitted. */
export type SettingsPatch = { [K in keyof CampaignSettings]?: Patch<CampaignSettings[K]> };
type Patch<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: Patch<T[K]> } : T;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function merge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = merge(base[k], v);
  return out;
}

/** Dotted paths of every leaf that differs between two settings objects. */
export function changedPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => changedPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
  }
  return stableStringify(a) === stableStringify(b) ? [] : [prefix];
}

export type SettingsLock = { path: string; label: string; reason: string };

/**
 * What this campaign can no longer change (spec 12), with the reason the settings screen shows.
 * The engine is the authority: the API refuses these paths even if a client enables them.
 */
export function settingsLocks(
  current: CampaignSettings,
  options: { allowClasses?: boolean } = {},
): SettingsLock[] {
  const locks: SettingsLock[] = [
    {
      path: "structural.resolution",
      label: "Dice",
      reason: "The dice system is chosen at creation; changing it would rescale every skill",
    },
    {
      path: "structural.progression",
      label: "Progression",
      reason: "The progression mode is chosen at creation; its state isn't convertible",
    },
  ];
  if (!current.structural.hardcore)
    locks.push({
      path: "structural.hardcore",
      label: "Hardcore",
      reason: "Hardcore can only be turned on when the campaign is created",
    });
  if (options.allowClasses === false && current.structural.progression !== "classes")
    locks.push({
      path: "structural.progression.classes",
      label: "Classes",
      reason: "This campaign's pack has no class data",
    });
  if (current.flags.softcore)
    locks.push({
      path: "flags.softcore",
      label: "Softcore mark",
      reason: "Leaving hardcore is permanent",
    });
  if (current.flags.cheatEdited)
    locks.push({
      path: "flags.cheatEdited",
      label: "Modified campaign",
      reason: "The cheat-edit mark is permanent",
    });
  return locks;
}

/**
 * Lock rules (spec 12): dice and progression never change after creation; hardcore can be
 * turned off (which permanently marks the campaign softcore) but never on; the softcore and
 * cheat-edit marks can't be cleared. Hardcore forces companion death on.
 */
export function validateSettingsChange(current: CampaignSettings, next: CampaignSettings): RuleError[] {
  const errors: RuleError[] = [];
  const locked = (path: string, message: string) => errors.push({ code: "SETTING_LOCKED", path, message });
  if (next.structural.resolution !== current.structural.resolution) {
    locked("structural.resolution", "The dice system is chosen at creation and locked");
  }
  if (next.structural.progression !== current.structural.progression) {
    locked("structural.progression", "The progression mode is chosen at creation and locked");
  }
  if (next.structural.hardcore && !current.structural.hardcore) {
    locked("structural.hardcore", "Hardcore can only be turned on when the campaign is created");
  }
  if (current.flags.softcore && !next.flags.softcore)
    locked("flags.softcore", "The softcore mark is permanent");
  if (current.flags.cheatEdited && !next.flags.cheatEdited) {
    locked("flags.cheatEdited", "The cheat-edit mark is permanent");
  }
  if (current.structural.hardcore && next.structural.hardcore && !next.companionDeath) {
    errors.push({
      code: "SETTING_FORCED",
      path: "companionDeath",
      message: "Companion death is always on in hardcore",
    });
  }
  return errors;
}

/**
 * Applies a settings patch, enforcing locks. Selecting a preset with no explicit subsystem patch
 * sets that preset's toggles; changing toggles by hand marks the campaign "custom (from X)".
 * Turning hardcore off sets the permanent softcore flag.
 */
export function changeSettings(
  state: GameState,
  patch: SettingsPatch,
  options: { allowClasses?: boolean } = {},
): Result<EventDraft[]> {
  const current = state.campaign.settings;
  const merged = merge(current, patch) as Record<string, unknown>;
  // A preset is a shorthand for its toggles. An explicit subsystem change always wins.
  if (patch.preset && patch.preset !== "custom") {
    const sameSubsystems =
      !patch.subsystems || stableStringify(patch.subsystems) === stableStringify(current.subsystems);
    if (sameSubsystems) merged.subsystems = presetToggles(patch.preset as PresetName);
  }
  const parsed = CampaignSettings.safeParse(merged);
  if (!parsed.success) return fail("SETTINGS_INVALID", parsed.error.message);
  let next = parsed.data;
  if (next.structural.progression === "classes" && options.allowClasses === false)
    return fail("CLASSES_UNSUPPORTED", "This campaign's pack has no class data");
  if (current.structural.hardcore && !next.structural.hardcore) {
    next = { ...next, flags: { ...next.flags, softcore: true } };
  }
  // Changing toggles by hand makes the preset custom; picking one keeps its name.
  if (
    next.preset !== "custom" &&
    stableStringify(next.subsystems) !== stableStringify(presetToggles(next.preset))
  ) {
    next = { ...next, preset: "custom" };
  }
  const errors = validateSettingsChange(current, next);
  if (errors.length > 0) return { ok: false, errors };
  const changed = changedPaths(current, next);
  if (changed.length === 0) return ok([]);
  return ok([draft("SettingsChanged", { settings: next, changed }, "player")]);
}

import { CampaignSettings, draft, type EventDraft, stableStringify } from "@wyrd/core";
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

/** Applies a settings patch, enforcing locks. Turning hardcore off sets the permanent softcore flag. */
export function changeSettings(state: GameState, patch: SettingsPatch): Result<EventDraft[]> {
  const current = state.campaign.settings;
  const parsed = CampaignSettings.safeParse(merge(current, patch));
  if (!parsed.success) return fail("SETTINGS_INVALID", parsed.error.message);
  let next = parsed.data;
  if (current.structural.hardcore && !next.structural.hardcore) {
    next = { ...next, flags: { ...next.flags, softcore: true } };
  }
  const errors = validateSettingsChange(current, next);
  if (errors.length > 0) return { ok: false, errors };
  const changed = changedPaths(current, next);
  if (changed.length === 0) return ok([]);
  return ok([draft("SettingsChanged", { settings: next, changed }, "player")]);
}

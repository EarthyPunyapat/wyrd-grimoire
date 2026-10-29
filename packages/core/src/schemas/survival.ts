import { z } from "zod";
import type { Tuning } from "../tuning.ts";
import type { Light } from "./canon.ts";
import { ActorId, ContentId, Difficulty, SkillId } from "./common.ts";

/**
 * Survival, disease, weather, lighting and language (spec 11, M7). The state lives under
 * `GameState.flags.survival`, so snapshots from before M7 load unchanged and every field is
 * defaulted.
 */

// ── Needs ────────────────────────────────────────────────────────────────────────────────────────

export const NeedId = z.enum(["food", "water", "sleep", "exposure"]);
export type NeedId = z.infer<typeof NeedId>;

/** Which ladder an escalation belongs to: exposure has a cold and a hot ladder. */
export const NeedLadder = z.enum(["food", "water", "sleep", "cold", "hot"]);
export type NeedLadder = z.infer<typeof NeedLadder>;

export const ExposureKind = z.enum(["none", "cold", "hot"]);
export type ExposureKind = z.infer<typeof ExposureKind>;

/** One actor's needs. Days and hours are counted from the last time the need was met. */
export const NeedState = z.object({
  /** Full days with no ration. */
  daysWithoutFood: z.number().int().nonnegative().default(0),
  /** Full days with less water than the climate demands. */
  daysWithoutWater: z.number().int().nonnegative().default(0),
  /** Hours since a full night's sleep. */
  hoursAwake: z.number().nonnegative().default(0),
  /** Exposure steps: 0 comfortable, 1 cold/hot, 2 hypothermic/heatstroke. */
  exposure: z.number().int().nonnegative().default(0),
  exposureKind: ExposureKind.default("none"),
  /** Stage ids already applied, so a tick can diff conditions instead of re-applying them. */
  stages: z.array(z.string()).default([]),
});
export type NeedState = z.infer<typeof NeedState>;

/** A fresh needs record. */
export const emptyNeeds = (): NeedState => NeedState.parse({});

/** One rung of an escalation ladder (tuning `survival.stages`). */
export type NeedStageDef = {
  id: string;
  name: string;
  /** Threshold in the need's own unit: days for food and water, hours for sleep, steps for exposure. */
  at: number;
  /** Penalty to every check while in this stage or worse. */
  penalty: number;
  /** Condition applied at this stage (`core:hungry`, `core:exhausted` …). */
  condition?: string;
  /** Level for a levelled condition (Exhausted 1–5). */
  level?: number;
  /** No natural HP recovery while in this stage or worse. */
  noRecovery?: boolean;
  /** Endurance check cadence in hours; 0 or absent means no check. */
  checkEveryHours?: number;
  checkDifficulty?: Difficulty;
  /** Damage on a failed endurance check. */
  failureDamage?: number;
};

// ── Disease ─────────────────────────────────────────────────────────────────────────────────────

export const DiseaseVector = z.enum(["contact", "airborne", "ingested", "vermin", "wound"]);
export type DiseaseVector = z.infer<typeof DiseaseVector>;

export const DiseaseStage = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Hours after infection when this stage begins. */
  atHours: z.number().nonnegative(),
  /** Penalty to every check while in this stage. */
  penalty: z.number().int().default(0),
  /** Conditions the stage applies. */
  conditions: z.array(z.object({ id: ContentId, level: z.number().int().min(1).optional() })).default([]),
  /** Endurance check to resist worsening; absent = the stage passes on its own. */
  check: Difficulty.optional(),
  /** Damage on a failed check. */
  damage: z.number().int().nonnegative().default(0),
  /** Whether this stage can pass the disease to someone close. */
  contagious: z.boolean().default(false),
  /** Short phrases the narrator may use. */
  symptoms: z.array(z.string()).default([]),
});
export type DiseaseStage = z.infer<typeof DiseaseStage>;

export const DiseaseCure = z.object({
  name: z.string().min(1),
  kind: z.enum(["rest", "herb", "medicine", "prayer"]),
  /** The check a cure needs, when it isn't automatic. */
  skill: SkillId.optional(),
  difficulty: Difficulty.default("normal"),
});
export type DiseaseCure = z.infer<typeof DiseaseCure>;

/** A disease as authored in a pack's `diseases.yaml`. */
export const DiseaseDef = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected a lowercase local id (a-z, 0-9, -)"),
  name: z.string().min(1),
  description: z.string().min(1),
  vector: DiseaseVector,
  /** Endurance check to resist catching it when exposed. */
  resistance: Difficulty.default("normal"),
  /** Hours before the first stage can begin. */
  onsetHours: z.number().nonnegative().default(0),
  stages: z.array(DiseaseStage).min(1),
  /** Days of recovery after the last stage before it clears. */
  recoveryDays: z.number().int().nonnegative().default(3),
  cures: z.array(DiseaseCure).default([]),
  contagion: z
    .object({
      /** Chance per day that a contagious stage passes to someone close. */
      chance: z.number().min(0).max(1).default(0.15),
      scope: z.enum(["close", "household"]).default("close"),
    })
    .prefault({}),
});
export type DiseaseDef = z.infer<typeof DiseaseDef>;

/** A disease an actor has. */
export const DiseaseInstance = z.object({
  id: z.string().min(1),
  diseaseId: z.string().min(1),
  actorId: ActorId,
  infectedAt: z.number().int().nonnegative(),
  /** Index into the disease's stages; `stages.length` means past the last stage, recovering. */
  stage: z.number().int().nonnegative().default(0),
  /** Game time of the next progression check. */
  nextCheckAt: z.number().int().nonnegative(),
  symptoms: z.array(z.string()).default([]),
  cured: z.boolean().default(false),
});
export type DiseaseInstance = z.infer<typeof DiseaseInstance>;

// ── Light ───────────────────────────────────────────────────────────────────────────────────────

export const BurningLight = z.object({
  itemId: ContentId,
  kind: z.enum(["torch", "lantern", "other"]).default("other"),
  minutesLeft: z.number().int().nonnegative(),
});
export type BurningLight = z.infer<typeof BurningLight>;

/** The check penalty a light level imposes on a sight-based action (spec 11, Lighting and vision). */
export type LightEffect = { modifier: number; bane: number; note: string };

export function lightEffect(
  light: z.infer<typeof Light>,
  o: { hasLight: boolean; hasDarkvision: boolean; tuning: Tuning["survival"]["light"] },
): LightEffect {
  if (light === "bright" || o.hasLight) return { modifier: 0, bane: 0, note: "" };
  if (light === "dim") return { modifier: o.tuning.dimPenalty, bane: 0, note: "dim light" };
  return o.hasDarkvision
    ? { modifier: 0, bane: 0, note: "" }
    : { modifier: o.tuning.darkPenalty, bane: 0, note: "darkness" };
}

/** Light by clock when time detail is on: day is bright, dawn and dusk dim, night dark. */
export function lightByClock(hour: number, dawn: number, dusk: number): z.infer<typeof Light> {
  if (hour < dawn || hour >= dusk) return "dark";
  if (hour === dawn || hour === dusk - 1) return "dim";
  return "bright";
}

// ── Language ───────────────────────────────────────────────────────────────────────────────────

export const LanguageMethod = z.enum(["shared", "interpreter", "check", "gestures", "none"]);
export type LanguageMethod = z.infer<typeof LanguageMethod>;

export const LanguageUnderstanding = z.object({
  understood: z.boolean(),
  method: LanguageMethod,
  /** The narrator describes tone and manner, never the words. */
  toneOnly: z.boolean(),
  note: z.string(),
});
export type LanguageUnderstanding = z.infer<typeof LanguageUnderstanding>;

/**
 * Whether the PC can follow an NPC (spec 11, Language barriers): a shared tongue, an interpreter,
 * a successful Language check, or gestures read with Insight. Without any, the narrator gives tone.
 */
export function languageUnderstanding(o: {
  pcLanguages: readonly string[];
  npcLanguages: readonly string[];
  /** The campaign's trade tongue, understood by everyone. */
  common?: string;
  interpreter?: boolean;
  /** The degree of a Language check already rolled, if any. */
  check?: "critSuccess" | "success" | "failure" | "critFailure" | null;
}): LanguageUnderstanding {
  const common = o.common ?? "common";
  const knows = (l: string) => o.pcLanguages.includes(l);
  if (o.npcLanguages.some(knows) || (knows(common) && o.npcLanguages.length === 0)) {
    return { understood: true, method: "shared", toneOnly: false, note: "You share a tongue." };
  }
  if (o.interpreter) {
    return {
      understood: true,
      method: "interpreter",
      toneOnly: false,
      note: "Someone translates for you.",
    };
  }
  if (o.check === "success" || o.check === "critSuccess") {
    return {
      understood: true,
      method: "check",
      toneOnly: false,
      note: o.check === "critSuccess" ? "You follow the tongue clearly." : "You catch the sense of it.",
    };
  }
  if (o.check === "failure") {
    return {
      understood: false,
      method: "gestures",
      toneOnly: true,
      note: "You get the gist from gestures and tone, not the words.",
    };
  }
  if (o.check === "critFailure") {
    return {
      understood: false,
      method: "none",
      toneOnly: true,
      note: "The words mean nothing to you; only the tone comes through.",
    };
  }
  return {
    understood: false,
    method: "none",
    toneOnly: true,
    note: "You don't speak their tongue. The narrator gives you tone, not words.",
  };
}

// ── Time detail: schedules ──────────────────────────────────────────────────────────────────────

/** A shop's or an NPC archetype's hours. Close before open means it runs past midnight. */
export const ScheduleEntry = z.object({
  archetype: z.string().min(1),
  openHour: z.number().int().min(0).max(23),
  closeHour: z.number().int().min(0).max(23),
  note: z.string().default(""),
});
export type ScheduleEntry = z.infer<typeof ScheduleEntry>;

export function isOpenAt(s: ScheduleEntry, hour: number): boolean {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return s.closeHour > s.openHour ? h >= s.openHour && h < s.closeHour : h >= s.openHour || h < s.closeHour;
}

// ── Weather ─────────────────────────────────────────────────────────────────────────────────────

export const WeatherKind = z.enum([
  "clear",
  "overcast",
  "rain",
  "fog",
  "wind",
  "snow",
  "storm",
  "heat",
  "mud",
]);
export type WeatherKind = z.infer<typeof WeatherKind>;

/** The mechanical family a weather string belongs to, read from its words. */
export function weatherKindOf(weather: string): WeatherKind {
  const w = weather.toLowerCase();
  if (/(thunder|storm|squall|tempest|gale)/.test(w)) return "storm";
  if (/(snow|sleet|blizzard|frost)/.test(w)) return "snow";
  if (/(rain|drizzle|downpour|shower)/.test(w)) return "rain";
  if (/(fog|mist|haze)/.test(w)) return "fog";
  if (/(wind|bluster|gust)/.test(w)) return "wind";
  if (/(hot|heat|scorch|swelter)/.test(w)) return "heat";
  if (/(mud|mire|slush)/.test(w)) return "mud";
  if (/(overcast|cloud|grey|gray|muggy|humid)/.test(w)) return "overcast";
  return "clear";
}

/** What one weather does to checks and travel (spec 11, Weather effects). */
export type WeatherEffect = {
  kind: WeatherKind;
  rangedPenalty: number;
  perceptionPenalty: number;
  travelFactor: number;
  blocksRoutes: boolean;
  /** Degrees relative to comfortable, feeding exposure. */
  temperature: number;
};

export function weatherEffect(weather: string, tuning: Tuning["survival"]["weather"]): WeatherEffect {
  const kind = weatherKindOf(weather);
  const row = tuning.effects[kind];
  return {
    kind,
    rangedPenalty: row?.rangedPenalty ?? 0,
    perceptionPenalty: row?.perceptionPenalty ?? 0,
    travelFactor: row?.travelFactor ?? 1,
    blocksRoutes: row?.blocksRoutes ?? false,
    temperature: tuning.temperature[kind] ?? 0,
  };
}

// ── Stored state ───────────────────────────────────────────────────────────────────────────────

export const SurvivalNotice = z.object({
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
  kind: z.enum(["need", "supply", "disease", "weather", "light", "language"]),
  text: z.string().min(1),
});
export type SurvivalNotice = z.infer<typeof SurvivalNotice>;

/** Everything survival keeps in `GameState.flags.survival`. */
export const SurvivalState = z.object({
  needs: z.record(z.string(), NeedState).default({}),
  diseases: z.record(z.string(), z.array(DiseaseInstance)).default({}),
  lights: z.record(z.string(), z.array(BurningLight)).default({}),
  notices: z.array(SurvivalNotice).default([]),
});
export type SurvivalState = z.infer<typeof SurvivalState>;

/** Reads (and repairs) the survival slice of a game state's flags. */
export function survivalOf(flags: Record<string, unknown> | undefined): SurvivalState {
  const parsed = SurvivalState.safeParse(flags?.survival ?? {});
  return parsed.success ? parsed.data : SurvivalState.parse({});
}

export const MAX_NOTICES = 40;

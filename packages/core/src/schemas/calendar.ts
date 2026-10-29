import { z } from "zod";

/**
 * Pack calendar (spec 06, Time and calendar). The tuning calendar is the fallback; a pack's
 * `calendar.yaml` names its own weekdays, months, seasons and festivals. Day 1 of month 1 of year 1
 * is game minute 0, as with the tuning calendar.
 */

const LocalId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected a lowercase local id (a-z, 0-9, -)");

export const CalendarMonthDef = z.object({
  name: z.string().trim().min(1).max(40),
  days: z.number().int().min(1).max(60),
  season: z.string().trim().min(1).max(30),
});
export type CalendarMonthDef = z.infer<typeof CalendarMonthDef>;

export const FestivalDef = z.object({
  id: LocalId,
  name: z.string().trim().min(1).max(80),
  /** 1-based month index into `months`. */
  month: z.number().int().positive(),
  /** 1-based day within that month. */
  day: z.number().int().positive(),
  description: z.string().default(""),
});
export type FestivalDef = z.infer<typeof FestivalDef>;

export const CalendarDef = z.object({
  /** Weekday names, repeated in order. */
  days: z.array(z.string().trim().min(1).max(30)).min(1).max(14),
  months: z.array(CalendarMonthDef).min(1).max(24),
  festivals: z.array(FestivalDef).default([]),
});
export type CalendarDef = z.infer<typeof CalendarDef>;
export type CalendarDefInput = z.input<typeof CalendarDef>;

/** The calendar day a festival falls on, 1-based, or null when the month/day doesn't exist. */
export function festivalDayOf(cal: CalendarDef, festival: FestivalDef): number | null {
  const month = cal.months[festival.month - 1];
  if (!month || festival.day > month.days) return null;
  let day = festival.day;
  for (let i = 0; i < festival.month - 1; i++) day += cal.months[i]!.days;
  return day;
}

/** Festivals that fall on a given day of the year (1-based). */
export function festivalsOn(cal: CalendarDef, dayOfYear: number): FestivalDef[] {
  return cal.festivals.filter((f) => festivalDayOf(cal, f) === dayOfYear);
}

/** Why a pack calendar is inconsistent, or null when it is usable. */
export function calendarProblem(cal: CalendarDef): string | null {
  const seen = new Set<string>();
  for (const f of cal.festivals) {
    if (seen.has(f.id)) return `Duplicate festival id "${f.id}"`;
    seen.add(f.id);
    const month = cal.months[f.month - 1];
    if (!month) return `Festival "${f.id}" names month ${f.month}, which doesn't exist`;
    if (f.day > month.days) return `Festival "${f.id}" names day ${f.day} of a ${month.days}-day month`;
  }
  return null;
}

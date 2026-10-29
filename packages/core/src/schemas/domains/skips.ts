import { z } from "zod";
import { defaultTuning } from "../../tuning.ts";

const Id = z.string().trim().min(1);
const At = z.number().int().nonnegative();
export const SkipUntil = z.union([
  z.object({ taskIds: z.array(Id).min(1) }).strict(),
  z.object({ clockId: Id }).strict(),
  z.object({ entityId: Id, predicate: Id, value: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
]);
export type SkipUntil = z.infer<typeof SkipUntil>;
export const TimeSkipArgs = z
  .object({
    duration: z
      .union([z.number().int().positive(), z.string().trim().min(1).max(defaultTuning.skips.durationChars)])
      .optional(),
    until: SkipUntil.optional(),
    /** Backward compatibility with the original tool. Both numbers are game minutes. */
    minutes: z.number().int().positive().optional(),
    reason: z.string().max(defaultTuning.skips.reasonChars).default("Time passes"),
  })
  .refine((v) => [v.duration, v.until, v.minutes].filter((v) => v !== undefined).length === 1, {
    message: "Choose exactly one of duration, until, or legacy minutes",
  });
export type TimeSkipArgs = z.infer<typeof TimeSkipArgs>;
export const WatchArgs = z.object({ entityId: Id });
export const WatchInput = z.object({ watch: z.boolean() }).strict();
export const SkipReport = z.object({ entityId: Id, title: z.string().max(80), body: z.string().max(1200) });
export const SkipDigest = z.object({
  id: Id,
  from: At,
  to: At,
  days: At,
  weeks: At,
  stop: z.enum(["duration", "condition", "limit", "watched", "canon", "task", "death"]),
  interrupted: z.boolean(),
  summary: z.string().max(1200),
  reports: z.array(SkipReport),
});
export type SkipDigest = z.infer<typeof SkipDigest>;
export const skipEventSchemas = {
  WatchAdded: z.object({ entityId: Id }),
  WatchRemoved: z.object({ entityId: Id }),
  SkipCompleted: z.object({ digest: SkipDigest }),
} as const;

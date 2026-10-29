import { z } from "zod";
import { defaultTuning } from "../../tuning.ts";
import { CheckResult } from "../check.ts";
import { RngStateSchema } from "../common.ts";
import { LevelOpposition } from "./levels.ts";

const Id = z.string().trim().min(1);
const At = z.number().int().nonnegative();
export const VoiceProfile = z.string().trim().min(1).max(defaultTuning.delegation.voiceChars);
export const CompanionBondInput = z
  .object({ loyal: z.literal(true).optional(), voiceProfile: VoiceProfile.optional() })
  .strict()
  .refine((v) => v.loyal === true || v.voiceProfile !== undefined, {
    message: "Set loyalty or a voice profile",
  });
export const DelegateArgs = z.object({
  assignee: Id,
  goal: z.string().trim().min(1).max(defaultTuning.delegation.goalChars),
  due: At.optional(),
  opposition: LevelOpposition.optional(),
  skill: Id.optional(),
  abilityId: Id.optional(),
  exploit: z.string().trim().min(1).optional(),
  taskId: Id.optional(),
});
export type DelegateArgs = z.infer<typeof DelegateArgs>;
export const DelegationTask = z.object({
  id: Id,
  assignee: Id,
  goal: DelegateArgs.shape.goal,
  startedAt: At,
  dueAt: At.optional(),
  resolveAt: At,
  status: z.enum(["active", "blocked", "done", "failed"]),
  report: z.string().max(defaultTuning.delegation.reportChars).optional(),
  progressedAt: At,
  opposition: LevelOpposition,
  skill: Id,
  abilityId: Id.optional(),
  exploit: z.string().optional(),
});
export type DelegationTask = z.infer<typeof DelegationTask>;
const Report = z.string().min(1).max(defaultTuning.delegation.reportChars);
export const delegationEventSchemas = {
  CompanionBondSet: z.object({ companionId: Id, bond: CompanionBondInput }),
  TaskAssigned: z.object({ task: DelegationTask }),
  TaskProgressed: z
    .object({ taskId: Id, at: At, roll: CheckResult.optional(), rngAfter: RngStateSchema.optional() })
    .refine((v) => (v.roll !== undefined) === (v.rngAfter !== undefined)),
  TaskBlocked: z.object({ taskId: Id, at: At, report: Report }),
  TaskEnded: z.object({ taskId: Id, at: At, status: z.enum(["done", "failed"]), report: Report }),
} as const;

import { z } from "zod";
import { defaultTuning } from "../../tuning.ts";
import { ActorId } from "../common.ts";

export const Level = z.union([z.number().int().min(defaultTuning.levels.start), z.literal("infinite")]);
export type Level = z.infer<typeof Level>;
export const Ability = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  level: Level,
  cost: z.string().trim().min(1),
  rank: z.number().int().min(defaultTuning.levels.minRank).max(defaultTuning.levels.maxRank),
});
export type Ability = z.infer<typeof Ability>;
export const LevelOpposition = z.union([
  z.object({ level: Level }).strict(),
  z.object({ actorId: ActorId }).strict(),
]);
export const LevelProposal = z.object({
  id: z.string().min(1),
  actorId: ActorId,
  from: Level,
  level: Level,
  reason: z.string().trim().min(1),
});
export type LevelProposal = z.infer<typeof LevelProposal>;
export const LevelUpCard = z.object({ type: z.literal("levelUp"), proposalId: z.string().min(1) });
export const levelEventSchemas = {
  LevelProposed: z.object({ proposal: LevelProposal }),
  LevelGained: z.object({
    actorId: ActorId,
    from: Level,
    level: Level,
    method: z.enum(["milestone", "xp", "breakthrough", "gm"]),
    reason: z.string().min(1),
    proposalId: z.string().optional(),
  }),
  AbilityGained: z.object({ actorId: ActorId, ability: Ability }),
  AbilityRanked: z.object({ actorId: ActorId, abilityId: z.string().min(1), rank: Ability.shape.rank }),
} as const;

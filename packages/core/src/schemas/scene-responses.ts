import { z } from "zod";

/** Optional canon data; ordinary NPCs and companions can share traits without sharing control. */
export const ReactionProfile = z.object({
  temperament: z.enum(["assertive", "cautious", "protective", "hostile"]).default("assertive"),
  speechStyle: z.string().trim().max(160).default("plain and direct"),
  canSpeak: z.boolean().optional(),
});
export type ReactionProfile = z.infer<typeof ReactionProfile>;

/** A resolved, observable response. Wording is a safe fallback, not authority to change state. */
export const SceneResponse = z.object({
  actorId: z.string(),
  aggressorId: z.string(),
  subjectId: z.string(),
  incidentId: z.string(),
  round: z.number().int().nonnegative(),
  stage: z.number().int().positive(),
  kind: z.enum(["observe", "protest", "callForHelp", "withdraw", "intervene", "defy", "refuse", "answer"]),
  recipientId: z.string().optional(),
  utterance: z.string(),
  speechStyle: z.string(),
  summary: z.string(),
});
export type SceneResponse = z.infer<typeof SceneResponse>;

export type SceneReactionTuning = {
  witnessVoices: number;
  seekHelpAt: number;
  interveneAt: number;
  victimAttitude: number;
  witnessAttitude: number;
  victimFear: number;
  witnessFear: number;
  sharedMemories: number;
};

export const defaultSceneReactionTuning: SceneReactionTuning = {
  witnessVoices: 1,
  seekHelpAt: 2,
  interveneAt: 3,
  victimAttitude: -10,
  witnessAttitude: -3,
  victimFear: 5,
  witnessFear: 2,
  sharedMemories: 3,
};

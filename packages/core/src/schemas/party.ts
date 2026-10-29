import { z } from "zod";
import { ResolutionId } from "./common.ts";
import { VoiceProfile } from "./domains/delegation.ts";
import { CharacterSheet } from "./sheet.ts";

// ── Progression and the party (spec 04, spec 13 Party tab) ──────────────────────────────────────

const Priced = { cost: z.number().nullable(), why: z.string().optional() };
export const ProgressionMember = z.object({
  actorId: z.string(),
  name: z.string(),
  role: z.enum(["pc", "companion"]),
  xp: z.object({ earned: z.number(), spent: z.number(), available: z.number() }),
  pending: z.object({
    attributes: z.number(),
    talents: z.number(),
    /** Class-mode training points waiting to be spent. */
    classSkillPoints: z.number().default(0),
    anySkillPoints: z.number().default(0),
  }),
  marks: z.array(z.string()),
  /** Class campaigns: the character's class, level, progress and features (spec 04). */
  class: z
    .object({
      id: z.string(),
      name: z.string(),
      level: z.number(),
      xpIntoLevel: z.number(),
      /** XP still needed for the next level, or null at the top of the table. */
      xpForNext: z.number().nullable(),
      features: z.array(z.object({ level: z.number(), name: z.string(), description: z.string() })),
    })
    .optional(),
  attributes: z.array(z.object({ id: z.string(), name: z.string(), value: z.number(), ...Priced })),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      value: z.number(),
      /** The campaign module's notation ("65%" or "+3"). */
      display: z.string().default(""),
      ...Priced,
      /** Class mode: which training pool pays for a raise, if any. */
      pool: z.enum(["class", "any"]).optional(),
    }),
  ),
  talents: z.array(
    z.object({ id: z.string(), name: z.string(), tier: z.number(), description: z.string(), ...Priced }),
  ),
  fieldSkills: z.array(z.object({ id: z.string(), name: z.string(), ...Priced })),
  /** Companions only: how they feel about the PC and how they're controlled (spec 04 approval). */
  companion: z
    .object({
      approval: z.number().nullable(),
      voiceProfile: VoiceProfile.optional(),
      mood: z.string(),
      control: z.enum(["ai", "manual"]),
      directive: z.enum(["follow", "aggressive", "defensive", "support", "hold"]),
      values: z.array(z.string()),
      likes: z.array(z.string()),
      dislikes: z.array(z.string()),
      loyal: z.boolean(),
    })
    .optional(),
});
export type ProgressionMember = z.infer<typeof ProgressionMember>;
export const ProgressionView = z.object({
  mode: z.enum(["classless", "useBased", "hybrid", "classes"]),
  /** The campaign's dice system, so the spend screen can use its notation (spec 02, 12). */
  resolution: ResolutionId.default("d100"),
  members: z.array(ProgressionMember),
  /** Companions who left or died, for the record. */
  former: z.array(z.object({ name: z.string(), status: z.enum(["left", "dead"]) })).default([]),
});
export type ProgressionView = z.infer<typeof ProgressionView>;
export const AdvanceInput = z
  .object({
    actorId: z.string().min(1).max(80),
    kind: z.enum(["skill", "attribute", "talent", "fieldSkill", "classSkill", "anySkill"]),
    id: z.string().min(1).max(120),
  })
  .strict();

// ── Companions (spec 04): full party members with opinions and agency ─────────────────────────

/** What a companion cares about (stored in canon) and the personal quest unlocked at +50. */
export const CompanionProfile = z
  .object({
    values: z.array(z.string().trim().min(1).max(60)).min(1).max(4),
    likes: z.array(z.string().trim().min(1).max(100)).max(4),
    dislikes: z.array(z.string().trim().min(1).max(100)).max(4),
    /** At −75 they betray the party instead of simply leaving. */
    canBetray: z.boolean(),
    personalQuest: z
      .object({
        title: z.string().trim().min(1).max(100),
        stages: z.array(z.string().trim().min(1).max(300)).min(2).max(4),
      })
      .strict(),
  })
  .strict();
export type CompanionProfile = z.infer<typeof CompanionProfile>;

export const CompanionDirective = z.enum(["follow", "aggressive", "defensive", "support", "hold"]);
export type CompanionDirective = z.infer<typeof CompanionDirective>;

export const CompanionState = z.object({
  voiceProfile: VoiceProfile.optional(),
  id: z.string(),
  status: z.enum(["active", "left", "dead"]).default("active"),
  approval: z.number().int().min(-100).max(100).default(0),
  control: z.enum(["ai", "manual"]).default("ai"),
  directive: CompanionDirective.default("follow"),
  reason: z.string(),
  joinedAt: z.number().int().nonnegative(),
  profile: CompanionProfile.optional(),
  /** Approval moved so far in the current scene (the ±20 cap). */
  scene: z.object({ id: z.string(), total: z.number().int() }).optional(),
  confronted: z.boolean().default(false),
  questStarted: z.boolean().default(false),
  loyal: z.boolean().default(false),
  /** A scene the narrator owes (a confrontation, a departure), told on the next turn. */
  beat: z.string().optional(),
  lastBanterScene: z.string().optional(),
});
export type CompanionState = z.infer<typeof CompanionState>;

export const partyEventSchemas = {
  /** An NPC joins (spec 04 recruiting). A sheet comes with them unless they're already an actor. */
  CompanionJoined: z.object({
    companionId: z.string(),
    reason: z.string().min(1),
    sheet: CharacterSheet.optional(),
  }),
  CompanionProfiled: z.object({ companionId: z.string(), profile: CompanionProfile }),
  ApprovalChanged: z.object({
    companionId: z.string(),
    delta: z.number().int(),
    reason: z.string(),
    sceneId: z.string().optional(),
  }),
  CompanionMilestone: z.object({
    companionId: z.string(),
    milestone: z.enum(["confronted", "questStarted", "loyal"]),
    beat: z.string().optional(),
  }),
  CompanionLeft: z.object({
    companionId: z.string(),
    reason: z.string(),
    betrayed: z.boolean(),
    beat: z.string(),
  }),
  CompanionControlSet: z.object({
    companionId: z.string(),
    control: z.enum(["ai", "manual"]),
    directive: CompanionDirective,
  }),
  /** The owed beat was narrated. */
  CompanionBeatTold: z.object({ companionId: z.string() }),
  BanterPlayed: z.object({ companionId: z.string(), sceneId: z.string() }),
} as const;

export const CompanionControlInput = z
  .object({ control: z.enum(["ai", "manual"]), directive: CompanionDirective })
  .strict();

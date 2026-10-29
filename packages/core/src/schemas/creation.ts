import { z } from "zod";
import { AttributeId, ContentId, SkillId } from "./common.ts";
import { AppearanceFacts, CharacterSheet } from "./sheet.ts";

// ── Character creation (spec 04): the draft every path edits, and what the sheet editor shows ──────

/** What a backstory hook becomes in canon: an NPC (rival, missing person, bond), a debt, or a secret. */
export const HookKind = z.enum(["rival", "missing", "bond", "debt", "secret"]);
export type HookKind = z.infer<typeof HookKind>;

export const BackstoryHook = z
  .object({
    kind: HookKind,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(400).default(""),
  })
  .strict();
export type BackstoryHook = z.infer<typeof BackstoryHook>;

/**
 * A character before the campaign starts. Skills hold trained points; the engine fills in derived
 * stats, status and the archetype's kit when it builds the sheet.
 */
export const DraftSheet = z
  .object({
    name: z.string().trim().max(80).default(""),
    pronouns: z.string().trim().max(40).default(""),
    ancestry: ContentId,
    archetype: ContentId,
    attributes: z.record(AttributeId, z.number().int().min(1).max(10)),
    skills: z.record(SkillId, z.number().int().min(1).max(100)).default({}),
    talents: z.array(ContentId).max(6).default([]),
    appearance: AppearanceFacts.prefault({}),
    background: z.string().trim().max(400).default(""),
    personality: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
    backstory: z.string().trim().max(4000).default(""),
    hooks: z.array(BackstoryHook).max(6).default([]),
  })
  .strict();
export type DraftSheet = z.infer<typeof DraftSheet>;
export type DraftSheetInput = z.input<typeof DraftSheet>;

export const CreationIssueView = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
});

const option = { id: z.string(), name: z.string(), description: z.string() };
export const CreationOptions = z.object({
  originLabel: z.enum(["Origin", "Ancestry", "Species"]),
  ancestries: z.array(z.object({ ...option, attributeMaxBonus: z.array(AttributeId) })),
  archetypes: z.array(
    z.object({
      ...option,
      talent: z.string(),
      backstoryPrompts: z.array(z.string()),
      suggestedAttributes: z.record(AttributeId, z.number()),
      skills: z.record(z.string(), z.number()),
    }),
  ),
  talents: z.array(z.object({ ...option, tier: z.number(), requires: z.array(z.string()) })),
  skills: z.array(
    z.object({ id: z.string(), name: z.string(), attributes: z.array(AttributeId), field: z.boolean() }),
  ),
  pregens: z.array(z.object({ id: z.string(), name: z.string(), summary: z.string() })),
  /** The creation budget (tuning.creation). */
  budget: z.object({
    attributeStart: z.number(),
    attributePoints: z.number(),
    attributeMax: z.number(),
    attributeMaxWithTrait: z.number(),
    corePoints: z.number(),
    coreMaxPerSkill: z.number(),
    interestPoints: z.number(),
    interestMaxPerSkill: z.number(),
    archetypeTalents: z.number(),
    freeTalents: z.number(),
  }),
});
export type CreationOptions = z.infer<typeof CreationOptions>;

/** The sheet editor's state: the draft, the sheet the engine builds from it, and what's wrong. */
export const CreationView = z.object({
  draft: DraftSheet,
  preview: CharacterSheet,
  issues: z.array(CreationIssueView),
  /** Skill values (untrained + trained) for every trained skill, as the engine computes them. */
  skillValues: z.record(z.string(), z.number()),
  options: CreationOptions,
});
export type CreationView = z.infer<typeof CreationView>;

export const PregenChoice = z.object({ pregen: z.string().min(1).max(80) }).strict();

// ── Session zero (spec 04): an interview that proposes sheet changes for the engine to check ──────

/**
 * What the `sessionZero` role may propose in one step. Every part is optional and is applied only
 * if it keeps that part of the sheet within the creation rules.
 */
export const SessionZeroProposals = z
  .object({
    identity: z
      .object({
        name: z.string().trim().min(1).max(80),
        pronouns: z.string().trim().max(40),
        ancestry: z.string(),
        archetype: z.string(),
        personality: z.array(z.string().trim().min(1).max(40)).max(6),
        backstory: z.string().trim().max(4000),
      })
      .partial()
      .strict(),
    attributes: z.partialRecord(AttributeId, z.number().int().min(1).max(10)),
    /** Trained points per skill; replaces the skill list. */
    skills: z.record(z.string(), z.number().int().min(1).max(100)),
    /** Free talent picks (the background's talent is kept). */
    talents: z.array(z.string()).max(2),
    appearance: z
      .object({
        build: z.string().max(80),
        hair: z.string().max(80),
        eyes: z.string().max(80),
        skin: z.string().max(80),
        marks: z.array(z.string().max(80)).max(5),
        clothingStyle: z.string().max(120),
      })
      .partial()
      .strict(),
    hooks: z.array(BackstoryHook).max(6),
  })
  .partial()
  .strict();
export type SessionZeroProposals = z.infer<typeof SessionZeroProposals>;

/** One interviewer step: proposals so far, then the next question (or a closing line when done). */
export const InterviewStep = z
  .object({
    proposals: SessionZeroProposals.default({}),
    message: z.string().trim().min(1).max(1200),
    done: z.boolean(),
  })
  .strict();
export type InterviewStep = z.infer<typeof InterviewStep>;

export const InterviewMessage = z.object({
  from: z.enum(["interviewer", "player"]),
  text: z.string().max(4000),
});
export const InterviewState = z.object({
  messages: z.array(InterviewMessage).default([]),
  done: z.boolean().default(false),
  /** Proposals the engine refused, fed back to the interviewer on the next step. */
  refused: z.array(z.string()).default([]),
  offline: z.boolean().default(false),
});
export type InterviewState = z.infer<typeof InterviewState>;
export const InterviewAnswer = z.object({ answer: z.string().trim().min(1).max(2000).optional() }).strict();
export const InterviewView = z.object({ interview: InterviewState, creation: CreationView });
export type InterviewView = z.infer<typeof InterviewView>;

/** Fields the wizard's "suggest" buttons fill (spec 04 form path). */
export const SuggestField = z.enum(["name", "appearance", "personality", "backstory", "hooks"]);
export type SuggestField = z.infer<typeof SuggestField>;
export const SuggestInput = z.object({ field: SuggestField }).strict();

/**
 * Where the world puts each backstory hook (spec 04 → 06): a site and maybe a faction, and a line on
 * what they're doing now, which stays hidden from the player until play reveals it.
 */
export const HookPlacements = z
  .object({
    placements: z
      .array(
        z
          .object({
            hook: z.number().int().min(0).max(5),
            site: z.string().max(100).nullable(),
            faction: z.string().max(100).nullable(),
            now: z.string().trim().max(300),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();
export type HookPlacements = z.infer<typeof HookPlacements>;

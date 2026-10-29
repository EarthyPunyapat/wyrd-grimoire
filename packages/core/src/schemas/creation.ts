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

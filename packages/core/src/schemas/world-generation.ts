import { z } from "zod";
import { AttributeId, ContentId } from "./common.ts";

const name = z.string().trim().min(1).max(100);
const description = z.string().trim().min(1).max(1500);
export const WorldPitch = z
  .object({
    name,
    characterName: z.string().trim().max(80).default(""),
    pitch: z.string().trim().min(10).max(4000),
  })
  .strict();
export type WorldPitch = z.infer<typeof WorldPitch>;

/** Model proposals contain fiction and preferences, never executable rules or point totals. */
export const WorldProposal = z
  .object({
    worldName: name,
    premise: description,
    tone: description,
    suggestedCharacterName: z.string().trim().min(1).max(80),
    originLabel: z.enum(["Origin", "Ancestry", "Species"]),
    origins: z.array(z.object({ name, description }).strict()).min(1).max(6),
    backgrounds: z
      .array(
        z
          .object({
            name,
            description,
            attributePriority: z.array(AttributeId).length(7),
            skills: z.array(ContentId).length(6),
          })
          .strict(),
      )
      .min(3)
      .max(6),
    location: z
      .object({
        name,
        description,
        opening: description,
        weather: z.string().max(100),
        zones: z.array(z.object({ name, description }).strict()).min(2).max(5),
        people: z
          .array(
            z
              .object({
                name,
                description,
                zone: z.number().int().min(0).max(4),
                secret: z.string().max(1000).nullable(),
              })
              .strict(),
          )
          .min(2)
          .max(6),
      })
      .strict(),
  })
  .strict();
export type WorldProposal = z.infer<typeof WorldProposal>;
export const StartGeneratedCampaign = z
  .object({
    draftId: z.uuid(),
    characterName: z.string().trim().max(80).default(""),
    ancestry: ContentId,
    archetype: ContentId,
  })
  .strict();
export const GeneratedWorldPreview = z.object({
  id: z.uuid(),
  name,
  worldName: name,
  premise: description,
  opening: description,
  suggestedCharacterName: name,
  originLabel: z.enum(["Origin", "Ancestry", "Species"]),
  origins: z.array(z.object({ id: ContentId, name, description })),
  backgrounds: z.array(z.object({ id: ContentId, name, description })),
  offline: z.boolean(),
});
export type GeneratedWorldPreview = z.infer<typeof GeneratedWorldPreview>;

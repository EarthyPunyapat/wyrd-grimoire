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
    /** The quick path: an origin and background. Without them the sheet editor's draft is used. */
    ancestry: ContentId.optional(),
    archetype: ContentId.optional(),
    /** Chosen at creation and locked (spec 04, 12). Class mode needs a pack with classes. */
    progression: z.enum(["classless", "useBased", "hybrid", "classes"]).default("classless"),
    /** Chosen at creation and locked (spec 12): d100 roll-under or d20. */
    resolution: z.enum(["d100", "d20"]).default("d100"),
    /** Can only be turned on at creation (spec 12). */
    hardcore: z.boolean().default(false),
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

// ── Stage 1 world bible (spec 06): regions, sites, routes, factions, threat, key NPCs, hooks ────────
const short = z.string().trim().min(1).max(400);
export const CLIMATES = ["temperate", "cold", "arid", "tropical", "marine", "indoor"] as const;
export const SITE_KINDS = ["settlement", "wilds", "dungeon", "ruin", "landmark"] as const;
export const WorldBible = z
  .object({
    regions: z
      .array(
        z
          .object({
            name,
            climate: z.enum(CLIMATES),
            culture: short,
            description: short,
            sites: z
              .array(z.object({ name, kind: z.enum(SITE_KINDS), description: short }).strict())
              .min(1)
              .max(4),
          })
          .strict(),
      )
      .min(2)
      .max(6),
    /** Routes between sites by name; days of travel at a normal pace. */
    routes: z
      .array(
        z
          .object({
            from: name,
            to: name,
            days: z.number().min(0.1).max(30),
            terrain: z.string().trim().min(1).max(60),
            danger: z.number().int().min(1).max(5),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    factions: z
      .array(
        z
          .object({
            name,
            description: short,
            goals: z.array(short).min(1).max(2),
            methods: short,
            resources: z
              .object({
                wealth: z.number().int().min(1).max(5),
                military: z.number().int().min(1).max(5),
                influence: z.number().int().min(1).max(5),
              })
              .strict(),
            homeRegion: name,
            leader: z.object({ name, role: short }).strict(),
            secret: short,
          })
          .strict(),
      )
      .min(2)
      .max(8),
    relations: z
      .array(z.object({ a: name, b: name, value: z.number().int().min(-100).max(100) }).strict())
      .default([]),
    threat: z
      .object({
        name,
        nature: short,
        agentFaction: name.nullable(),
        motive: short,
        paths: z
          .array(z.object({ name, description: short }).strict())
          .min(2)
          .max(3),
      })
      .strict()
      .nullable(),
    npcs: z
      .array(
        z
          .object({
            name,
            role: short,
            faction: name.nullable(),
            site: name,
            want: short,
            secret: short.nullable(),
          })
          .strict(),
      )
      .min(3)
      .max(20),
    hooks: z
      .array(z.object({ title: name, summary: short, site: name, npc: name.nullable() }).strict())
      .min(2)
      .max(10),
    /** The site the opening location belongs to. */
    startSite: name,
    /** How the world addresses the player character (spec 13 forms of address), e.g. "traveller", "Detective". */
    address: z.string().trim().min(1).max(40),
  })
  .strict();
export type WorldBible = z.infer<typeof WorldBible>;

/** A lazily generated location (spec 06 `generate_location`): arrival place at a site. */
export const LocationProposal = z
  .object({
    name,
    description,
    arrival: description,
    weather: z.string().max(100),
    light: z.enum(["bright", "dim", "dark"]),
    zones: z
      .array(
        z.object({ name, description: short, tags: z.array(z.string().max(30)).max(4).default([]) }).strict(),
      )
      .min(2)
      .max(5),
    people: z
      .array(
        z
          .object({
            name,
            description: short,
            zone: z.number().int().min(0).max(4),
            secret: short.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type LocationProposal = z.infer<typeof LocationProposal>;

/** Upgrading a stub on first contact (spec 06 `elaborate_entity`). Facts are public unless marked. */
export const Elaboration = z
  .object({
    summary: description,
    facts: z
      .array(
        z.object({ predicate: z.string().trim().min(1).max(40), value: short, secret: z.boolean() }).strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
export type Elaboration = z.infer<typeof Elaboration>;

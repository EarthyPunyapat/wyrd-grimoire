import { z } from "zod";
import { EntityKind } from "./canon.ts";
import { ActorId, ContentId, Difficulty } from "./common.ts";
import { LevelOpposition, LevelUpCard } from "./domains/levels.ts";
import { GearDef } from "./pack.ts";

/**
 * The GM-with-tools turn (Wyrd 2.0, D144). These are tool arguments and turn records, not game
 * state: the engine turns every accepted change into an event.
 */

export const StateChange = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("item.give"),
    actorId: z.string(),
    itemId: z.string(),
    qty: z.number().int().min(1).default(1),
  }),
  z.object({
    kind: z.literal("item.take"),
    actorId: z.string(),
    itemId: z.string(),
    qty: z.number().int().min(1).default(1),
  }),
  z.object({
    kind: z.literal("item.equip"),
    actorId: z.string(),
    itemId: z.string(),
    slot: z.enum(["main", "off", "worn"]),
  }),
  z.object({
    kind: z.literal("item.define"),
    name: z.string().min(1).max(80),
    description: z.string().max(400).default(""),
    weightKg: z.number().min(0).default(0.5),
    price: z.number().int().min(0).default(0),
  }),
  z.object({ kind: z.literal("coins"), actorId: z.string(), delta: z.number().int() }),
  z.object({ kind: z.literal("hp"), actorId: z.string(), delta: z.number().int() }),
  z.object({ kind: z.literal("entity.move"), entityId: z.string().min(1), toZoneId: z.string().min(1) }),
  z.object({
    kind: z.literal("entity.create"),
    entity: z.object({
      kind: EntityKind,
      name: z.string().min(1),
      summary: z.string().default(""),
    }),
  }),
  z.object({
    kind: z.literal("fact"),
    entityId: z.string(),
    predicate: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    kind: z.literal("quest.start"),
    title: z.string(),
    objectives: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal("quest.objective"),
    questId: z.string(),
    objectiveIndex: z.number().int().min(0),
  }),
  z.object({ kind: z.literal("clock.advance"), clockId: z.string(), by: z.number().int().min(1) }),
  z.object({ kind: z.literal("xp"), actorId: z.string(), amount: z.number().int().min(1) }),
]);
export type StateChange = z.infer<typeof StateChange>;
export type StateChangeInput = z.input<typeof StateChange>;

export const RollArgs = z.object({
  opposition: LevelOpposition.optional(),
  exploit: z.string().trim().min(1).optional(),
  abilityId: z.string().min(1).optional(),
  actorId: z.string().optional(),
  skill: z.string(),
  difficulty: Difficulty,
  goal: z.string(),
  targetId: z.string().optional(),
});
export type RollArgs = z.infer<typeof RollArgs>;

/** ExplorationAction | CombatAction, validated by validateTurn. */
export const ActArgs = z.object({ actorId: z.string().optional(), actions: z.array(z.unknown()).min(1) });
export type ActArgs = z.infer<typeof ActArgs>;

export const ChangeStateArgs = z.object({ changes: z.array(StateChange).min(1).max(20) });
export type ChangeStateArgs = z.infer<typeof ChangeStateArgs>;

export const RetconArgs = z.object({
  summary: z.string().min(1).max(200),
  changes: z.array(StateChange).min(1).max(20),
});
export type RetconArgs = z.infer<typeof RetconArgs>;

export const LookupArgs = z.object({ query: z.string().min(1) });
export type LookupArgs = z.infer<typeof LookupArgs>;

export const ObserveArgs = z.object({ targetId: z.string() });
export type ObserveArgs = z.infer<typeof ObserveArgs>;

export { TimeSkipArgs } from "./domains/skips.ts";

export const Card = z.discriminatedUnion("type", [
  LevelUpCard,
  z.object({ type: z.literal("item"), itemId: z.string() }),
  z.object({ type: z.literal("character"), entityId: z.string() }),
  z.object({ type: z.literal("status"), actorId: z.string() }),
  z.object({
    type: z.literal("chapter"),
    title: z.string().max(80),
    subtitle: z.string().max(120).default(""),
  }),
  z.object({ type: z.literal("roll"), lineIndex: z.number().int().min(0) }),
  z.object({ type: z.literal("retcon"), retconId: z.string() }),
  z.object({ type: z.literal("report"), title: z.string().max(80), body: z.string().max(1200) }),
  /** "Browse the wares": opens the shop at the PC's location, if one is here. */
  z.object({ type: z.literal("shop") }),
]);
export type Card = z.infer<typeof Card>;

export const ShowCardArgs = z.object({ cards: z.array(Card).min(1).max(4) });

/** A vendor the GM opens at the current place, with wares that fit who they are (D166). */
export const OpenShopArgs = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.string().trim().max(60).default("general"),
  /** A person present in the scene by id, or just a name for a merchant the story introduces. */
  merchant: z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(60) }),
  stock: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        description: z.string().max(400).default(""),
        price: z.number().int().min(0),
        qty: z.number().int().min(1).max(99).default(1),
        weightKg: z.number().min(0).default(0.5),
      }),
    )
    .min(1)
    .max(20),
});
export type OpenShopArgs = z.infer<typeof OpenShopArgs>;
export type ShowCardArgs = z.infer<typeof ShowCardArgs>;

export const Choice = z.object({
  label: z.string().min(1).max(80),
  description: z.string().max(160).default(""),
});
export type Choice = z.infer<typeof Choice>;

export const OfferChoicesArgs = z.object({ choices: z.array(Choice).min(2).max(5) });
export type OfferChoicesArgs = z.infer<typeof OfferChoicesArgs>;

/** What one GM turn produced, stored inside TurnCompleted; a turn record, not game state. */
export const GmTurnRecord = z.object({
  cards: z.array(Card).default([]),
  choices: z.array(Choice).default([]),
  tools: z.array(z.object({ name: z.string(), ok: z.boolean(), note: z.string().default("") })).default([]),
  provider: z.string(),
  model: z.string(),
  backup: z.boolean().default(false),
  rounds: z.number().int(),
});
export type GmTurnRecord = z.infer<typeof GmTurnRecord>;

/** The ID space for GM-invented items; the engine slugs the name. */
export const CampaignItemId = ContentId.regex(/^campaign:[a-z0-9-]+$/, "expected campaign:local-id");
export type CampaignItemId = z.infer<typeof CampaignItemId>;

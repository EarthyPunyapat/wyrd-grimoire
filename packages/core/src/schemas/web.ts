import { z } from "zod";
import { GuardSummary } from "./canon.ts";
import { CombatView } from "./combat.ts";
import { MechanicsLine } from "./common.ts";
import { CharacterSheet } from "./sheet.ts";
export const ConnectionStatus = z.object({
  offline: z.boolean(),
  configured: z.boolean(),
  chatgptConnected: z.boolean(),
  email: z.string().nullable(),
  hostLocal: z.boolean(),
  connecting: z.boolean(),
  error: z.string().nullable(),
});
export const ModelList = z.array(z.object({ id: z.string() }));
export const ChatGptLink = z.object({ url: z.url() });
export const ProviderKeyInput = z.object({ key: z.string().trim().min(1).max(4096) }).strict();

export const PasscodeInput = z.object({ passcode: z.string().min(1).max(256) }).strict();
export const QuickStartInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    characterName: z.string().trim().min(1).max(80),
    archetype: z
      .string()
      .regex(/^[a-z-]+$/)
      .default("cutpurse"),
    ancestry: z
      .string()
      .regex(/^[a-z-]+$/)
      .default("human"),
    /** Which authored test world to start in. */
    world: z.enum(["ashford-ferry", "tavern-brawl"]).default("ashford-ferry"),
  })
  .strict();
/** Legacy (spec 03): a new character after a hardcore death, from the same world's options. */
export const LegacyInput = z
  .object({
    characterName: z.string().trim().min(1).max(80),
    /** Defaults to the fallen character's origin and background. */
    archetype: z
      .string()
      .regex(/^[a-z0-9:-]+$/)
      .optional(),
    ancestry: z
      .string()
      .regex(/^[a-z0-9:-]+$/)
      .optional(),
  })
  .strict();
export const SubmitTurnInput = z
  .object({
    input: z.string().trim().min(1).max(4000),
    clientTurnId: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/),
    clarification: z.object({ turnId: z.string(), option: z.number().int().min(0).max(4) }).optional(),
  })
  .strict();
export const CampaignCard = z.object({
  id: z.string(),
  name: z.string(),
  characterName: z.string(),
  updatedAt: z.string(),
});
export type CampaignCard = z.infer<typeof CampaignCard>;
export const WebTurn = z.object({
  id: z.string(),
  input: z.string(),
  status: z.string(),
  narration: z.string().nullable(),
  mechanics: z.array(MechanicsLine),
  clarification: z
    .object({ question: z.string(), options: z.array(z.object({ label: z.string() })) })
    .optional(),
  guard: GuardSummary.optional(),
  answer: z.string().optional(),
});
export const GameView = z.object({
  id: z.string(),
  name: z.string(),
  gameTime: z.number(),
  worldName: z.string(),
  opening: z.string(),
  originName: z.string(),
  backgroundName: z.string(),
  speakers: z.record(z.string(), z.string()).default({}),
  pc: CharacterSheet,
  skills: z.array(z.object({ id: z.string(), name: z.string(), value: z.number() })),
  scene: z
    .object({
      location: z.string(),
      zone: z.string(),
      weather: z.string(),
      present: z.array(z.object({ id: z.string(), name: z.string() })),
    })
    .nullable(),
  turns: z.array(WebTurn),
  suggestions: z.array(z.string()),
  offline: z.boolean(),
  /** The fight, as the PC perceives it (spec 13 combat panel). */
  combat: CombatView.nullable().default(null),
  /** Set when the PC has died in a hardcore campaign: the obituary and the Legacy offer. */
  ended: z
    .object({ reason: z.literal("death"), obituary: z.string() })
    .nullable()
    .default(null),
});
export type GameView = z.infer<typeof GameView>;
export type WebTurn = z.infer<typeof WebTurn>;
export const AuthStatus = z.object({
  setupRequired: z.boolean(),
  authenticated: z.boolean(),
  offline: z.boolean(),
});
export const QuickStartOptions = z.object({
  archetypes: z.array(z.object({ id: z.string(), name: z.string() })),
  ancestries: z.array(z.object({ id: z.string(), name: z.string() })),
});
export const CreatedCampaign = z.object({ id: z.string() });
export const AcceptedTurn = z.object({ turnId: z.string() });
export const WebStreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("turn.accepted"), turnId: z.string() }),
  z.object({ type: z.literal("mechanics.line"), line: MechanicsLine }),
  z.object({ type: z.literal("narration.delta"), delta: z.string() }),
  z.object({ type: z.literal("narration.final"), text: z.string(), turnId: z.string() }),
  z.object({
    type: z.literal("clarify"),
    clarification: z.object({ question: z.string(), options: z.array(z.object({ label: z.string() })) }),
  }),
  z.object({ type: z.literal("guard.flag"), flags: GuardSummary.shape.flagged }),
  z.object({ type: z.literal("fallback"), message: z.string() }),
  z.object({ type: z.literal("turn.completed"), turnId: z.string() }),
  z.object({ type: z.literal("error"), message: z.string(), retryable: z.boolean() }),
]);

import { z } from "zod";
import { GuardSummary } from "./canon.ts";
import { CombatView } from "./combat.ts";
import { MechanicsLine, ResolutionId } from "./common.ts";
import { Card, Choice } from "./gm.ts";
import { BaseCampaignPreset, CampaignPreset, CampaignSettings, ProgressionMode } from "./settings.ts";
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
    /** Optional with a pregen, which brings its own name. */
    characterName: z.string().trim().max(80).default(""),
    /** A pack pregen (spec 04 quick start); otherwise the archetype and ancestry below. */
    pregen: z
      .string()
      .regex(/^[a-z-]+$/)
      .optional(),
    archetype: z
      .string()
      .regex(/^[a-z-]+$/)
      .default("cutpurse"),
    ancestry: z
      .string()
      .regex(/^[a-z-]+$/)
      .default("human"),
    progression: ProgressionMode.default("classless"),
    preset: CampaignPreset.default("standard"),
    storyMode: z.enum(["threatClock", "livingWorld"]).default("threatClock"),
    resolution: ResolutionId.default("d100"),
    hardcore: z.boolean().default(false),
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
  /** Cards and choices the GM showed on this turn (D144); empty for classic turns. */
  cards: z.array(Card).default([]),
  choices: z.array(Choice).default([]),
  /** The GM turn ran on a fallback model (usage limit or failure). */
  backup: z.boolean().default(false),
  /** The structural check's flags for claims the turn did not record. */
  checkFlags: z.array(z.object({ quote: z.string(), claim: z.string() })).default([]),
  /** The latest retcon on this turn, with whether it can still be undone. */
  retcon: z
    .object({
      retconId: z.string(),
      summary: z.string(),
      undone: z.boolean(),
      undoable: z.boolean(),
    })
    .optional(),
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
  /** The campaign's dice system, locked at creation (spec 02, 12). */
  resolution: ResolutionId.default("d100"),
  /** `value` is the canonical 0–100 skill; `display` is the module's notation ("65%" or "+3"). */
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      value: z.number(),
      display: z.string().default(""),
    }),
  ),
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
  /** How people in this world address the PC (spec 13 forms of address); player-correctable. */
  address: z.string().default("traveller"),
  /** Entities the PC knows, for reference cards on names in the narration (spec 13). */
  known: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() })).default([]),
  /** Set when the PC has died in a hardcore campaign: the obituary and the Legacy offer. */
  ended: z
    .object({ reason: z.literal("death"), obituary: z.string() })
    .nullable()
    .default(null),
  /** The shop at the current settlement (spec 11, Money); null when there is none. */
  shop: z
    .object({
      id: z.string(),
      name: z.string(),
      attitude: z.number().int(),
      items: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          basePrice: z.number().int().nonnegative(),
          price: z.number().int().nonnegative(),
          stock: z.number().int().nonnegative(),
        }),
      ),
    })
    .nullable()
    .default(null),
  /** Pack theme tokens (spec 13); null when the pack has no theme.yaml. */
  theme: z.unknown().nullable().default(null),
  /** Survival state and recent notices (spec 11). Empty when the subsystems are off. */
  survival: z
    .object({
      food: z.number().int().nonnegative(),
      water: z.number().int().nonnegative(),
      sleep: z.number().nonnegative(),
      exposure: z.number().int().nonnegative(),
      exposureKind: z.string(),
      notices: z.array(z.object({ id: z.string(), kind: z.string(), text: z.string() })),
    })
    .default({
      food: 0,
      water: 0,
      sleep: 0,
      exposure: 0,
      exposureKind: "none",
      notices: [],
    }),
  /** The PC's pack, weight and money (spec 11, spec 13 Inventory). */
  inventory: z
    .object({
      capacityKg: z.number().nonnegative(),
      weightKg: z.number().nonnegative(),
      band: z.enum(["none", "burdened", "heavilyBurdened", "overloaded"]),
      coins: z.number().int().nonnegative(),
      items: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          qty: z.number().int().positive(),
          location: z.string(),
          condition: z.string(),
          kind: z.enum(["weapon", "armor", "gear"]).default("gear"),
          description: z.string().default(""),
          quality: z.string(),
        }),
      ),
    })
    .default({ capacityKg: 0, weightKg: 0, band: "none", coins: 0, items: [] }),
  /** Known spells from the frozen pack (spec 05, the spellcasting plugin). */
  spells: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        school: z.string(),
        tier: z.number().int(),
        apCost: z.number().int(),
        range: z.string(),
        target: z.string(),
        strain: z.number().int(),
        concentration: z.boolean().default(false),
        description: z.string().default(""),
      }),
    )
    .default([]),
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

// ── Campaign settings (spec 12): the current settings, preset label and locked fields ────────────
export const SettingsLock = z.object({ path: z.string(), reason: z.string() });
export type SettingsLock = z.infer<typeof SettingsLock>;
export const CampaignSettingsView = z.object({
  settings: CampaignSettings,
  preset: z.object({
    id: CampaignPreset,
    base: BaseCampaignPreset.nullable(),
    label: z.string(),
  }),
  locks: z.array(SettingsLock),
});
export type CampaignSettingsView = z.infer<typeof CampaignSettingsView>;
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
  z.object({
    type: z.literal("progress"),
    phase: z.enum(["researching", "rolling", "simulating", "writing"]),
    detail: z.string().optional(),
  }),
  z.object({ type: z.literal("card"), card: Card }),
  z.object({ type: z.literal("choices"), choices: z.array(Choice) }),
  z.object({ type: z.literal("model.backup"), provider: z.string() }),
  z.object({
    type: z.literal("check.flag"),
    turnId: z.string(),
    flags: z.array(z.object({ quote: z.string(), claim: z.string() })),
  }),
]);

// ── M5: Journal, Codex and Map (spec 13), all filtered to what the PC knows ─────────────────────
export const CodexEntry = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  summary: z.string(),
  how: z.string(),
  standing: z.string().optional(),
  facts: z.array(
    z.object({
      id: z.string(),
      predicate: z.string(),
      value: z.string(),
      how: z.string(),
      pinned: z.boolean(),
      editable: z.boolean(),
    }),
  ),
});
export type CodexEntry = z.infer<typeof CodexEntry>;
export const CodexView = z.object({
  address: z.string(),
  pins: z.number().int(),
  entries: z.array(CodexEntry),
});
export type CodexView = z.infer<typeof CodexView>;

export const JournalView = z.object({
  recap: z.string().nullable(),
  date: z.string(),
  summaries: z.array(
    z.object({ id: z.string(), level: z.enum(["scene", "chapter", "arc"]), text: z.string() }),
  ),
  quests: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      stage: z.string(),
      objectives: z.array(z.object({ text: z.string(), met: z.boolean() })),
    }),
  ),
  leads: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string() })),
  clocks: z.array(z.object({ name: z.string(), filled: z.number().int(), segments: z.number().int() })),
  rumours: z.array(z.string()),
  notes: z.string(),
});
export type JournalView = z.infer<typeof JournalView>;

export const MapView = z.object({
  regions: z.array(z.object({ id: z.string(), name: z.string() })),
  sites: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      regionId: z.string(),
      visited: z.boolean(),
      here: z.boolean(),
    }),
  ),
  routes: z.array(
    z.object({
      a: z.string(),
      b: z.string(),
      days: z.number(),
      terrain: z.string(),
      danger: z.number().int(),
    }),
  ),
});
export type MapView = z.infer<typeof MapView>;
export const PinInput = z.object({ pinned: z.boolean() }).strict();
export const RetconInput = z.object({ value: z.string().trim().min(1).max(500) }).strict();
export const AddressInput = z.object({ address: z.string().trim().min(1).max(40) }).strict();
export const NotesInput = z.object({ notes: z.string().max(12000) }).strict();

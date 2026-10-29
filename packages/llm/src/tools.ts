import { CombatAction, EntityKind, ExplorationAction } from "@wyrd/core";
import { z } from "zod";
import type { ToolDef } from "./types.ts";

/** Parser tools (spec 08, step 2). Their JSON schemas are generated from the same zod schemas the engine validates. */
export const ProposeActions = z.object({
  actorId: z
    .string()
    .optional()
    .describe("Omit for the player character. Only set it to a companion the player commands. Never an NPC."),
  actions: z.array(ExplorationAction).min(1),
  intent: z.string(),
});

export const AskClarification = z.object({
  question: z.string().min(1),
  options: z
    .array(z.object({ label: z.string().min(1), actions: z.array(ExplorationAction).optional() }))
    .min(2)
    .max(5),
});

/** In a fight the parser proposes combat actions (spec 03 AP table) instead. */
export const ProposeCombatActions = z.object({
  actorId: z.string().optional(),
  actions: z.array(CombatAction).min(1),
  intent: z.string(),
});
export const AskCombatClarification = z.object({
  question: z.string().min(1),
  options: z
    .array(z.object({ label: z.string().min(1), actions: z.array(CombatAction).optional() }))
    .min(2)
    .max(5),
});

export const AnswerOoc = z.object({
  topic: z.enum(["rules", "recap", "status", "other"]),
  question: z.string().min(1),
});

/** Guard report v1 (spec 07): contradictions, state claims, new entities and new facts. Secrets, witnesses, objectives and approval are guard v2 (M5). */
export const GuardReportV1 = z.object({
  contradictions: z
    .array(
      z.object({
        quote: z.string(),
        conflictsWith: z.object({ factId: z.string().optional(), resolution: z.string().optional() }),
        severity: z.enum(["minor", "major"]),
      }),
    )
    .default([]),
  stateClaims: z.array(z.object({ quote: z.string(), claim: z.string() })).default([]),
  newEntities: z
    .array(z.object({ name: z.string().min(1), kind: EntityKind, description: z.string().default("") }))
    .default([]),
  newFacts: z
    .array(z.object({ entityId: z.string(), predicate: z.string(), value: z.string(), quote: z.string() }))
    .default([]),
  // Guard v2 (M5, spec 07).
  secretsRevealed: z.array(z.object({ quote: z.string(), factId: z.string() })).default([]),
  linesCrossed: z.array(z.object({ quote: z.string(), line: z.string() })).default([]),
  witnessObservations: z
    .array(
      z.object({
        witnessIds: z.array(z.string()).min(1),
        content: z.string().min(1),
        importance: z.number().int().min(1).max(5).default(3),
        feeling: z.number().int().min(-3).max(3).default(0),
      }),
    )
    .default([]),
  objectiveMet: z
    .array(
      z.object({
        questId: z.string(),
        objectiveIndex: z.number().int().nonnegative(),
        evidence: z.string().min(1),
      }),
    )
    .default([]),
  approvalDeltas: z
    .array(z.object({ companionId: z.string(), delta: z.number().int(), reason: z.string() }))
    .default([]),
});
export type GuardReportV1 = z.infer<typeof GuardReportV1>;

const schemaOf = (s: z.ZodType) => {
  const json = z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
};

export const PARSER_TOOLS: ToolDef[] = [
  {
    name: "propose_actions",
    description: "Propose the ordered list of actions the player is attempting.",
    parameters: schemaOf(ProposeActions),
  },
  {
    name: "ask_clarification",
    description: "Ask the player to choose when their input is ambiguous in a way that changes the outcome.",
    parameters: schemaOf(AskClarification),
  },
  {
    name: "answer_ooc",
    description: "The player asked an out-of-character question.",
    parameters: schemaOf(AnswerOoc),
  },
];

/** Parser tools for a mode: exploration actions, or combat actions in a fight. */
export function parserTools(mode: "exploration" | "combat"): ToolDef[] {
  if (mode === "exploration") return PARSER_TOOLS;
  return [
    {
      name: "propose_actions",
      description:
        "Propose the ordered combat actions the player is attempting this turn (they must fit in the AP left).",
      parameters: schemaOf(ProposeCombatActions),
    },
    {
      name: "ask_clarification",
      description:
        "Ask the player to choose when their input is ambiguous in a way that changes the outcome.",
      parameters: schemaOf(AskCombatClarification),
    },
    PARSER_TOOLS[2]!,
  ];
}

export const GUARD_TOOL: ToolDef = {
  name: "report_canon",
  description: "Report canon problems and new canon in the draft narration.",
  parameters: schemaOf(GuardReportV1),
};

/** Blocking issues (spec 07, guard policy): state claims and major contradictions. */
export function blockingIssues(r: GuardReportV1): Array<{ kind: string; quote: string; detail: string }> {
  return [
    ...r.stateClaims.map((c) => ({ kind: "stateClaim", quote: c.quote, detail: c.claim })),
    ...r.contradictions
      .filter((c) => c.severity === "major")
      .map((c) => ({
        kind: "contradiction",
        quote: c.quote,
        detail: c.conflictsWith.resolution ?? `conflicts with fact ${c.conflictsWith.factId ?? "?"}`,
      })),
    // Never show a secret's content to the player: the detail names only the fact id.
    ...r.secretsRevealed.map((s) => ({
      kind: "secret",
      quote: s.quote,
      detail: `reveals a secret (${s.factId})`,
    })),
    ...r.linesCrossed.map((l) => ({
      kind: "line",
      quote: l.quote,
      detail: `crosses the player's line: ${l.line}`,
    })),
  ];
}

/**
 * The flags the player sees. `blockingIssues` detail can quote a secret fact the guard was given to
 * check, so only the kind and the quoted narration line are safe to persist and send to the browser.
 */
export function guardFlags(r: GuardReportV1): Array<{ kind: string; quote: string; detail: string }> {
  return blockingIssues(r).map(({ kind, quote }) => ({
    kind,
    quote,
    detail:
      kind === "stateClaim"
        ? "asserts a change the engine did not make"
        : "conflicts with an established fact",
  }));
}

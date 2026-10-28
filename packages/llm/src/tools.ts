import { EntityKind, ExplorationAction } from "@wyrd/core";
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

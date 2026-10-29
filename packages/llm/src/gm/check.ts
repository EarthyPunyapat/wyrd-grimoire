import { defaultTuning, EntityKind, type EventDraft } from "@wyrd/core";
import { z } from "zod";
import { CHECK_INSTRUCTIONS, CHECK_VERSION } from "../prompts/check.ts";
import type { RoleRouter } from "../router.ts";
import { proposeStructured } from "../structured.ts";

export type CheckFlag = { quote: string; claim: string };
export type CheckEntity = { name: string; kind: EntityKind };
export type CheckResult = { flags: CheckFlag[]; entities: CheckEntity[] };

const CheckReportSchema = z.object({
  claims: z.array(z.object({ quote: z.string().min(1), claim: z.string().min(1) })).default([]),
  entities: z.array(z.object({ name: z.string().min(1), kind: EntityKind })).default([]),
});

/** Meta events are not changes; the check only cares about what a turn recorded. */
const META = new Set(["TurnStarted", "TurnCompleted", "NarrationCommitted"]);

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** One plain line per committed change, for the check's prompt and the turn record. */
export function describeDrafts(drafts: EventDraft[]): string[] {
  return drafts.flatMap((d) => {
    if (META.has(d.type)) return [];
    const p = d.payload as Record<string, unknown>;
    const fact = (p.fact ?? {}) as Record<string, unknown>;
    const entity = (p.entity ?? {}) as Record<string, unknown>;
    const quest = (p.quest ?? {}) as Record<string, unknown>;
    switch (d.type) {
      case "ItemDefined":
        return [`item ${text(p.itemId)} defined as "${text((p.def as Record<string, unknown>)?.name)}"`];
      case "ItemTransferred":
        return [`item ${text(p.itemId)} ×${String(p.qty ?? 1)} moved for ${text(p.actorId)}`];
      case "CoinsChanged":
        return [`coins ${Number(p.delta) >= 0 ? "+" : ""}${String(p.delta)} for ${text(p.actorId)}`];
      case "HpChanged":
        return [`HP is now ${String(p.hp)} for ${text(p.actorId)} (${String(p.delta)})`];
      case "EntityCreated":
        return [`entity "${text(entity.name)}" (${text(entity.kind)}) created`];
      case "EntityUpdated":
        return [`entity ${text(entity.id ?? p.entityId)} updated`];
      case "FactAsserted":
        return [
          `fact "${text(fact.predicate)}: ${text(fact.value)}" about ${text(fact.entityId ?? p.entityId)}`,
        ];
      case "FactRetracted":
        return [`fact ${text(p.factId)} retracted`];
      case "QuestStarted":
        return [`quest "${text(quest.title)}" started`];
      case "QuestEnded":
        return [`quest ${text(p.questId)} ended (${text(p.status)})`];
      case "QuestObjectiveMet":
        return [`quest ${text(p.questId)} objective ${String(p.objectiveIndex)} met`];
      case "ClockAdvanced":
        return [`clock ${text(p.clockId)} advanced by ${String(p.by)}`];
      case "XpAwarded":
        return [`${String(p.amount)} XP awarded`];
      case "CheckResolved":
        return ["a check was rolled"];
      case "RetconApplied":
        return [`a retcon was applied: ${text(p.summary)}`];
      default:
        return [d.type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()];
    }
  });
}

function renderInput(o: { prose: string; drafts: EventDraft[]; known: string[] }): string {
  const changes = describeDrafts(o.drafts);
  return [
    "Story passage:",
    o.prose,
    "",
    "Recorded changes this turn:",
    ...(changes.length ? changes.map((c) => `- ${c}`) : ["- none"]),
    "",
    "Known entity names:",
    ...(o.known.length ? o.known.map((n) => `- ${n}`) : ["- none"]),
  ].join("\n");
}

/**
 * Reads one GM passage against the turn's recorded changes (D144). Never blocks or fails a turn:
 * any model or validation failure comes back as empty lists.
 */
export async function checkTurn(
  router: RoleRouter,
  o: { prose: string; drafts: EventDraft[]; known: string[]; turnId: string },
): Promise<CheckResult> {
  try {
    const parsed = await proposeStructured(router, {
      role: "check",
      tool: "report_unrecorded",
      schema: CheckReportSchema,
      instructions: CHECK_INSTRUCTIONS,
      input: renderInput(o),
      promptVersion: CHECK_VERSION,
      maxOutputTokens: 4096,
      timeoutMs: defaultTuning.gm.checkTimeoutMs,
    });
    const known = new Set(o.known.map((name) => name.trim().toLowerCase()));
    const seen = new Set<string>();
    const entities = parsed.entities.filter((e) => {
      const key = e.name.trim().toLowerCase();
      if (known.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { flags: parsed.claims, entities };
  } catch {
    return { flags: [], entities: [] };
  }
}

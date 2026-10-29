import type { ActorId, CombatView } from "@wyrd/core";
import { effectiveHpMax } from "../injury/hp.ts";
import type { GameState } from "../state.ts";
import { legalActions } from "./actions.ts";
import {
  type CombatContext,
  combatant,
  currentActor,
  engagedWith,
  perceivedHealth,
  sheetOf,
  zoneOf,
  zoneTags,
} from "./common.ts";

const CONDITION_LABEL: Record<string, string> = {
  "core:down": "down",
  "core:unconscious": "unconscious",
  "core:prone": "prone",
  "core:bleeding": "bleeding",
  "core:in-cover": "in cover",
  "core:grappled": "grappled",
  "core:stunned": "stunned",
  "core:dazed": "dazed",
  "core:blinded": "blinded",
  "core:frightened": "frightened",
};

/** Describes a fight from the PC's side for the browser (spec 13): perceived health for strangers. */
export function combatView(state: GameState, pcId: ActorId, ctx: CombatContext): CombatView | null {
  const combat = state.combat;
  if (!combat || !state.scene) return null;
  const me = combatant(state, pcId);
  const current = currentActor(state) ?? pcId;
  const fill = (a: { type: string; targetId?: string; toZoneId?: string }) => {
    switch (a.type) {
      case "strike":
        return `I attack ${ctx.nameOf(a.targetId!)}`;
      case "engage":
        return `I close in on ${ctx.nameOf(a.targetId!)}`;
      case "move":
        return `I move to ${ctx.nameOf(a.toZoneId!)}`;
      case "firstAid":
        return a.targetId === pcId ? "I bind my wounds" : `I give first aid to ${ctx.nameOf(a.targetId!)}`;
      case "takeCover":
        return "I take cover";
      case "standUp":
        return "I get up";
      default:
        return `I ${a.type.replace(/([A-Z])/g, " $1").toLowerCase()}`;
    }
  };
  // A manually controlled companion's options read as orders: "Mira will attack the bandit".
  const voice = (text: string) =>
    pcId === state.party.pcId
      ? text
      : text.replace(/^I /, `${ctx.nameOf(pcId)} will `).replace(/\bmy wounds\b/, "their wounds");
  return {
    round: combat.round,
    currentActorId: current,
    yourTurn: current === pcId,
    ap: { current: me?.ap ?? 0, max: ctx.tuning.fight.apPerTurn },
    zones: state.scene.zones.map((z) => ({ id: z.id, name: z.name, tags: zoneTags(state, z.id) })),
    edges: state.scene.edges.map((e) => ({ a: e.a, b: e.b })),
    combatants: combat.order.flatMap((id) => {
      const c = combat.combatants[id]!;
      if (c.status === "fled" && c.side === "enemy") return [];
      const sheet = sheetOf(state, id);
      const party = c.side === "party";
      const frac = sheet.status.hp / Math.max(1, effectiveHpMax(sheet));
      const conditions = sheet.status.conditions.flatMap((x) =>
        CONDITION_LABEL[x.id] ? [CONDITION_LABEL[x.id]!] : [],
      );
      const status = state.actors[id]?.dead
        ? "dead"
        : c.status === "active" && c.fleeing
          ? "fleeing"
          : c.status;
      return [
        {
          id,
          name: ctx.nameOf(id),
          side: id === pcId ? ("pc" as const) : party ? ("ally" as const) : ("enemy" as const),
          status,
          health: party ? Math.max(0, Math.min(1, frac)) : perceivedHealth(frac),
          condition:
            status !== "active"
              ? status
              : (conditions[0] ?? (frac >= 0.95 ? "unhurt" : frac >= 0.5 ? "hurt" : "badly hurt")),
          zoneId: zoneOf(state, id) ?? "",
          engagedWith: engagedWith(state, id),
          wounds: sheet.status.wounds.map((w) => ({ location: w.location, severity: w.severity })),
          conditions,
        },
      ];
    }),
    actions: me
      ? legalActions(state, pcId, ctx).map((a) => ({
          label: a.label,
          ap: a.ap,
          legal: a.legal && current === pcId,
          ...(a.reason ? { reason: a.reason } : current !== pcId ? { reason: "Not your turn" } : {}),
          fill: voice(fill(a.action as { type: string; targetId?: string; toZoneId?: string })),
        }))
      : [],
  };
}

import {
  type CampaignImport,
  type CompiledPack,
  draft,
  Entity,
  type EventDraft,
  Fact,
  slugify,
} from "@wyrd/core";
import type { GameState } from "@wyrd/engine";
import { recruitSheet } from "./party.ts";

const REASON = "Imported from your ChatGPT campaign";
const HISTORY = "concept:imported-history";

/**
 * Turns a reviewed ChatGPT import (D142) into the new campaign's events, after the PC exists: the PC's
 * powers as abilities, each companion as a loyal companion with their voice and level, and the history
 * as player facts. The PC's name, level, backstory and gear travel in the creation draft instead.
 */
export function importEvents(
  imported: CampaignImport,
  o: { pcId: string; pack: CompiledPack; settings: GameState["campaign"]["settings"] },
): EventDraft[] {
  const events: EventDraft[] = [];
  const used = new Set<string>();
  const unique = (base: string) => {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
  imported.pc.abilities.forEach((a, i) => {
    events.push(
      draft("AbilityGained", {
        actorId: o.pcId,
        ability: {
          id: unique(`import:${slugify(a.name, `ability-${i + 1}`)}`),
          name: a.name,
          description: a.description,
          level: imported.pc.level,
          cost: "At will",
          rank: a.rank,
        },
      }),
    );
  });
  imported.companions.forEach((c, i) => {
    const id = unique(`npc:${slugify(c.name, `companion-${i + 1}`)}`);
    const entity = Entity.parse({ id, kind: "npc", name: c.name, detail: "full", summary: c.summary });
    events.push(draft("EntityCreated", { entity }));
    const sheet = recruitSheet(o.pack, entity, id, o.settings);
    if (!sheet) return;
    events.push(
      draft("CompanionJoined", { companionId: id, reason: REASON, sheet: { ...sheet, level: c.level } }),
    );
    events.push(draft("CompanionBondSet", { companionId: id, bond: { loyal: true, voiceProfile: c.voice } }));
  });
  if (imported.history.length) {
    events.push(
      draft("EntityCreated", {
        entity: Entity.parse({
          id: HISTORY,
          kind: "concept",
          name: "Your story so far",
          detail: "full",
          summary: "What happened before this campaign, carried over from your ChatGPT chats.",
        }),
      }),
    );
    imported.history.forEach((h, i) => {
      events.push(
        draft("FactAsserted", {
          fact: Fact.parse({
            id: `fact:import-${i + 1}`,
            entityId: HISTORY,
            predicate: h.subject,
            value: h.fact,
            source: "player",
            importance: 4,
          }),
        }),
      );
    });
  }
  return events;
}

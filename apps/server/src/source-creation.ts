import { draft, Entity, type EventDraft, Fact, MAIN_WORLD, type WorldPitch } from "@wyrd/core";
import type { ResearchedSource } from "@wyrd/llm";

/** Resolve source names against compiled bible/opening ids, retaining provenance without page text. */
export function sourceEvents(
  source: ResearchedSource,
  input: WorldPitch,
  existing: EventDraft[],
  startedAt: number,
): EventDraft[] {
  const events: EventDraft[] = [];
  const entities = existing.flatMap((e) => (e.type === "EntityCreated" ? [e.payload.entity] : []));
  const find = (name: string, kind: "npc" | "concept") => {
    const found = entities.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const entity = Entity.parse({
      id: `source:${kind}:${entities.length}`,
      name,
      kind,
      detail: "sketch",
      worldId: MAIN_WORLD,
    });
    entities.push(entity);
    events.push(draft("EntityCreated", { entity }, "model"));
    return entity.id;
  };
  if (input.source) events.push(draft("CanonSourceSet", { worldId: MAIN_WORLD, source: input.source.title }));
  const concept = find(input.source?.title ?? "Source", "concept");
  for (const [i, value] of source.research.facts.entries())
    events.push(
      draft(
        "FactAsserted",
        {
          fact: Fact.parse({
            id: `source:research:${i}`,
            entityId: concept,
            predicate: "note",
            value,
            source: "lore",
            confidence: source.research.confidence,
            evidence: source.research.evidence,
            worldId: MAIN_WORLD,
            visibility: "secret",
          }),
        },
        "model",
      ),
    );
  events.push(
    draft(
      "LoreRecorded",
      {
        record: {
          id: "source:research",
          entityId: concept,
          worldId: MAIN_WORLD,
          query: input.source!.title,
          wiki: input.source!.wiki,
          title: source.research.title,
          summary: source.research.facts.join("\n\n"),
          confidence: source.research.confidence,
          url: source.research.evidence?.quote,
        },
      },
      "model",
    ),
  );
  const profiles = [...source.characters];
  for (const entity of entities.filter((e) => e.kind === "npc")) {
    if (profiles.some((p) => p.name.toLowerCase() === entity.name.toLowerCase())) continue;
    const npc = source.bible.npcs.find((n) => n.name.toLowerCase() === entity.name.toLowerCase());
    profiles.push({
      name: entity.name,
      motivation: npc?.want ?? entity.summary,
      action: npc ? `Pursues ${npc.want}` : `Goes about their role: ${entity.summary}`,
      paceDays: 1,
    });
  }
  for (const c of profiles)
    events.push(
      draft(
        "CanonActorConfigured",
        {
          profile: {
            entityId: find(c.name, "npc"),
            worldId: MAIN_WORLD,
            motivation: c.motivation,
            action: c.action,
            paceDays: c.paceDays,
            startedAt,
          },
        },
        "model",
      ),
    );
  for (const [i, c] of source.canonEvents.entries()) {
    const entityId = find(c.subject, "concept");
    events.push(
      draft(
        "ClockCreated",
        {
          clock: {
            id: `clock:canon:${i}`,
            name: c.name,
            kind: "canon",
            segments: c.days,
            filled: 0,
            paceDays: 1,
            visible: false,
            worldId: MAIN_WORLD,
            canon: {
              startedAt,
              outcome: { entityId, predicate: c.predicate, value: c.value },
              intervention: { entityId, predicate: c.interventionPredicate },
            },
          },
        },
        "model",
      ),
    );
  }
  for (const ability of source.abilities)
    events.push(draft("AbilityGained", { actorId: "pc", ability }, "model"));
  return events;
}

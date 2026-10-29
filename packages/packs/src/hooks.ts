import { type BackstoryHook, draft, type EventDraft, type HookPlacements } from "@wyrd/core";
import { entity, fact, Ids } from "./world-bible.ts";

type Placement = HookPlacements["placements"][number];
type Named = { id: string; name: string; kind: string };

/** Sites, factions and the opening location already in the canon events, by lower-cased name. */
function named(events: readonly EventDraft[]): Named[] {
  return events.flatMap((e) =>
    e.type === "EntityCreated"
      ? [
          {
            id: (e.payload as { entity: Named }).entity.id,
            name: (e.payload as { entity: Named }).entity.name,
            kind: (e.payload as { entity: Named }).entity.kind,
          },
        ]
      : [],
  );
}

/**
 * A fallback placement when no model places the hooks: people go to sites in turn, away from the
 * start site (by name) where there's a choice, and nobody joins a faction.
 */
export function defaultPlacements(
  hooks: readonly BackstoryHook[],
  events: readonly EventDraft[],
  startSite?: string,
): HookPlacements {
  const sites = named(events).filter((e) => e.kind === "site");
  const away = sites.filter((s) => s.name.toLowerCase() !== startSite?.toLowerCase());
  const pool = away.length ? away : sites;
  return {
    placements: hooks.map((h, i) => ({
      hook: i,
      site: h.kind === "secret" || h.kind === "debt" || !pool.length ? null : pool[i % pool.length]!.name,
      faction: null,
      now: "",
    })),
  };
}

/**
 * Backstory hooks → canon (spec 04): each becomes an entity flagged `backstoryHook` that the PC knows.
 * Rivals, bonds and missing people are NPCs placed at a site (a missing person's whereabouts are a
 * secret); a debt is owed to a person or faction and runs a visible clock; a secret is a fact only
 * the PC knows. Returns the new ids (for the sheet's `hookIds`) and the events.
 */
export function hookEvents(
  hooks: readonly BackstoryHook[],
  pcId: string,
  existing: readonly EventDraft[],
  placements: HookPlacements,
  gameTime = 0,
): { ids: string[]; events: EventDraft[] } {
  const all = named(existing);
  const ids = new Ids(all.map((e) => e.id));
  const find = (kind: string, name: string | null | undefined) =>
    name ? all.find((e) => e.kind === kind && e.name.toLowerCase() === name.toLowerCase()) : undefined;
  const out: EventDraft[] = [];
  const made: string[] = [];
  const knows = (entityId: string, factId?: string) =>
    out.push(
      draft(
        "KnowledgeGained",
        { entityId, ...(factId ? { factId } : {}), entry: { how: "witnessed", gameTime } },
        "engine",
      ),
    );
  const edge = (from: string, to: string, type: string, strength = 0.8) =>
    out.push(
      draft(
        "RelationshipChanged",
        { edge: { from, to, type, strength, data: { backstoryHook: true } } },
        "engine",
      ),
    );

  hooks.forEach((h, i) => {
    const p: Placement | undefined = placements.placements.find((x) => x.hook === i);
    const site = find("site", p?.site);
    const faction = find("faction", p?.faction);
    if (h.kind === "secret") {
      const id = ids.make("concept", h.name);
      out.push(
        draft(
          "EntityCreated",
          {
            entity: entity({
              id,
              kind: "concept",
              name: h.name,
              detail: "sketch",
              data: { backstoryHook: h.kind },
              importance: 4,
            }),
          },
          "engine",
        ),
        draft(
          "FactAsserted",
          {
            fact: fact({
              id: `fact:${id}:secret`,
              entityId: id,
              predicate: "secret",
              value: h.description || h.name,
              source: "player",
              visibility: "secret",
              importance: 5,
            }),
          },
          "engine",
        ),
      );
      knows(id, `fact:${id}:secret`);
      made.push(id);
      return;
    }
    // A debt owed to a faction attaches to it; otherwise the creditor is a person.
    const id = h.kind === "debt" && faction ? faction.id : ids.make("npc", h.name);
    if (id !== faction?.id) {
      out.push(
        draft(
          "EntityCreated",
          {
            entity: entity({
              id,
              kind: "npc",
              name: h.name,
              detail: "sketch",
              summary: h.description,
              data: { backstoryHook: h.kind, ...(site && h.kind !== "missing" ? { siteId: site.id } : {}) },
              importance: 4,
            }),
          },
          "engine",
        ),
      );
      if (faction) edge(id, faction.id, "memberOf", 1);
    }
    knows(id);
    made.push(id);
    if (h.kind === "rival") {
      edge(pcId, id, "rival");
      edge(id, pcId, "rival");
    } else if (h.kind === "bond") {
      edge(pcId, id, "friend");
      edge(id, pcId, "friend");
    } else if (h.kind === "missing") {
      edge(pcId, id, "knows");
      out.push(
        draft(
          "FactAsserted",
          {
            fact: fact({
              id: `fact:${id}:location`,
              entityId: id,
              predicate: "location",
              value: "unknown",
              source: "player",
            }),
          },
          "engine",
        ),
      );
      knows(id, `fact:${id}:location`);
      if (site)
        out.push(
          draft(
            "FactAsserted",
            {
              fact: fact({
                id: `fact:${id}:whereabouts`,
                entityId: id,
                predicate: "secret",
                value: `Is at ${site.name}.`,
                source: "engine",
                visibility: "secret",
                importance: 4,
              }),
            },
            "engine",
          ),
        );
    } else if (h.kind === "debt") {
      edge(pcId, id, "owes");
      out.push(
        draft(
          "ClockCreated",
          {
            clock: {
              id: `clock:debt-${id.split(":")[1]}`,
              name: `What you owe ${h.name}`,
              kind: "deadline",
              segments: 6,
              filled: 0,
              ownerId: id,
              visible: true,
            },
          },
          "engine",
        ),
      );
    }
    if (p?.now)
      out.push(
        draft(
          "FactAsserted",
          {
            fact: fact({
              id: `fact:${id}:now`,
              entityId: id,
              predicate: "secret",
              value: p.now,
              source: "model",
              visibility: "secret",
              importance: 4,
            }),
          },
          "engine",
        ),
      );
  });
  return { ids: made, events: out };
}

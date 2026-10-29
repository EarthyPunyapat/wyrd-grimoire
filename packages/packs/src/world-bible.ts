import {
  draft,
  type Entity,
  type EventDraft,
  type Fact,
  type LocationProposal,
  type SceneInput,
  type Tuning,
  type WorldBible,
} from "@wyrd/core";
import type { WorldDef } from "./world.ts";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "x";

/** Stable, collision-free ids for generated canon (`site:the-drowned-mill`, `-2` on clashes). */
export class Ids {
  private readonly used = new Set<string>();
  constructor(taken: Iterable<string> = []) {
    for (const t of taken) this.used.add(t);
  }
  make(kind: string, name: string): string {
    let id = `${kind}:${slug(name)}`;
    for (let n = 2; this.used.has(id); n++) id = `${kind}:${slug(name)}-${n}`;
    this.used.add(id);
    return id;
  }
}

export const entity = (e: Partial<Entity> & Pick<Entity, "id" | "kind" | "name">): Entity => ({
  aliases: [],
  detail: "stub",
  summary: "",
  data: {},
  status: "active",
  importance: 2,
  ...e,
});
export const fact = (f: Partial<Fact> & Pick<Fact, "id" | "entityId" | "predicate" | "value">): Fact => ({
  source: "model",
  visibility: "public",
  importance: 2,
  ...f,
});

/** The scene a location opens with, kept on the location entity so travel can return to it. */
export type LocationScene = { locationId: string; scene: SceneInput };

/**
 * Stage 1 world bible → canon events (spec 06): regions, sites, routes, factions (with goal clocks
 * and relations), leaders and key NPCs (social edges), the threat (clock + paths) and hooks (quest
 * stubs whose leads start as rumours). The opening location joins the start site. The PC is from
 * this world, so they know its regions, settlements and factions by name.
 */
export function bibleEvents(
  bible: WorldBible,
  world: WorldDef,
  tuning: Tuning,
  gameTime = world.gameTime,
): EventDraft[] {
  const ids = new Ids(world.entities.map((e) => e.id));
  const out: EventDraft[] = [];
  const known = (entityId: string) =>
    out.push(draft("KnowledgeGained", { entityId, entry: { how: "public", gameTime } }, "engine"));
  const siteIds = new Map<string, string>();
  const regionIds = new Map<string, string>();

  for (const r of bible.regions) {
    const regionId = ids.make("region", r.name);
    regionIds.set(r.name.toLowerCase(), regionId);
    out.push(
      draft(
        "EntityCreated",
        {
          entity: entity({
            id: regionId,
            kind: "region",
            name: r.name,
            detail: "sketch",
            summary: r.description,
            data: { climate: r.climate, culture: r.culture },
            importance: 3,
          }),
        },
        "engine",
      ),
    );
    known(regionId);
    for (const s of r.sites) {
      const siteId = ids.make("site", s.name);
      siteIds.set(s.name.toLowerCase(), siteId);
      out.push(
        draft(
          "EntityCreated",
          {
            entity: entity({
              id: siteId,
              kind: "site",
              name: s.name,
              summary: s.description,
              data: { regionId, kind: s.kind },
              importance: 3,
            }),
          },
          "engine",
        ),
        draft(
          "RelationshipChanged",
          { edge: { from: siteId, to: regionId, type: "locatedIn", strength: 1 } },
          "engine",
        ),
      );
      if (s.kind === "settlement" || s.kind === "landmark") known(siteId);
    }
  }
  const site = (name: string) => siteIds.get(name.toLowerCase()) ?? [...siteIds.values()][0]!;
  for (const route of bible.routes) {
    const a = siteIds.get(route.from.toLowerCase());
    const b = siteIds.get(route.to.toLowerCase());
    if (!a || !b || a === b) continue;
    out.push(
      draft(
        "RelationshipChanged",
        {
          edge: {
            from: a,
            to: b,
            type: "routeTo",
            strength: 1,
            data: { days: route.days, terrain: route.terrain, danger: route.danger },
          },
        },
        "engine",
      ),
    );
  }

  // The opening location belongs to the start site and keeps its scene for later returns.
  const start = world.locations.find((l) => l.locationId === world.start.locationId)!;
  const startSite = site(bible.startSite);
  const startScene: SceneInput = {
    id: `scene:${start.locationId}`,
    locationId: start.locationId,
    zones: start.zones,
    edges: start.edges,
    positions: start.positions,
    light: start.light,
    weather: start.weather,
    openedAt: 0,
  };
  out.push(
    draft(
      "EntityUpdated",
      { entityId: start.locationId, patch: { data: { siteId: startSite, scene: startScene } } },
      "engine",
    ),
    draft(
      "EntityUpdated",
      {
        entityId: startSite,
        patch: { data: { ...siteData(out, startSite), arrivalLocationId: start.locationId, visited: true } },
      },
      "engine",
    ),
    draft(
      "RelationshipChanged",
      { edge: { from: start.locationId, to: startSite, type: "locatedIn", strength: 1 } },
      "engine",
    ),
  );
  known(startSite);

  const factionIds = new Map<string, string>();
  for (const f of bible.factions) {
    const factionId = ids.make("faction", f.name);
    factionIds.set(f.name.toLowerCase(), factionId);
    const clocks = f.goals.map((g, i) => ({
      id: `clock:${factionId.slice(8)}-goal-${i + 1}`,
      name: g,
      kind: "faction" as const,
      segments: 8,
      filled: 0,
      ownerId: factionId,
      visible: false,
    }));
    const leaderId = ids.make("npc", f.leader.name);
    out.push(
      draft(
        "EntityCreated",
        {
          entity: entity({
            id: factionId,
            kind: "faction",
            name: f.name,
            detail: "sketch",
            summary: f.description,
            data: { goals: f.goals, methods: f.methods },
            importance: 3,
          }),
        },
        "engine",
      ),
      draft(
        "FactAsserted",
        {
          fact: fact({
            id: `fact:${factionId}:secret`,
            entityId: factionId,
            predicate: "secret",
            value: f.secret,
            visibility: "secret",
            importance: 4,
          }),
        },
        "engine",
      ),
      ...clocks.map((clock) => draft("ClockCreated", { clock }, "engine")),
      draft(
        "EntityCreated",
        {
          entity: entity({
            id: leaderId,
            kind: "npc",
            name: f.leader.name,
            summary: `${f.leader.role} of ${f.name}.`,
            data: { role: f.leader.role },
            importance: 3,
          }),
        },
        "engine",
      ),
      draft(
        "RelationshipChanged",
        { edge: { from: leaderId, to: factionId, type: "leads", strength: 1 } },
        "engine",
      ),
      draft(
        "RelationshipChanged",
        { edge: { from: leaderId, to: factionId, type: "memberOf", strength: 0.8 } },
        "engine",
      ),
    );
    const home = regionIds.get(f.homeRegion.toLowerCase());
    if (home)
      out.push(
        draft(
          "RelationshipChanged",
          { edge: { from: factionId, to: home, type: "locatedIn", strength: 1 } },
          "engine",
        ),
      );
    known(factionId);
    out.push(
      draft(
        "FactionUpdated",
        {
          faction: {
            id: factionId,
            reputation: 0,
            resources: f.resources,
            relations: {},
            goalClockIds: clocks.map((c) => c.id),
          },
        },
        "engine",
      ),
    );
  }
  for (const rel of bible.relations) {
    const a = factionIds.get(rel.a.toLowerCase());
    const b = factionIds.get(rel.b.toLowerCase());
    if (!a || !b || a === b) continue;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const prev = out.findLast((d) => d.type === "FactionUpdated" && d.payload.faction.id === x);
      if (prev?.type === "FactionUpdated")
        prev.payload.faction.relations = { ...prev.payload.faction.relations, [y]: rel.value };
    }
  }

  const npcIds = new Map<string, string>();
  for (const n of bible.npcs) {
    const npcId = ids.make("npc", n.name);
    npcIds.set(n.name.toLowerCase(), npcId);
    const where = site(n.site);
    out.push(
      draft(
        "EntityCreated",
        {
          entity: entity({
            id: npcId,
            kind: "npc",
            name: n.name,
            summary: n.role,
            data: { role: n.role, siteId: where },
          }),
        },
        "engine",
      ),
      draft(
        "FactAsserted",
        {
          fact: fact({
            id: `fact:${npcId}:want`,
            entityId: npcId,
            predicate: "wants",
            value: n.want,
            visibility: "secret",
          }),
        },
        "engine",
      ),
      draft(
        "RelationshipChanged",
        { edge: { from: npcId, to: where, type: "locatedIn", strength: 1 } },
        "engine",
      ),
    );
    if (n.secret)
      out.push(
        draft(
          "FactAsserted",
          {
            fact: fact({
              id: `fact:${npcId}:secret`,
              entityId: npcId,
              predicate: "secret",
              value: n.secret,
              visibility: "secret",
              importance: 4,
            }),
          },
          "engine",
        ),
      );
    const faction = n.faction ? factionIds.get(n.faction.toLowerCase()) : undefined;
    if (faction) {
      out.push(
        draft(
          "RelationshipChanged",
          { edge: { from: npcId, to: faction, type: "memberOf", strength: 0.6 } },
          "engine",
        ),
      );
      // Members answer to their faction's leader: lies and crimes travel up this line.
      const leader = out.find(
        (d) =>
          d.type === "RelationshipChanged" &&
          d.payload.edge.type === "leads" &&
          d.payload.edge.to === faction,
      );
      if (leader?.type === "RelationshipChanged")
        out.push(
          draft(
            "RelationshipChanged",
            { edge: { from: npcId, to: leader.payload.edge.from, type: "reportsTo", strength: 0.7 } },
            "engine",
          ),
        );
    }
  }

  if (bible.threat) {
    const t = bible.threat;
    const clockId = "clock:threat";
    out.push(
      draft(
        "ClockCreated",
        {
          clock: {
            id: clockId,
            name: t.name,
            kind: "threat",
            segments: 12,
            filled: 0,
            paceDays: tuning.world.threatPaceDays,
            visible: true,
          },
        },
        "engine",
      ),
      draft(
        "ThreatCreated",
        {
          threat: {
            name: t.name,
            nature: t.nature,
            ...(t.agentFaction && factionIds.get(t.agentFaction.toLowerCase())
              ? { agentFactionId: factionIds.get(t.agentFaction.toLowerCase())! }
              : {}),
            motive: t.motive,
            paths: t.paths.map((p, i) => ({ id: `path-${i + 1}`, name: p.name, description: p.description })),
            clockId,
            stage: 0,
            stages: 4,
            defeated: false,
          },
        },
        "engine",
      ),
    );
  }

  bible.hooks.forEach((h, i) => {
    const questId = ids.make("quest", h.title);
    const where = site(h.site);
    const local = bible.npcs.find((n) => site(n.site) === where);
    const holder =
      (h.npc && npcIds.get(h.npc.toLowerCase())) ||
      (local && npcIds.get(local.name.toLowerCase())) ||
      undefined;
    out.push(
      draft(
        "EntityCreated",
        {
          entity: entity({
            id: questId,
            kind: "quest",
            name: h.title,
            summary: h.summary,
            data: { siteId: where, hook: true },
            importance: 3,
          }),
        },
        "engine",
      ),
      draft(
        "RumorCreated",
        {
          rumor: {
            id: `rumor:hook-${i + 1}`,
            content: h.summary,
            about: [questId, where, ...(holder ? [holder] : [])],
            truth: { accuracy: "true" },
            ...(holder ? { originId: holder } : {}),
            heat: 0.5,
            secrecy: 0.2,
            createdAt: gameTime,
            urgent: false,
            holders: holder ? { [holder]: { content: h.summary, at: gameTime } } : {},
          },
        },
        "engine",
      ),
    );
  });
  out.push(
    draft(
      "EntityUpdated",
      { entityId: "concept:world-bible", patch: { data: { address: bible.address } } },
      "engine",
    ),
  );
  return out;
}

function siteData(out: EventDraft[], siteId: string): Record<string, unknown> {
  const created = out.find((d) => d.type === "EntityCreated" && d.payload.entity.id === siteId);
  return created?.type === "EntityCreated" ? created.payload.entity.data : {};
}

/**
 * A generated arrival location → canon (spec 06 lazy generation): the location (with its scene
 * kept in data), its people with their secrets, and the site's arrival pointer.
 */
export function locationEvents(
  p: LocationProposal,
  siteId: string,
  siteData: Record<string, unknown>,
  taken: Iterable<string>,
): { events: EventDraft[]; arrival: LocationScene } {
  const ids = new Ids(taken);
  const locationId = ids.make("location", p.name);
  const zoneIds = p.zones.map((_z, i) => `${locationId.replace("location:", "zone:")}-${i + 1}`);
  const people = p.people.map((n) => ({ ...n, id: ids.make("npc", n.name) }));
  const scene: SceneInput = {
    id: `scene:${locationId}`,
    locationId,
    zones: p.zones.map((z, i) => ({ id: zoneIds[i]!, name: z.name, tags: z.tags })),
    edges: zoneIds.slice(1).map((z, i) => ({ a: zoneIds[i]!, b: z })),
    positions: Object.fromEntries(people.map((n) => [n.id, zoneIds[Math.min(n.zone, zoneIds.length - 1)]!])),
    light: p.light,
    weather: p.weather,
    openedAt: 0,
  };
  const events: EventDraft[] = [
    draft(
      "EntityCreated",
      {
        entity: entity({
          id: locationId,
          kind: "location",
          name: p.name,
          detail: "full",
          summary: p.description,
          data: { siteId, scene },
          importance: 3,
        }),
      },
      "engine",
    ),
    draft(
      "FactAsserted",
      {
        fact: fact({
          id: `fact:${locationId}:opening`,
          entityId: locationId,
          predicate: "opening",
          value: p.arrival,
        }),
      },
      "engine",
    ),
    ...p.zones.map((z, i) =>
      draft(
        "FactAsserted",
        {
          fact: fact({
            id: `fact:${locationId}:zone-${i + 1}`,
            entityId: locationId,
            predicate: `zone:${zoneIds[i]}`,
            value: z.description,
          }),
        },
        "engine",
      ),
    ),
    draft(
      "RelationshipChanged",
      { edge: { from: locationId, to: siteId, type: "locatedIn", strength: 1 } },
      "engine",
    ),
    ...people.flatMap((n) => [
      draft(
        "EntityCreated",
        {
          entity: entity({
            id: n.id,
            kind: "npc",
            name: n.name,
            detail: "sketch",
            summary: n.description,
            data: { siteId },
          }),
        },
        "engine",
      ),
      ...(n.secret
        ? [
            draft(
              "FactAsserted",
              {
                fact: fact({
                  id: `fact:${n.id}:secret`,
                  entityId: n.id,
                  predicate: "secret",
                  value: n.secret,
                  visibility: "secret",
                  importance: 4,
                }),
              },
              "engine",
            ),
          ]
        : []),
      draft(
        "RelationshipChanged",
        { edge: { from: n.id, to: siteId, type: "locatedIn", strength: 1 } },
        "engine",
      ),
    ]),
    draft(
      "EntityUpdated",
      { entityId: siteId, patch: { detail: "sketch", data: { ...siteData, arrivalLocationId: locationId } } },
      "engine",
    ),
  ];
  return { events, arrival: { locationId, scene } };
}

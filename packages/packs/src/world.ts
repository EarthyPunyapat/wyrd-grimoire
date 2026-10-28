import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  draft,
  Entity,
  EntityKind,
  type EventDraft,
  Fact,
  Light,
  SceneState,
  Zone,
  ZoneEdge,
} from "@wyrd/core";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Hand-authored worlds (spec 05): `worlds/<id>/world.yaml` in a pack. Loading one commits it as
 * canon events at campaign start; the PC is placed at the start zone.
 */
export const WorldFact = z.object({
  predicate: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  visibility: z.enum(["public", "secret"]).default("public"),
  importance: z.number().int().min(1).max(5).default(2),
});

export const WorldEntity = z.object({
  id: z.string().regex(/^[a-z]+:[a-z0-9-]+$/, "expected kind:local-id, e.g. npc:wenna"),
  kind: EntityKind,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  detail: z.enum(["stub", "sketch", "full"]).default("sketch"),
  importance: z.number().int().min(1).max(5).default(2),
  summary: z.string().default(""),
  facts: z.array(WorldFact).default([]),
});

export const WorldLocation = z.object({
  locationId: z.string(),
  light: Light.default("bright"),
  weather: z.string().default(""),
  zones: z.array(Zone).min(1),
  edges: z.array(ZoneEdge).default([]),
  positions: z.record(z.string(), z.string()).default({}),
});

export const WorldDef = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  premise: z.string().min(1),
  start: z.object({ locationId: z.string(), zoneId: z.string() }),
  gameTime: z.number().int().nonnegative().default(0),
  entities: z.array(WorldEntity).min(1),
  locations: z.array(WorldLocation).min(1),
});
export type WorldDef = z.infer<typeof WorldDef>;

export type WorldIssue = { code: string; path: string; message: string };

/** Lists the worlds a pack ships. */
export function listWorlds(packDir: string): string[] {
  const dir = join(packDir, "worlds");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, "world.yaml")));
}

/** Loads and validates a world: schema, then references (every ID it mentions must exist). */
export function loadWorld(
  packDir: string,
  worldId: string,
): { world: WorldDef | null; issues: WorldIssue[] } {
  const file = join(packDir, "worlds", worldId, "world.yaml");
  if (!existsSync(file))
    return { world: null, issues: [{ code: "FILE_MISSING", path: file, message: `No world ${worldId}` }] };
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, "utf8"));
  } catch (e) {
    return { world: null, issues: [{ code: "YAML_SYNTAX", path: "", message: (e as Error).message }] };
  }
  const parsed = WorldDef.safeParse(raw);
  if (!parsed.success) {
    return {
      world: null,
      issues: parsed.error.issues.map((i) => ({
        code: "SCHEMA",
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }
  const w = parsed.data;
  const issues: WorldIssue[] = [];
  const ids = new Set<string>();
  w.entities.forEach((e, i) => {
    if (ids.has(e.id))
      issues.push({ code: "DUPLICATE_ID", path: `entities.${i}.id`, message: `Duplicate entity ${e.id}` });
    ids.add(e.id);
  });
  w.locations.forEach((l, li) => {
    if (!ids.has(l.locationId)) {
      issues.push({
        code: "REFERENCE_BROKEN",
        path: `locations.${li}.locationId`,
        message: `No entity ${l.locationId}`,
      });
    }
    const zones = new Set(l.zones.map((z) => z.id));
    l.edges.forEach((e, ei) => {
      for (const end of [e.a, e.b]) {
        if (!zones.has(end))
          issues.push({
            code: "REFERENCE_BROKEN",
            path: `locations.${li}.edges.${ei}`,
            message: `No zone ${end}`,
          });
      }
    });
    for (const [who, zone] of Object.entries(l.positions)) {
      if (!ids.has(who))
        issues.push({
          code: "REFERENCE_BROKEN",
          path: `locations.${li}.positions.${who}`,
          message: `No entity ${who}`,
        });
      if (!zones.has(zone))
        issues.push({
          code: "REFERENCE_BROKEN",
          path: `locations.${li}.positions.${who}`,
          message: `No zone ${zone}`,
        });
    }
  });
  const start = w.locations.find((l) => l.locationId === w.start.locationId);
  if (!start)
    issues.push({
      code: "REFERENCE_BROKEN",
      path: "start.locationId",
      message: `No location ${w.start.locationId}`,
    });
  else if (!start.zones.some((z) => z.id === w.start.zoneId)) {
    issues.push({ code: "REFERENCE_BROKEN", path: "start.zoneId", message: `No zone ${w.start.zoneId}` });
  }
  return { world: issues.length ? null : w, issues };
}

/**
 * The canon events that put a world into a campaign: entities, their facts, the time, and the
 * opening scene at the start location with the PC (and companions) at the start zone.
 */
export function worldEvents(w: WorldDef, partyIds: readonly string[], currentGameTime = 0): EventDraft[] {
  const drafts: EventDraft[] = [];
  for (const e of w.entities) {
    const { facts, ...rest } = e;
    drafts.push(draft("EntityCreated", { entity: Entity.parse(rest) }, "system"));
    facts.forEach((f, i) => {
      drafts.push(
        draft(
          "FactAsserted",
          { fact: Fact.parse({ id: `fact:${e.id}:${i}`, entityId: e.id, source: "pack", ...f }) },
          "system",
        ),
      );
    });
  }
  if (w.gameTime > currentGameTime) {
    drafts.push(
      draft("TimeAdvanced", { minutes: w.gameTime - currentGameTime, reason: "world start" }, "system"),
    );
  }
  const loc = w.locations.find((l) => l.locationId === w.start.locationId)!;
  const positions = { ...loc.positions, ...Object.fromEntries(partyIds.map((id) => [id, w.start.zoneId])) };
  drafts.push(
    draft(
      "SceneOpened",
      {
        scene: SceneState.parse({
          id: `scene:${w.id}:1`,
          locationId: loc.locationId,
          zones: loc.zones,
          edges: loc.edges,
          positions,
          light: loc.light,
          weather: loc.weather,
          openedAt: Math.max(w.gameTime, currentGameTime),
        }),
      },
      "system",
    ),
  );
  return drafts;
}

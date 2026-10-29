import {
  AncestryDef,
  ArchetypeDef,
  type CompiledPack,
  defaultEconomy,
  defaultTuning,
  GearDef,
  GeneratedWorldPreview,
  PackManifest,
  type StartingKitProposal,
  TalentDef,
  WorldProposal,
} from "@wyrd/core";
import { allocateStartingTraining } from "@wyrd/engine";
import { packHash } from "./hash.ts";
import { WorldDef } from "./world.ts";

const GENERATED = "generated";
const generatedId = (id: string) => (id.startsWith(`${GENERATED}:`) ? id : `${GENERATED}:${id}`);

/**
 * Merges the optional starting kit before the pack is hashed: gear under `generated:<id>`,
 * per-archetype kits, the world's currency and at most one shop. Unknown references are dropped.
 */
function mergeStartingKit(pack: CompiledPack, kit: StartingKitProposal): void {
  for (const gear of kit.gear) {
    const id = generatedId(gear.id);
    pack.items.gear[id] = {
      ...GearDef.parse({
        id: "item",
        name: gear.name,
        description: gear.description,
        weightKg: gear.weightKg,
        price: gear.price,
        tags: ["generated"],
      }),
      id,
    };
  }
  for (const entry of kit.kits) {
    const archetype = pack.archetypes[generatedId(entry.archetypeId)];
    if (!archetype) continue;
    const items = entry.items
      .map((item) => ({ item: generatedId(item.id), qty: item.qty }))
      .filter((item) => Object.hasOwn(pack.items.gear, item.item));
    archetype.kit = items;
  }
  const stock = (kit.shop?.stock ?? [])
    .map((line) => ({ item: generatedId(line.id), qty: line.qty }))
    .filter((line) => Object.hasOwn(pack.items.gear, line.item));
  const economy = defaultEconomy();
  pack.economy = {
    ...economy,
    currency: { ...economy.currency, name: kit.currency.name, symbol: kit.currency.symbol },
    shops:
      kit.shop && stock.length
        ? [
            {
              id: "generated-shop",
              name: kit.shop.name,
              kind: kit.shop.kind,
              settlement: "village",
              markup: 1,
              stock,
            },
          ]
        : [],
  };
}

/** Compile bounded fiction proposals into frozen pack data and canon-ready world data. */
export function compileGeneratedWorld(raw: WorldProposal, kit?: StartingKitProposal) {
  const p = WorldProposal.parse(raw);
  if (
    p.location.people.some((n) => n.zone >= p.location.zones.length) ||
    !p.location.people.some((n) => n.zone === 0)
  )
    throw new Error("The starting location needs valid positions and someone in the opening zone");
  for (const entries of [p.origins, p.backgrounds, p.location.zones, p.location.people])
    if (new Set(entries.map((e) => e.name.toLowerCase())).size !== entries.length)
      throw new Error("Generated options and scene names must be distinct");
  const namespace = "generated";
  const pack: CompiledPack = {
    manifest: PackManifest.parse({
      id: namespace,
      name: p.worldName,
      version: "1.0.0",
      engine: ">=0.1.0",
      kind: "genre",
      description: p.premise,
      // Generated worlds have no class data, but the other progression modes work from the sheet.
      supports: { progression: ["classless", "useBased", "hybrid"] },
    }),
    tone: p.tone,
    skills: {},
    talents: {},
    ancestries: {},
    bodyPlans: {},
    archetypes: {},
    pregens: {},
    creatures: {},
    classes: {},
    items: { weapons: {}, armor: {}, gear: {} },
    hash: "",
  };
  p.origins.forEach((o, i) => {
    const local = `origin-${i + 1}`;
    const id = `${namespace}:${local}`;
    pack.ancestries[id] = { ...AncestryDef.parse({ id: local, ...o }), id };
  });
  p.backgrounds.forEach((b, i) => {
    const local = `background-${i + 1}`;
    const id = `${namespace}:${local}`;
    const talent = `${namespace}:training-${i + 1}`;
    pack.talents[talent] = {
      ...TalentDef.parse({
        id: `training-${i + 1}`,
        name: `${b.name} training`,
        tier: 1,
        description:
          "This background's training is represented by its starting attributes and skills; it grants no additional mechanical effect.",
      }),
      id: talent,
    };
    pack.archetypes[id] = {
      ...ArchetypeDef.parse({
        id: local,
        name: b.name,
        description: b.description,
        ...allocateStartingTraining(b.attributePriority, b.skills, defaultTuning),
        talent,
      }),
      id,
    };
  });
  if (kit) mergeStartingKit(pack, kit);
  pack.hash = packHash(pack);
  const world = WorldDef.parse({
    id: "generated-opening",
    name: p.worldName,
    premise: p.premise,
    start: { locationId: "location:opening", zoneId: "zone:opening-1" },
    entities: [
      {
        id: "location:opening",
        kind: "location",
        name: p.location.name,
        summary: p.location.description,
        detail: "full",
        facts: [
          { predicate: "opening", value: p.location.opening, visibility: "public" },
          ...p.location.zones.map((zone, i) => ({
            predicate: `zone:opening-${i + 1}`,
            value: zone.description,
            visibility: "public",
          })),
        ],
      },
      ...p.location.people.map((n, i) => ({
        id: `npc:person-${i + 1}`,
        kind: "npc",
        name: n.name,
        summary: n.description,
        data: n.reactionProfile ? { reactionProfile: n.reactionProfile } : {},
        facts: n.secret ? [{ predicate: "secret", value: n.secret, visibility: "secret" }] : [],
      })),
    ],
    locations: [
      {
        locationId: "location:opening",
        weather: p.location.weather,
        zones: p.location.zones.map((zone, i) => ({ id: `zone:opening-${i + 1}`, name: zone.name })),
        edges: p.location.zones
          .slice(1)
          .map((_, i) => ({ a: `zone:opening-${i + 1}`, b: `zone:opening-${i + 2}` })),
        positions: Object.fromEntries(
          p.location.people.map((n, i) => [`npc:person-${i + 1}`, `zone:opening-${n.zone + 1}`]),
        ),
      },
    ],
  });
  return { pack, world };
}

/** Explicit projection: the browser receives no NPC secrets or full generated pack. */
export function generatedWorldPreview(
  id: string,
  name: string,
  proposal: WorldProposal,
  pack: CompiledPack,
  offline: boolean,
) {
  return GeneratedWorldPreview.parse({
    id,
    name,
    worldName: proposal.worldName,
    premise: proposal.premise,
    opening: proposal.location.opening,
    suggestedCharacterName: proposal.suggestedCharacterName,
    originLabel: proposal.originLabel,
    offline,
    progressions: pack.manifest.supports.progression,
    origins: Object.values(pack.ancestries).map(({ id, name, description }) => ({ id, name, description })),
    backgrounds: Object.values(pack.archetypes).map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
  });
}

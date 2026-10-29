import { expect, test } from "bun:test";
import { join } from "node:path";
import { defaultCampaignSettings, defaultTuning, draft, type EventDraft } from "@wyrd/core";
import { applyProposals, draftFromPregen } from "@wyrd/engine";
import { creationContent } from "../src/content.ts";
import { defaultPlacements, hookEvents } from "../src/hooks.ts";
import { loadPack } from "../src/loader.ts";
import { loadWorld, worldEvents } from "../src/world.ts";
import { entity } from "../src/world-bible.ts";

const FANTASY = join(import.meta.dir, "../../../packs/fantasy-core");
const pack = loadPack(FANTASY).pack!;
const content = creationContent([pack]);
const world = loadWorld(FANTASY, "ashford-ferry").world!;

const of = <T extends EventDraft["type"]>(events: EventDraft[], type: T) =>
  events.filter((e): e is Extract<EventDraft, { type: T }> => e.type === type);

test("backstory hooks become known canon: placed people, a hidden whereabouts, a debt clock and a secret", () => {
  const site = (name: string) =>
    draft(
      "EntityCreated",
      { entity: entity({ id: `site:${name.toLowerCase()}`, kind: "site", name }) },
      "engine",
    );
  const bible = { startSite: "Ashford" };
  const existing = [...worldEvents(world, []), site("Ashford"), site("Greywater"), site("Hollin")];
  const hooks = [
    { kind: "rival" as const, name: "Isolde Marr", description: "Sold out the company." },
    { kind: "missing" as const, name: "Aldric", description: "Went looking for the author." },
    { kind: "debt" as const, name: "Mother Corran", description: "Wants her share." },
    { kind: "secret" as const, name: "The burnt barn", description: "The fire was mine." },
  ];
  const placements = defaultPlacements(hooks, existing, bible.startSite);
  const { ids, events } = hookEvents(hooks, "pc", existing, placements);
  expect(ids).toHaveLength(4);
  const created = of(events, "EntityCreated").map((e) => e.payload.entity);
  expect(created.every((e) => e.data.backstoryHook)).toBe(true);
  const sites = new Map(
    of(existing, "EntityCreated")
      .filter((e) => e.payload.entity.kind === "site")
      .map((e) => [e.payload.entity.id, e.payload.entity.name]),
  );
  const rival = created.find((e) => e.name === "Isolde Marr")!;
  expect(sites.get(rival.data.siteId as string)).toBeDefined();
  expect(sites.get(rival.data.siteId as string)).not.toBe(bible.startSite);
  // The missing person has no public site; where they are is a secret.
  const missing = created.find((e) => e.name === "Aldric")!;
  expect(missing.data.siteId).toBeUndefined();
  const facts = of(events, "FactAsserted").map((e) => e.payload.fact);
  expect(facts.find((f) => f.entityId === missing.id && f.predicate === "location")?.value).toBe("unknown");
  expect(facts.find((f) => f.entityId === missing.id && f.predicate === "secret")?.visibility).toBe("secret");
  expect(of(events, "ClockCreated")[0]!.payload.clock).toMatchObject({
    name: "What you owe Mother Corran",
    visible: true,
  });
  expect(facts.find((f) => f.value === "The fire was mine.")?.visibility).toBe("secret");
  // The PC knows every hook entity.
  const known = new Set(of(events, "KnowledgeGained").map((e) => e.payload.entityId));
  for (const id of ids) expect(known.has(id)).toBe(true);
  expect(of(events, "RelationshipChanged").some((e) => e.payload.edge.type === "rival")).toBe(true);
});

test("session-zero proposals that break a creation rule are refused part by part", () => {
  const pregen = pack.pregens["fantasy-core:brannoc"]!;
  const draft = draftFromPregen(pregen, content.archetypes[pregen.archetype]!);
  const { draft: next, refused } = applyProposals(
    draft,
    {
      attributes: { str: 10 },
      skills: { "core:melee": 95 },
      appearance: { hair: "shaved" },
      identity: { name: "Bran" },
    },
    content,
    pack.items,
    defaultCampaignSettings(),
    defaultTuning,
  );
  expect(refused.map((r) => r.split(":")[0])).toEqual(["attributes", "skills"]);
  expect(next.attributes).toEqual(draft.attributes);
  expect(next.skills).toEqual(draft.skills);
  expect(next.name).toBe("Bran");
  expect(next.appearance.hair).toBe("shaved");
  // An unknown background is refused too.
  expect(
    applyProposals(
      draft,
      { identity: { archetype: "x:nobody" } },
      content,
      pack.items,
      defaultCampaignSettings(),
      defaultTuning,
    ).refused,
  ).toHaveLength(1);
});

import {
  defaultTuning,
  draft,
  Entity,
  Fact,
  LookupArgs,
  type LoreRecord,
  MAIN_WORLD,
  WorldId,
  worldOf,
} from "@wyrd/core";
import { knownEntities } from "@wyrd/engine";
import { wikiHost } from "../../lore/mediawiki.ts";
import { registerGmTool } from "../registry.ts";

registerGmTool({
  name: "lookup_lore",
  description:
    "Research a topic: current-world canon first, then cached wiki summaries, Wikipedia/Fandom and low-confidence model knowledge. Specify wiki (e.g. dc.fandom.com) for a source and optionally worldId.",
  schema: LookupArgs.extend({
    wiki: LookupArgs.shape.query.default("en.wikipedia.org"),
    worldId: WorldId.optional(),
  }),
  run: async (a, x) => {
    const worldId = a.worldId ?? MAIN_WORLD;
    if (!x.state.worlds.some((w) => w.id === worldId))
      return { ok: false, body: { errors: "Unknown world" } };
    const progress = { phase: "researching" as const, detail: a.query };
    x.onProgress?.(progress);
    const known = knownEntities(x.state);
    const found = x.canon
      .findByName(a.query)
      .filter((e) => known.has(e.id) && worldOf(e) === worldId)
      .slice(0, defaultTuning.lore.canonLimit)
      .map((e) => {
        const facts = x.canon
          .factsAbout(e.id)
          .filter((f) => f.visibility !== "secret" && worldOf(f) === worldId)
          .map((f) => ({
            predicate: f.predicate,
            value: f.value,
            source: f.source,
            confidence: f.confidence,
            evidence: f.evidence,
          }));
        return {
          id: e.id,
          kind: e.kind,
          name: e.name,
          summary: e.data.lore === true ? facts.map((f) => String(f.value)).join("\n\n") : e.summary,
          facts,
        };
      });
    if (found.length)
      return { ok: true, body: { found }, effects: { progress: x.onProgress ? undefined : progress } };
    const records = Object.values((x.state.flags.loreRecords ?? {}) as Record<string, LoreRecord>);
    const previous = records.find(
      (r) => r.worldId === worldId && r.query.toLocaleLowerCase() === a.query.toLocaleLowerCase(),
    );
    if (previous) return { ok: true, body: { found: [previous] } };
    // No implicit network/model work in offline preview or callers that have not enabled research.
    if (!x.lore)
      return { ok: true, body: { found: [] }, effects: { progress: x.onProgress ? undefined : progress } };
    try {
      const wiki = wikiHost(a.wiki);
      const result = await x.lore.lookup(wiki, a.query);
      const entityId = x.newId();
      const facts = result.facts.map((value) =>
        Fact.parse({
          id: x.newId(),
          entityId,
          predicate: "note",
          value,
          source: "lore",
          confidence: result.confidence,
          evidence: result.evidence,
          worldId,
        }),
      );
      const entry = {
        how: result.confidence === "high" ? ("read" as const) : ("deduced" as const),
        gameTime: x.state.campaign.gameTime,
      };
      const record: LoreRecord = {
        id: x.newId(),
        entityId,
        worldId,
        query: a.query,
        wiki,
        title: result.title,
        summary: result.facts.join("\n\n"),
        confidence: result.confidence,
        ...(result.evidence ? { url: result.evidence.quote } : {}),
      };
      return {
        ok: true,
        body: {
          found: [
            {
              id: entityId,
              name: result.title,
              summary: record.summary,
              facts,
              confidence: result.confidence,
            },
          ],
        },
        effects: {
          drafts: [
            draft(
              "EntityCreated",
              {
                entity: Entity.parse({
                  id: entityId,
                  name: result.title,
                  aliases: a.query === result.title ? [] : [a.query],
                  kind: "concept",
                  detail: "sketch",
                  data: { lore: true },
                  summary: record.summary,
                  worldId,
                }),
              },
              "model",
            ),
            ...facts.map((fact) => draft("FactAsserted", { fact }, "model")),
            draft("KnowledgeGained", { entityId, entry }),
            ...facts.map((f) => draft("KnowledgeGained", { factId: f.id, entry })),
            draft("LoreRecorded", { record }, "model"),
          ],
        },
      };
    } catch {
      return { ok: false, body: { errors: "Lore research unavailable. Try again or choose another wiki." } };
    }
  },
});

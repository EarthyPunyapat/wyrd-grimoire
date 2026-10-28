import {
  AddressInput,
  CodexView,
  defaultTuning,
  draft,
  type Fact,
  JournalView,
  MapView,
  NotesInput,
  PinInput,
  RetconInput,
  reputationTier,
} from "@wyrd/core";
import { describeDate, type GameState } from "@wyrd/engine";
import { type RoleRouter, recap, writeSummaries } from "@wyrd/llm";
import { type AppStore, type CampaignStore, CanonQueries } from "@wyrd/storage";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { AppEnvironment } from "./app.ts";

type Deps = {
  campaign: (id: string) => CampaignStore<GameState>;
  store: AppStore;
  body: <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) => Promise<T>;
  running: (id: string) => boolean;
  router: () => RoleRouter | null;
};

const MAX_PINS = 20;
const HOW: Record<string, string> = {
  witnessed: "seen with your own eyes",
  told: "told to you",
  rumour: "heard as a rumour",
  read: "read",
  public: "common knowledge",
  deduced: "worked out",
};
const value = (f: Fact) => (typeof f.value === "string" ? f.value : JSON.stringify(f.value));
/** Predicates the player may correct: descriptive only, never engine state (spec 07, retcon). */
const EDITABLE = (f: Fact) =>
  f.source !== "engine" && !f.predicate.startsWith("zone:") && f.predicate !== "secret";

export function addressOf(canon: CanonQueries): string {
  return String(
    (canon.entity("concept:world-bible")?.data as { address?: string } | undefined)?.address ?? "traveller",
  );
}

/** Everything the PC knows (spec 07 Codex): entities, the facts they learned and how, standing. */
export function codexView(game: CampaignStore<GameState>): CodexView {
  const state = game.state();
  const canon = new CanonQueries(game);
  const pcId = state.party.pcId ?? "";
  const entries = Object.entries(state.knowledge.entities).flatMap(([id, entry]) => {
    const e = canon.entity(id);
    if (!e || e.kind === "concept") return [];
    const present = !!state.scene && (id in state.scene.positions || id === state.scene.locationId);
    const facts = canon
      .factsAbout(id)
      .filter((f) => !f.predicate.startsWith("zone:") && (present || state.knowledge.facts[f.id]))
      .map((f) => ({
        id: f.id,
        predicate: f.predicate.replace(/[._]/g, " "),
        value: value(f),
        how: HOW[state.knowledge.facts[f.id]?.how ?? "witnessed"] ?? "seen",
        pinned: !!f.pinned,
        editable: EDITABLE(f),
      }));
    const faction = state.factions[id];
    const mind = state.minds[id]?.dispositions[pcId];
    const standing = faction
      ? `${reputationTier(faction.reputation)} (${faction.reputation})`
      : mind
        ? mind.attitude >= 30
          ? "warm toward you"
          : mind.attitude <= -30
            ? "hostile toward you"
            : "wary of you"
        : undefined;
    return [
      {
        id,
        name: e.name,
        kind: e.kind,
        summary: e.summary,
        how: HOW[entry.how] ?? entry.how,
        ...(standing ? { standing } : {}),
        facts,
      },
    ];
  });
  return CodexView.parse({ address: addressOf(canon), pins: canon.pinnedFacts().length, entries });
}

export function journalView(game: CampaignStore<GameState>, notes: string): JournalView {
  const state = game.state();
  const canon = new CanonQueries(game);
  const pcId = state.party.pcId ?? "";
  const objectiveText = (o: { kind: string; [k: string]: unknown }) =>
    o.kind === "narrative"
      ? String(o.description)
      : o.kind === "reach"
        ? `Reach ${canon.entity(String(o.locationId))?.name ?? "the place"}`
        : o.kind === "obtain"
          ? `Obtain ${canon.entity(String(o.itemId))?.name ?? "it"}`
          : o.kind === "npcState"
            ? `${canon.entity(String(o.npcId))?.name ?? "Someone"}: ${String(o.state)}`
            : String(o.key);
  return JournalView.parse({
    recap: recap(canon),
    date: describeDate(state.campaign.gameTime, defaultTuning.world),
    summaries: canon.summaries().map((s) => ({ id: s.id, level: s.level, text: s.text })),
    quests: Object.values(state.quests).map((q) => ({
      id: q.id,
      title: q.title,
      status: q.status,
      stage: q.stages[q.stage]?.summary ?? "",
      objectives: (q.stages[q.stage]?.objectives ?? []).map((o, i) => ({
        text: objectiveText(o as never),
        met: !!q.stages[q.stage]?.met[i],
      })),
    })),
    // Hooks the PC has heard of are leads, not accepted quests.
    leads: canon
      .allEntities("quest")
      .filter(
        (e) =>
          state.knowledge.entities[e.id] ||
          Object.values(state.rumors).some((r) => r.about.includes(e.id) && r.holders[pcId]),
      )
      .map((e) => ({ id: e.id, title: e.name, summary: e.summary })),
    clocks: Object.values(state.clocks)
      .filter((c) => c.visible)
      .map((c) => ({ name: c.name, filled: c.filled, segments: c.segments })),
    rumours: Object.values(state.rumors).flatMap((r) => (r.holders[pcId] ? [r.holders[pcId]!.content] : [])),
    notes,
  });
}

/** The route graph the PC knows (spec 13 Map): known sites and the roads between them. */
export function mapView(game: CampaignStore<GameState>): MapView {
  const state = game.state();
  const canon = new CanonQueries(game);
  const known = (id: string) => !!state.knowledge.entities[id];
  const here = state.scene
    ? (canon.entity(state.scene.locationId)?.data as { siteId?: string } | undefined)?.siteId
    : undefined;
  const sites = canon
    .allEntities("site")
    .filter((s) => known(s.id) || s.id === here)
    .map((s) => {
      const d = s.data as { regionId?: string; kind?: string; arrivalLocationId?: string; visited?: boolean };
      return {
        id: s.id,
        name: s.name,
        kind: d.kind ?? "site",
        regionId: d.regionId ?? "",
        visited: !!d.arrivalLocationId,
        here: s.id === here,
      };
    });
  const ids = new Set(sites.map((s) => s.id));
  const routes = state.edges
    .filter((e) => e.type === "routeTo" && ids.has(e.from) && ids.has(e.to))
    .map((e) => {
      const d = (e.data ?? {}) as { days?: number; terrain?: string; danger?: number };
      return { a: e.from, b: e.to, days: d.days ?? 1, terrain: d.terrain ?? "road", danger: d.danger ?? 1 };
    });
  const regions = [...new Set(sites.map((s) => s.regionId))].flatMap((id) => {
    const r = canon.entity(id);
    return r ? [{ id, name: r.name }] : [];
  });
  return MapView.parse({ regions, sites, routes });
}

export function mountWorld(app: Hono<AppEnvironment>, d: Deps) {
  const guard = (id: string) => {
    if (d.running(id)) throw new HTTPException(409, { message: "Wait for the current turn to finish" });
  };
  app.get("/api/campaigns/:id/codex", (c) => c.json(codexView(d.campaign(c.req.param("id")))));
  app.get("/api/campaigns/:id/journal", (c) =>
    c.json(journalView(d.campaign(c.req.param("id")), d.store.notes(c.req.param("id")))),
  );
  app.get("/api/campaigns/:id/map", (c) => c.json(mapView(d.campaign(c.req.param("id")))));
  app.put("/api/campaigns/:id/notes", async (c) => {
    const id = c.req.param("id");
    d.campaign(id);
    d.store.saveNotes(id, (await d.body(c, NotesInput)).notes);
    return c.json({ ok: true });
  });
  // Pin (spec 07): at most 20 facts, and only ones the PC knows.
  app.post("/api/campaigns/:id/facts/:factId/pin", async (c) => {
    const id = c.req.param("id");
    guard(id);
    const game = d.campaign(id);
    const factId = c.req.param("factId");
    const { pinned } = await d.body(c, PinInput);
    const entry = codexView(game)
      .entries.flatMap((e) => e.facts)
      .find((f) => f.id === factId);
    if (!entry) throw new HTTPException(404, { message: "You don't know that fact" });
    if (pinned && !entry.pinned && new CanonQueries(game).pinnedFacts().length >= MAX_PINS)
      throw new HTTPException(409, { message: `You can pin at most ${MAX_PINS} facts` });
    game.append([draft("FactPinned", { factId, pinned }, "player")]);
    return c.json(codexView(game));
  });
  // Retcon (spec 07): a descriptive fact the PC knows gets a corrected value; engine state can't be edited.
  app.post("/api/campaigns/:id/facts/:factId/retcon", async (c) => {
    const id = c.req.param("id");
    guard(id);
    const game = d.campaign(id);
    const factId = c.req.param("factId");
    const { value: next } = await d.body(c, RetconInput);
    const entry = codexView(game)
      .entries.flatMap((e) => e.facts)
      .find((f) => f.id === factId);
    const fact = new CanonQueries(game).fact(factId);
    if (!entry || !fact) throw new HTTPException(404, { message: "You don't know that fact" });
    if (!entry.editable) throw new HTTPException(409, { message: "That can't be retconned; rewind instead" });
    const fresh = {
      ...fact,
      id: `${fact.id}~r${game.events().length}`,
      value: next,
      source: "player" as const,
      pinned: undefined,
      supersededBy: undefined,
    };
    game.append([
      draft("FactSuperseded", { oldFactId: factId, fact: fresh }, "player"),
      draft(
        "KnowledgeGained",
        { factId: fresh.id, entry: { how: "deduced", gameTime: game.state().campaign.gameTime } },
        "player",
      ),
    ]);
    return c.json(codexView(game));
  });
  app.post("/api/campaigns/:id/address", async (c) => {
    const id = c.req.param("id");
    guard(id);
    const game = d.campaign(id);
    const { address } = await d.body(c, AddressInput);
    const bible = new CanonQueries(game).entity("concept:world-bible");
    game.append([
      draft(
        "EntityUpdated",
        { entityId: "concept:world-bible", patch: { data: { ...(bible?.data ?? {}), address } } },
        "player",
      ),
    ]);
    return c.json({ address });
  });
  // End session (spec 07): closes the current scene and chapter so the recap is ready next time.
  app.post("/api/campaigns/:id/end-session", async (c) => {
    const id = c.req.param("id");
    guard(id);
    const game = d.campaign(id);
    await writeSummaries(game, new CanonQueries(game), d.router(), {
      forceChapter: true,
      gameTime: game.state().campaign.gameTime,
    });
    return c.json(journalView(game, d.store.notes(id)));
  });
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CampaignPatch,
  type CampaignPreset,
  type CampaignSettingsInput,
  type CompiledPack,
  DowntimeRequest,
  type DraftSheet,
  defaultTuning,
  draft,
  Entity,
  type EventDraft,
  GameView,
  LegacyInput,
  type Level,
  PasscodeInput,
  type ProgressionMode,
  parseEventPayload,
  presetSelection,
  QuickStartInput,
  type ResolutionId,
  ShopState,
  StartGeneratedCampaign,
  SubmitTurnInput,
  survivalOf,
  TurnCompletedEventPayload,
  WorldPitch,
} from "@wyrd/core";
import {
  acceptLevelUp,
  actingActor,
  avatarRuns,
  buy,
  capacityKg,
  carriedKg,
  catalogWith,
  closeEvents,
  combatView,
  createActor,
  createCampaign,
  draftFromArchetype,
  encumbranceBand,
  type GameState,
  haggle,
  isKnownSkill,
  legacyEvents,
  levelProposals,
  moveEquipment,
  obituary,
  playerCanonEvents,
  powerRating,
  RESOLUTION_MODULES,
  reduce,
  resolveDowntime,
  runTicks,
  sell,
  skillLabel,
  skillValue,
  startingKitEvents,
  unwrap,
} from "@wyrd/engine";
import {
  combatContent,
  defaultCreationReview,
  elaborateEntity,
  generateCreationReview,
  generateLocation,
  generateStartingKit,
  generateWorld,
  generateWorldBible,
  LoreResearch,
  type MediaWikiClient,
  makeTurnContext,
  offlineBible,
  offlineElaboration,
  offlineLocation,
  placeHooks,
  type ResearchedSource,
  type RoleRouter,
  researchSource,
  SecretStore,
  TurnPipeline,
  type TurnStreamEvent,
  writeSummaries,
} from "@wyrd/llm";
import {
  bibleEvents,
  compileGeneratedWorld,
  creationContent,
  defaultPlacements,
  generatedWorldPreview,
  hookEvents,
  loadPack,
  loadWorld,
  locationEvents,
  skillCatalog,
  type WorldDef,
  withPlayerGear,
  worldEvents,
} from "@wyrd/packs";
import { AppStore, backupCampaign, CampaignStore, CanonQueries, LoreCache } from "@wyrd/storage";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { NONCE, type SecureHeadersVariables, secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { mountCampaignSettings } from "./campaign-settings.ts";
import { evaluateDraft, mountCreation, pregenDraft, StoredDraft } from "./creation.ts";
import { EXAMPLE_WORLD } from "./example-world.ts";
import { mountHistory } from "./history.ts";
import { ModelServices, mountModels } from "./models.ts";
import { mountParty, profileNewCompanions, recruitSheet } from "./party.ts";
import { sourceEvents } from "./source-creation.ts";
import { addressOf, mountWorld } from "./world-views.ts";

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const loopback = (ip: string) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
export type AppEnvironment = { Bindings: { remoteAddress?: string }; Variables: SecureHeadersVariables };
type Options = {
  home: string;
  offline: boolean;
  packDir?: string;
  router?: RoleRouter;
  /** Inject wiki IO for offline fixtures. */
  loreClient?: Pick<MediaWikiClient, "fetchPage" | "search">;
  now?: () => number;
  /** Tests only: seed every new campaign's dice the same way. */
  seed?: string;
};

/** The spells this PC knows. No spellcasting state, or no entry for this PC, means none. */
export function visibleSpells(state: GameState, pack: CompiledPack, pcId: string) {
  const known = (state.flags.spellcasting as { known?: Record<string, string[]> } | undefined)?.known?.[pcId];
  if (!known) return [];
  const wanted = new Set(known);
  return Object.values(pack.spells ?? {})
    .filter((spell) => wanted.has(spell.id))
    .map((spell) => ({
      id: spell.id,
      name: spell.name,
      school: spell.school,
      tier: spell.tier,
      apCost: spell.apCost,
      range: spell.range,
      target: spell.target,
      strain: spell.strain ?? defaultTuning.spellcasting.strainByTier[spell.tier],
      concentration: spell.concentration,
      description: spell.description,
    }));
}

/** Read the player's house-style examples from WYRD_HOME/style/house/*.md; failure means none. */
function houseStyleExamples(home: string): string[] {
  const dir = join(home, "style", "house");
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => {
        try {
          return readFileSync(join(dir, name), "utf8").trim();
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function createApp(options: Options) {
  mkdirSync(options.home, { recursive: true });
  const store = new AppStore(join(options.home, "app.db"));
  store.recover();
  // The player's own house-style examples, read once at launch (D144). Missing files mean none.
  const styleExamples = houseStyleExamples(options.home);
  const secrets = new SecretStore(join(options.home, "secrets"));
  const now = options.now ?? Date.now;
  const packDir = options.packDir ?? resolve(import.meta.dir, "../../../packs/fantasy-core");
  const loaded = loadPack(packDir);
  if (!loaded.pack) throw new Error("The fantasy-core pack failed validation");
  const pack = loaded.pack;
  const worlds = {
    "ashford-ferry": loadWorld(packDir, "ashford-ferry").world,
    "tavern-brawl": loadWorld(packDir, "tavern-brawl").world,
  };
  for (const [name, w] of Object.entries(worlds))
    if (!w) throw new Error(`The ${name} world failed validation`);
  const content = creationContent([pack]);
  const campaigns = new Map<string, CampaignStore<GameState>>();
  const tasks = new Set<Promise<void>>();
  const attempts = new Map<string, { count: number; until: number }>();
  const models = new ModelServices(store, secrets, options.home, options.offline, options.router);
  // Daily backups start in the background at boot; a slow disk never delays the server.
  for (const entry of store.campaigns())
    void backupCampaign({ home: options.home, campaignId: entry.id, now }).catch(() => {});
  const app = new Hono<AppEnvironment>();
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", NONCE],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    }),
  );
  const jsonBodyLimit = bodyLimit({ maxSize: 16 * 1024 });
  // Campaign archives are binary and may be large; every other JSON route keeps the small limit.
  app.use("/api/*", (c, next) => (c.req.path === "/api/campaigns/import" ? next() : jsonBodyLimit(c, next)));
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(c.req.method)) {
      if (c.req.header("X-Wyrd") !== "1")
        throw new HTTPException(403, { message: "Missing request protection" });
      const origin = c.req.header("Origin");
      if (origin && origin !== new URL(c.req.url).origin)
        throw new HTTPException(403, { message: "Cross-origin request refused" });
    }
    await next();
  });
  async function body<T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> {
    let value: unknown;
    try {
      value = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "Expected a JSON body" });
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new HTTPException(422, { message: "Please check the submitted fields" });
    return parsed.data;
  }
  const sessionFor = (cookie: string | undefined) =>
    cookie && store.session(digest(cookie), now(), SESSION_TTL);
  app.get("/api/auth/status", (c) =>
    c.json({
      setupRequired: !secrets.read("passcode.hash"),
      authenticated: Boolean(sessionFor(getCookie(c, "wyrd_session"))),
      offline: options.offline,
    }),
  );
  app.post("/api/auth/setup", async (c) => {
    const url = new URL(c.req.url);
    const hostIsLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    // Production supplies the socket peer; forwarded headers are deliberately ignored.
    if (!hostIsLocal || (c.env?.remoteAddress && !loopback(c.env.remoteAddress)))
      throw new HTTPException(403, { message: "Set the passcode on the host PC using localhost" });
    const { passcode } = await body(c, PasscodeInput);
    if (secrets.read("passcode.hash"))
      throw new HTTPException(409, { message: "The passcode is already set" });
    if (passcode.length < 12)
      throw new HTTPException(422, { message: "Use a passcode of at least 12 characters" });
    secrets.write("passcode.hash", Bun.password.hashSync(passcode, "argon2id"));
    const token = randomBytes(32).toString("hex");
    store.createSession(digest(token), now());
    setCookie(c, "wyrd_session", token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: url.protocol === "https:",
      path: "/",
      maxAge: SESSION_TTL / 1000,
    });
    return c.json({ ok: true });
  });
  app.post("/api/auth/login", async (c) => {
    const ip = c.env?.remoteAddress ?? "test";
    for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
    const attempt = attempts.get(ip) ?? { count: 0, until: now() + LOGIN_WINDOW };
    if (attempt.count >= 10) {
      c.header("Retry-After", String(Math.ceil((attempt.until - now()) / 1000)));
      throw new HTTPException(429, { message: "Too many attempts. Try again later." });
    }
    attempt.count++;
    attempts.set(ip, attempt);
    const { passcode } = await body(c, PasscodeInput);
    const hash = secrets.read("passcode.hash");
    if (!hash || !Bun.password.verifySync(passcode, hash))
      throw new HTTPException(401, { message: "Incorrect passcode" });
    attempts.delete(ip);
    const token = randomBytes(32).toString("hex");
    store.createSession(digest(token), now());
    setCookie(c, "wyrd_session", token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: new URL(c.req.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_TTL / 1000,
    });
    return c.json({ ok: true });
  });
  app.use("/api/*", async (c, next) => {
    if (!sessionFor(getCookie(c, "wyrd_session")))
      throw new HTTPException(401, { message: "Unlock your grimoire to continue" });
    await next();
  });
  app.post("/api/auth/logout", (c) => {
    store.deleteSession(digest(getCookie(c, "wyrd_session") ?? ""));
    deleteCookie(c, "wyrd_session", { path: "/" });
    return c.json({ ok: true });
  });
  mountModels(app, models);
  mountCreation(app, {
    styleRouter: () => options.router ?? (options.offline ? null : models.router()),
    store,
    body,
    router: () => (options.offline ? null : models.router()),
  });
  mountParty(app, { campaign: (id) => campaign(id), body, running: (id) => !!store.running(id) });
  mountCampaignSettings(app, { campaign: (id) => campaign(id), body });
  mountWorld(app, {
    campaign: (id) => campaign(id),
    store,
    body,
    running: (id) => !!store.running(id),
    router: () => (options.offline ? null : models.router()),
  });
  mountHistory(app, {
    home: options.home,
    now,
    campaign: (id) => campaign(id),
    store,
    body,
    running: (id) => !!store.running(id),
  });
  function campaign(id: string) {
    // Registry membership authorizes the path. Never construct a path from an arbitrary route value.
    const entry = store.campaigns().find((row) => row.id === id);
    if (!entry) throw new HTTPException(404, { message: "Campaign not found" });
    let opened = campaigns.get(id);
    if (!opened) {
      opened = CampaignStore.open<GameState>(join(options.home, "campaigns", entry.id, "campaign.db"), {
        reduce,
      });
      campaigns.set(id, opened);
      // Opening a campaign is a convenient once-a-day backup point (spec 14); play never waits.
      void backupCampaign({ home: options.home, campaignId: id, now }).catch(() => {});
    }
    return opened;
  }
  app.get("/api/campaigns", (c) => c.json(store.campaigns()));

  // Home management: rename through the event log, archive as app-store metadata. Neither is deletion.
  app.patch("/api/campaigns/:id", async (c) => {
    const id = c.req.param("id");
    const patch = await body(c, CampaignPatch);
    const entry = store.campaigns().find((row) => row.id === id);
    if (!entry) throw new HTTPException(404, { message: "Campaign not found" });
    if (patch.name !== undefined) {
      if (store.running(id))
        throw new HTTPException(409, {
          message: "A turn is running. Wait for it to finish, then rename.",
        });
      const game = campaign(id);
      if (game.state().campaign.name !== patch.name)
        game.append([draft("CampaignRenamed", { name: patch.name }, "player")]);
      store.renameCampaign(id, patch.name);
    }
    if (patch.archived !== undefined) store.setCampaignArchived(id, patch.archived);
    const updated = store.campaigns().find((row) => row.id === id)!;
    return c.json(updated);
  });

  app.delete("/api/campaigns/:id", (c) => {
    const id = c.req.param("id");
    const entry = store.campaigns().find((row) => row.id === id);
    if (!entry) throw new HTTPException(404, { message: "Campaign not found" });
    if (store.running(id))
      throw new HTTPException(409, { message: "A turn is running. Wait for it to finish, then delete." });
    const open = campaigns.get(id);
    if (open) {
      open.close();
      campaigns.delete(id);
    }
    rmSync(join(options.home, "campaigns", id), { recursive: true, force: true });
    store.removeCampaign(id);
    return c.body(null, 204);
  });
  app.get("/api/packs", (c) =>
    c.json({
      archetypes: Object.values(content.archetypes).map((a) => ({ id: a.id.split(":")[1], name: a.name })),
      ancestries: Object.values(content.ancestries).map((a) => ({ id: a.id.split(":")[1], name: a.name })),
    }),
  );
  let generating = false;
  type DraftStep = { key: string; label: string; status: "pending" | "running" | "done" | "failed" };
  const DRAFT_STEPS: DraftStep[] = [
    { key: "read", label: "Reading your description", status: "pending" },
    { key: "world", label: "Generating the setting and opening scene", status: "pending" },
    { key: "bible", label: "Building the wider world", status: "pending" },
    { key: "validate", label: "Checking places, people and rules", status: "pending" },
    { key: "save", label: "Saving your draft", status: "pending" },
  ];
  /** One place for world-draft generation, shared by the JSON and streamed routes. */
  async function buildWorldDraft(
    input: WorldPitch,
    onProgress?: (steps: DraftStep[]) => Promise<void> | void,
  ) {
    const steps = DRAFT_STEPS.map((s) => ({ ...s }));
    if (input.source)
      steps.splice(1, 0, { key: "research", label: `Researching ${input.source.title}`, status: "pending" });
    const mark = async (key: string, status: DraftStep["status"]) => {
      const step = steps.find((s) => s.key === key);
      if (step) step.status = status;
      if (onProgress) await onProgress(steps.map((s) => ({ ...s })));
    };
    await mark("read", "done");
    await mark("world", "running");
    const offline = options.offline && !options.router;
    if (!offline) {
      // A missing worldGen route is the most common cause of the generic failure; say so plainly.
      try {
        models.router().route("worldGen");
      } catch {
        throw new HTTPException(422, {
          message:
            "World generation has no model. In Settings → Models, choose ‘One model for everything’ or set the World generation role.",
        });
      }
    }
    if (offline && input.source)
      throw new HTTPException(422, {
        message: "Connect a model to research a source, or preview an original example world.",
      });
    if (input.source) await mark("research", "running");
    const source: ResearchedSource | undefined = input.source
      ? await researchSource(
          models.router(),
          input,
          new LoreResearch({
            router: models.router(),
            cache: new LoreCache(options.home),
            client: options.loreClient,
          }),
        )
      : undefined;
    if (input.source) await mark("research", "done");
    const proposal =
      source?.proposal ?? (offline ? EXAMPLE_WORLD : await generateWorld(models.router(), input));
    await mark("world", "done");
    await mark("bible", "running");
    const bibleInput = {
      pitch: input.pitch,
      worldName: proposal.worldName,
      premise: proposal.premise,
      opening: proposal.location.opening,
      storyMode: "threatClock" as const,
    };
    const taken = [
      proposal.worldName,
      proposal.location.name,
      ...proposal.location.people.map((p) => p.name),
    ];
    // The wider world is optional: if it can't be generated, the campaign starts as a single site (D93).
    const bible =
      source?.bible ??
      (options.offline
        ? offlineBible({ worldName: proposal.worldName, openingSite: proposal.location.name, threat: true })
        : await generateWorldBible(models.router(), bibleInput, taken).catch(() => undefined));
    await mark("bible", "done");
    await mark("validate", "running");
    // The starting kit is optional too: a failed call keeps today's empty kit and no shop (D148).
    const kit = offline
      ? undefined
      : await generateStartingKit(models.router(), { proposal, pitch: input.pitch }).catch(() => undefined);
    const { pack } = compileGeneratedWorld(proposal, kit);
    const id = randomUUID();
    const proposedReview = offline
      ? undefined
      : await generateCreationReview(models.router(), input, proposal).catch(() => undefined);
    const review = proposedReview ?? defaultCreationReview();
    const reviewNotice =
      !offline && !proposedReview
        ? "The GM's settings and sample could not be generated. Review the house defaults, edit the style, or try revising the sample."
        : undefined;
    const preview = {
      ...generatedWorldPreview(id, input.name, proposal, pack, offline),
      review,
      reviewNotice,
      source: input.source,
    };
    await mark("validate", "done");
    await mark("save", "running");
    store.saveCreationDraft(id, {
      input,
      proposal,
      review,
      ...(source ? { source } : {}),
      ...(bible ? { bible } : {}),
      ...(kit ? { kit } : {}),
      offline,
    });
    await mark("save", "done");
    return preview;
  }
  app.post("/api/world-drafts", async (c) => {
    const input = await body(c, WorldPitch);
    if (generating)
      throw new HTTPException(409, { message: "A world is already being generated. Please wait." });
    generating = true;
    try {
      return c.json(await buildWorldDraft(input), 201);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error("[world-draft]", error);
      throw new HTTPException(502, {
        message: `The world could not be generated or validated. ${draftErrorDetail(error)}`,
      });
    } finally {
      generating = false;
    }
  });
  /** Streamed generation: real progress steps and a precise failure instead of a generic message. */
  app.post("/api/world-drafts/stream", async (c) => {
    const input = await body(c, WorldPitch);
    if (generating)
      throw new HTTPException(409, { message: "A world is already being generated. Please wait." });
    generating = true;
    return streamSSE(c, async (stream) => {
      try {
        const preview = await buildWorldDraft(input, async (steps) => {
          await stream.writeSSE({ event: "progress", data: JSON.stringify({ steps }) });
        });
        await stream.writeSSE({ event: "done", data: JSON.stringify(preview) });
      } catch (error) {
        console.error("[world-draft]", error);
        await stream.writeSSE({
          event: "failed",
          data: JSON.stringify({
            message: "The world could not be generated or validated.",
            detail: draftErrorDetail(error),
          }),
        });
      } finally {
        generating = false;
      }
    });
  });
  const starting = new Set<string>();
  app.post("/api/campaigns", async (c) => {
    const input = await body(c, StartGeneratedCampaign);
    const submitted = (await c.req.json()) as Record<string, unknown>;
    const saved = StoredDraft.safeParse(store.creationDraft(input.draftId));
    if (!saved.success)
      throw new HTTPException(404, { message: "World draft not found. Generate your world first." });
    if (saved.data.campaignId) return c.json({ id: saved.data.campaignId }, 201);
    const { pack, world } = compileGeneratedWorld(saved.data.proposal, saved.data.kit);
    const characterName = input.characterName || saved.data.proposal.suggestedCharacterName;
    // The quick path names an origin and background; the other paths start from the edited sheet.
    const sheet =
      input.ancestry && input.archetype
        ? archetypeDraft(pack, input.ancestry, input.archetype, characterName)
        : saved.data.sheet;
    if (!sheet)
      throw new HTTPException(422, { message: "Choose an origin and background, or build a character" });
    // Placing hooks awaits a model, so a second click must not start a second campaign meanwhile.
    if (starting.has(input.draftId))
      throw new HTTPException(409, { message: "Your campaign is already being prepared" });
    starting.add(input.draftId);
    try {
      const bible = saved.data.bible ? bibleEvents(saved.data.bible, world, defaultTuning) : [];
      const hooks = await hookPlan(
        sheet,
        [...worldEvents(world, []), ...bible],
        world,
        saved.data.bible?.startSite,
      );
      const reviewBase = input.review ?? saved.data.review;
      const review = reviewBase
        ? {
            ...reviewBase,
            ...(submitted.resolution !== undefined ? { resolution: input.resolution } : {}),
            ...(submitted.hardcore !== undefined ? { hardcore: input.hardcore } : {}),
          }
        : undefined;
      const latest = StoredDraft.parse(store.creationDraft(input.draftId));
      if (JSON.stringify(latest) !== JSON.stringify(saved.data))
        throw new HTTPException(409, {
          message: "Your draft changed while preparing the campaign. Try again.",
        });
      const settings = {
        ...creationSettings(pack, input),
        ...(review
          ? {
              subsystems:
                !input.review && submitted.preset !== undefined
                  ? (presetSelection(input.preset).subsystems ?? review.subsystems)
                  : review.subsystems,
              theme: review.theme,
              style: review.style,
              lethality: review.lethality,
              companionDeath: review.companionDeath,
              structural: {
                progression: input.progression,
                resolution: review.resolution,
                hardcore: review.hardcore,
              },
            }
          : {}),
      };
      const sourced = saved.data.source
        ? sourceEvents(
            saved.data.source,
            saved.data.input,
            [...worldEvents(world, []), ...bible],
            world.gameTime,
          )
        : [];
      const id = createGame(
        saved.data.input.name,
        input.ancestry && input.archetype ? sheet : { ...sheet, name: sheet.name || characterName },
        pack,
        world,
        [...bible, ...sourced],
        hooks,
        settings,
        saved.data.input.pitch,
        review?.startingLevel,
      );
      store.saveCreationDraft(input.draftId, { ...saved.data, campaignId: id });
      return c.json({ id }, 201);
    } finally {
      starting.delete(input.draftId);
    }
  });
  // Explicit authored test fixture; the normal web flow never chooses fantasy-core implicitly.
  app.post("/api/campaigns/quick-start", async (c) => {
    const {
      world: worldId,
      pregen,
      name,
      characterName,
      progression,
      preset,
      storyMode,
      resolution,
      hardcore,
      ...input
    } = await body(c, QuickStartInput);
    const sheet = pregen
      ? pregenDraft(pack, pregen)
      : archetypeDraft(
          pack,
          `${pack.manifest.id}:${input.ancestry}`,
          `${pack.manifest.id}:${input.archetype}`,
          "",
        );
    const world = worlds[worldId]!;
    const hooks = await hookPlan(sheet, worldEvents(world, []), world);
    const id = createGame(
      name,
      { ...sheet, name: characterName || sheet.name },
      pack,
      world,
      [],
      hooks,
      creationSettings(pack, { progression, preset, storyMode, resolution, hardcore }),
    );
    return c.json({ id }, 201);
  });
  /** A draft from an origin and background, with the background's kit (spec 04 quick start). */
  function archetypeDraft(pack: CompiledPack, ancestry: string, archetype: string, characterName: string) {
    const def = creationContent([pack]).archetypes[archetype];
    if (!def || !pack.ancestries[ancestry])
      throw new HTTPException(422, { message: "Choose an origin and background from this world" });
    return draftFromArchetype(ancestry, def, characterName);
  }
  /** Builds and validates a PC; a 422 names the first broken rule. */
  function buildPc(
    id: string,
    draft: DraftSheet,
    pack: CompiledPack,
    settings: GameState["campaign"]["settings"],
  ) {
    const { sheet, issues } = evaluateDraft(draft, pack, id, settings);
    const problem = issues.find((i) => i.severity === "error");
    if (problem)
      throw new HTTPException(422, { message: `This character isn't valid yet: ${problem.message}` });
    return sheet;
  }
  /**
   * Backstory hooks → canon (spec 04): the worldGen role places them in the world (stage 2), or a
   * fixed placement does offline and on failure.
   */
  async function hookPlan(
    character: DraftSheet,
    existing: EventDraft[],
    world: WorldDef,
    startSite?: string,
  ) {
    if (!character.hooks.length) return undefined;
    const fallback = defaultPlacements(character.hooks, existing, startSite);
    const names = (kind: string) =>
      existing.flatMap((e) =>
        e.type === "EntityCreated" && (e.payload as { entity: Entity }).entity.kind === kind
          ? [(e.payload as { entity: Entity }).entity.name]
          : [],
      );
    const router = options.offline ? null : models.router();
    const placements =
      router && names("site").length
        ? await placeHooks(router, {
            world: { name: world.name, premise: world.premise },
            sites: names("site"),
            startSite: startSite ?? null,
            factions: names("faction"),
            hooks: character.hooks,
          }).catch(() => fallback)
        : fallback;
    return hookEvents(character.hooks, "pc", existing, placements, world.gameTime);
  }
  /** Campaign settings from the wizard's rules choices (spec 11, 12), validated against the pack. */
  function creationSettings(
    pack: CompiledPack,
    choice: {
      preset: CampaignPreset;
      storyMode: "threatClock" | "livingWorld";
      resolution: ResolutionId;
      progression: ProgressionMode;
      hardcore: boolean;
    },
  ): CampaignSettingsInput {
    if (!pack.manifest.supports.progression.includes(choice.progression))
      throw new HTTPException(422, {
        message: `This world does not support ${choice.progression} progression`,
      });
    return {
      structural: {
        resolution: choice.resolution,
        progression: choice.progression,
        hardcore: choice.hardcore,
      },
      story: { mode: choice.storyMode },
      ...presetSelection(choice.preset),
    };
  }
  function createGame(
    name: string,
    character: DraftSheet,
    pack: CompiledPack,
    world: WorldDef,
    extra: EventDraft[] = [],
    hooks?: { ids: string[]; events: EventDraft[] },
    settings: CampaignSettingsInput = {},
    pitch?: string,
    startingLevel?: Level,
  ) {
    // Player-written gear becomes real pack items before anything is frozen or built.
    const gamePack = withPlayerGear(pack, character.gear);
    const created = unwrap(
      createCampaign({
        name,
        settings,
        packIds: [gamePack.manifest.id],
        packHash: gamePack.hash,
        seed: options.seed ?? randomBytes(16).toString("hex"),
      }),
    );
    const built = {
      ...buildPc("pc", character, gamePack, created.payload.settings),
      ...(startingLevel ? { level: startingLevel } : {}),
    };
    const sheet = hooks ? { ...built, identity: { ...built.identity, hookIds: hooks.ids } } : built;
    const template = gamePack.economy?.shops[0];
    const shop = template
      ? ShopState.parse({
          id: `shop:${template.id}`,
          templateId: template.id,
          name: template.name,
          kind: template.kind,
          settlement: template.settlement,
          markup: template.markup,
          merchant: {
            id: `npc:merchant-${template.id}`,
            name: template.merchant?.name ?? "the shopkeeper",
            insight: template.merchant?.insight ?? 30,
          },
          stock: template.stock.map((line) => ({ itemId: line.item, qty: line.qty })),
          lastRefresh: 0,
        })
      : null;
    const id = randomUUID();
    const dir = join(options.home, "campaigns", id);
    mkdirSync(dir, { recursive: true });
    const game = CampaignStore.create<GameState>(join(dir, "campaign.db"), created, {
      reduce,
      pack: { hash: gamePack.hash, content: gamePack },
    });
    try {
      game.append(unwrap(createActor(game.state(), sheet, "pc")));
      // The sheet's kit is carried for combat; the inventory projection needs the same items.
      game.append(startingKitEvents(sheet.id, sheet.equipment));
      game.append(
        playerCanonEvents({
          pcId: sheet.id,
          sheet,
          gear: character.gear,
          pitch,
          newId: () => randomUUID(),
        }),
      );
      game.append([
        draft("EntityCreated", {
          entity: Entity.parse({
            id: "concept:world-bible",
            kind: "concept",
            name: world.name,
            detail: "full",
            summary: world.premise,
          }),
        }),
        ...worldEvents(world, [sheet.id]),
        ...extra,
        ...(hooks?.events ?? []),
        ...(shop ? [draft("ShopOpened", { shop }, "engine")] : []),
        draft(
          "CoinsChanged",
          { actorId: sheet.id, delta: defaultTuning.economy.startingCoins, reason: "starting purse" },
          "engine",
        ),
      ]);
      store.addCampaign({
        id,
        name,
        characterName: sheet.identity.name,
        updatedAt: new Date(now()).toISOString(),
        archived: false,
      });
      campaigns.set(id, game);
    } catch (error) {
      game.close();
      throw error;
    }
    return id;
  }
  function gameView(id: string) {
    const game = campaign(id);
    const state = game.state();
    const canon = new CanonQueries(game);
    const pc = state.actors[state.party.pcId!]!.sheet;
    const scene = state.scene;
    const here = scene?.positions[pc.id];
    const snapshots = new Map(
      game
        .events()
        .filter((e) => e.type === "NarrationCommitted" || e.type === "NarrationRerolled")
        .map((e) => [e.turnId, e.payload]),
    );
    const gamePack = game.packSnapshot()!.content as CompiledPack;
    const gameItems = catalogWith(state, gamePack.items);
    const skills = skillCatalog([gamePack]);
    const resolution = state.campaign.settings.structural.resolution;
    const resolutionModule = RESOLUTION_MODULES[resolution];
    const view = combatParts(game, state, gamePack);
    const turns = canon.recentTurns(100);
    // The GM turn's records live in events, not state: retcon summaries and check flags per turn.
    const events = game.events();
    const retconSummaries = new Map(
      events
        .filter((e) => e.type === "RetconApplied")
        .map((e) => {
          const p = parseEventPayload("RetconApplied", e.payload);
          return [p.retconId, p.summary] as const;
        }),
    );
    const checkFlags = new Map(
      events
        .filter((e) => e.type === "CheckReported")
        .map((e) => {
          const p = parseEventPayload("CheckReported", e.payload);
          return [p.turnId, p.flags] as const;
        }),
    );
    const latestTurnId = turns.at(-1)?.id;
    // A GM campaign's suggestions are its latest GM turn's choices, not generic filler.
    let gmChoices: { label: string }[] | null = null;
    for (let i = turns.length - 1; i >= 0 && !gmChoices; i--) {
      const record = TurnCompletedEventPayload.safeParse(turns[i]!.record);
      if (record.success && record.data.gm) gmChoices = record.data.gm.choices;
    }
    // Resolve only IDs already spoken in player-visible passages, never the full NPC registry.
    // This also keeps older dialogue labelled after its speaker leaves the current room.
    const speakers: Record<string, string> = { [pc.id]: pc.identity.name };
    for (const turn of turns) {
      for (const match of (turn.narration ?? "").matchAll(/<say\s+who=(?:"([^"]*)"|'([^']*)')\s*>/g)) {
        const who = match[1] ?? match[2] ?? "";
        const entity = canon.entity(who.trim());
        if (entity?.kind === "npc" || entity?.kind === "creature") speakers[who.trim()] = entity.name;
      }
    }
    return GameView.parse({
      id,
      name: state.campaign.name,
      gameTime: state.campaign.gameTime,
      worldName: canon.entity("concept:world-bible")?.name ?? state.campaign.name,
      opening: scene
        ? String(
            canon.factsAbout(scene.locationId).find((f) => f.predicate === "opening")?.value ??
              "Look around, speak to someone nearby, or follow your curiosity.",
          )
        : "Your next chapter awaits.",
      originName: gamePack.ancestries[pc.identity.ancestry]?.name ?? pc.identity.ancestry,
      backgroundName: gamePack.archetypes[pc.archetypeId ?? ""]?.name ?? "",
      // A mark written before downtime validated ids must not break an old campaign's view.
      pc: {
        ...pc,
        progression: {
          ...pc.progression,
          marks: pc.progression.marks.filter((id) => isKnownSkill(id, skills)),
        },
      },
      speakers,
      powerRating: powerRating(pc),
      levelProposals: levelProposals(state).filter(
        (p) => p.actorId === pc.id || state.party.companionIds.includes(p.actorId),
      ),
      avatars: avatarRuns(state).map((run) => ({
        ...run,
        name: state.actors[run.avatarId]?.sheet.identity.name ?? run.avatarId,
      })),
      resolution,
      theme: state.campaign.settings.theme ?? gamePack.theme ?? null,
      shop: (() => {
        const shopState = Object.values(state.economy?.shops ?? {})[0];
        if (!shopState) return null;
        return {
          id: shopState.id,
          name: shopState.name,
          attitude: shopState.attitude,
          items: shopState.stock.map((line) => {
            const item =
              gameItems.weapons[line.itemId] ?? gameItems.armor[line.itemId] ?? gameItems.gear[line.itemId];
            return {
              id: line.itemId,
              name: item?.name ?? line.itemId,
              basePrice: line.price ?? item?.price ?? 0,
              price: Math.max(
                1,
                Math.round(
                  (line.price ?? item?.price ?? 0) *
                    shopState.markup *
                    shopState.priceModifier *
                    (shopState.bargain?.actorId === pc.id ? shopState.bargain.modifier : 1),
                ),
              ),
              stock: line.qty,
            };
          }),
        };
      })(),
      survival: (() => {
        const sl = survivalOf(state.flags);
        const needs = sl.needs[pc.id];
        return {
          food: needs?.daysWithoutFood ?? 0,
          water: needs?.daysWithoutWater ?? 0,
          sleep: needs?.hoursAwake ?? 0,
          exposure: needs?.exposure ?? 0,
          exposureKind: needs?.exposureKind ?? "none",
          notices: sl.notices.slice(-4).map((n) => ({ id: n.id, kind: n.kind, text: n.text })),
        };
      })(),
      inventory: {
        capacityKg: capacityKg(pc, defaultTuning),
        weightKg: carriedKg(state, pc.id, { items: gameItems, tuning: defaultTuning }),
        band: encumbranceBand(state, pc.id, { items: gameItems, tuning: defaultTuning }),
        coins: state.economy?.wallets[pc.id]?.coins ?? 0,
        items: (state.inventory?.actors[pc.id]?.stacks ?? []).map((stack) => {
          const item =
            gameItems.weapons[stack.itemId] ?? gameItems.armor[stack.itemId] ?? gameItems.gear[stack.itemId];
          // The sheet's equipment is the combat-facing truth; show it on the item so the bag and
          // the shared item card agree after an instant equip or stow (U4).
          const location =
            pc.equipment.held.main === stack.itemId
              ? "main hand"
              : pc.equipment.held.off === stack.itemId
                ? "off hand"
                : pc.equipment.worn.includes(stack.itemId)
                  ? "worn"
                  : stack.location.kind === "container"
                    ? "pack"
                    : "carried";
          return {
            id: stack.itemId,
            name: item?.name ?? stack.itemId,
            qty: stack.qty,
            location,
            condition: stack.condition,
            quality: stack.quality,
            kind: gameItems.weapons[stack.itemId]
              ? ("weapon" as const)
              : gameItems.armor[stack.itemId]
                ? ("armor" as const)
                : ("gear" as const),
            description: item?.description ?? "",
          };
        }),
      },
      spells: visibleSpells(state, gamePack, pc.id),
      skills: Object.keys(pc.skills).map((id) => {
        const value = skillValue(pc, id, skills, defaultTuning);
        return {
          id,
          name: skillLabel(id, skills),
          value,
          display: resolutionModule.displaySkill(value),
        };
      }),
      scene: scene
        ? {
            location: canon.entity(scene.locationId)?.name ?? "Unknown place",
            zone: scene.zones.find((z) => z.id === here)?.name ?? "",
            weather: scene.weather,
            present: Object.entries(scene.positions)
              .filter(([who, zone]) => who !== pc.id && zone === here)
              .map(([id]) => ({ id, name: canon.entity(id)?.name ?? "Someone" })),
          }
        : null,
      turns: turns.map((t) => {
        const record = TurnCompletedEventPayload.parse(t.record);
        const retcon = state.retcons.filter((r) => r.turnId === t.id).at(-1);
        return {
          id: t.id,
          input: t.input,
          status: record.status,
          narration: t.narration,
          mechanics: record.mechanics,
          ...(record.clarification
            ? {
                clarification: {
                  question: record.clarification.question,
                  options: record.clarification.options.map((o) => ({ label: o.label })),
                },
              }
            : {}),
          ...(record.status === "ooc" ? { answer: record.answer } : {}),
          ...(snapshots.get(t.id) ? { guard: snapshots.get(t.id)!.guard } : {}),
          cards: record.gm?.cards ?? [],
          choices: record.gm?.choices ?? [],
          backup: record.gm?.backup ?? false,
          checkFlags: checkFlags.get(t.id) ?? [],
          ...(retcon
            ? {
                retcon: {
                  retconId: retcon.retconId,
                  summary: retconSummaries.get(retcon.retconId) ?? "",
                  undone: retcon.undone,
                  undoable: latestTurnId === t.id && !retcon.undone,
                },
              }
            : {}),
        };
      }),
      suggestions: state.campaign.settings.narration.suggestions
        ? gmChoices
          ? gmChoices.map((choice) => choice.label)
          : view.combat
            ? view.combat.actions
                .filter((a) => a.legal)
                .slice(0, 4)
                .map((a) => a.fill)
            : ["Look around", "Search the area", "Wait 10 minutes"]
        : [],
      offline: options.offline,
      combat: view.combat,
      ended: view.ended,
      address: addressOf(canon),
      known: Object.keys(state.knowledge.entities).flatMap((kid) => {
        const e = canon.entity(kid);
        return e && e.kind !== "concept" ? [{ id: kid, name: e.name, kind: e.kind }] : [];
      }),
    });
  }
  app.get("/api/campaigns/:id/view", (c) => c.json(gameView(c.req.param("id"))));
  /** Lazy generation for a campaign (spec 06): offline stand-ins, or worldGen calls. */
  function lazyFor(game: CampaignStore<GameState>, canon: CanonQueries) {
    const world = () => canon.entity("concept:world-bible");
    return {
      location: async (siteId: string): Promise<EventDraft[]> => {
        const site = canon.entity(siteId);
        if (!site) return [];
        const region = canon.entity(String((site.data as { regionId?: string }).regionId ?? ""));
        const kind = String((site.data as { kind?: string }).kind ?? "settlement");
        const proposal = options.offline
          ? offlineLocation({ name: site.name, kind })
          : await generateLocation(
              models.router(),
              {
                world: `${world()?.name ?? ""}: ${world()?.summary ?? ""}`,
                site: site.name,
                siteKind: kind,
                siteSummary: site.summary,
                region: region?.name ?? "",
                culture: String((region?.data as { culture?: string } | undefined)?.culture ?? ""),
                taken: canon.allNames(),
              },
              game.state().campaign.settings.content,
            );
        return locationEvents(
          proposal,
          siteId,
          site.data,
          canon.allEntities().map((e) => e.id),
        ).events;
      },
      elaborate: async (entityId: string): Promise<EventDraft[]> => {
        const entity = canon.entity(entityId);
        if (!entity) return [];
        const e = options.offline
          ? offlineElaboration(entity)
          : await elaborateEntity(
              models.router(),
              {
                world: `${world()?.name ?? ""}: ${world()?.summary ?? ""}`,
                entity,
                facts: canon.factsAbout(entityId),
              },
              game.state().campaign.settings.content,
            );
        const n = canon.factsAbout(entityId, { includeSecret: true, includeHistory: true }).length;
        return [
          draft("EntityUpdated", { entityId, patch: { detail: "sketch", summary: e.summary } }, "engine"),
          ...e.facts.map((f, i) =>
            draft(
              "FactAsserted",
              {
                fact: {
                  id: `fact:${entityId}:e${n + i + 1}`,
                  entityId,
                  predicate: f.predicate,
                  value: f.value,
                  source: "model" as const,
                  visibility: f.secret ? ("secret" as const) : ("public" as const),
                  importance: 2,
                },
              },
              "engine",
            ),
          ),
        ];
      },
    };
  }
  /** Combat panel and death screen for the PC's view. */
  function combatParts(game: CampaignStore<GameState>, state: GameState, gamePack: CompiledPack) {
    const canon = new CanonQueries(game);
    const pcId = state.party.pcId!;
    const ctx = makeTurnContext(
      state,
      canon,
      { skills: skillCatalog([gamePack]), tuning: defaultTuning, classes: gamePack.classes },
      combatContent(gamePack),
    );
    let ended: { reason: "death"; obituary: string } | null = null;
    if (state.actors[pcId]?.dead) {
      const died = [...game.events()]
        .reverse()
        .find((e) => e.type === "ActorDied" && (e.payload as { actorId: string }).actorId === pcId);
      const cause = (died?.payload as { cause?: string } | undefined)?.cause ?? "died";
      const place = state.scene
        ? (canon.entity(state.scene.locationId)?.name ?? "an unknown place")
        : "an unknown place";
      ended = { reason: "death", obituary: obituary(state, pcId, cause, place, ctx.nameOf) };
    }
    return { combat: combatView(state, actingActor(state) ?? pcId, ctx), ended };
  }
  // Legacy (spec 03): after a hardcore death, a new character in the same world.
  app.post("/api/campaigns/:id/legacy", async (c) => {
    const id = c.req.param("id");
    const game = campaign(id);
    const input = await body(c, LegacyInput);
    if (store.running(id)) throw new HTTPException(409, { message: "A turn is already running" });
    const state = game.state();
    const gamePack = game.packSnapshot()!.content as CompiledPack;
    const view = combatParts(game, state, gamePack);
    if (!view.ended) throw new HTTPException(409, { message: "Legacy is for a character who has died" });
    const ns = gamePack.manifest.id;
    const qualify = (x: string) => (x.includes(":") ? x : `${ns}:${x}`);
    const dead = state.actors[state.party.pcId!]!.sheet;
    const newId = `pc-${Object.values(state.actors).filter((a) => a.role === "pc").length + 1}`;
    const sheet = buildPc(
      newId,
      archetypeDraft(
        gamePack,
        qualify(input.ancestry ?? dead.identity.ancestry),
        qualify(input.archetype ?? dead.archetypeId ?? Object.keys(gamePack.archetypes)[0] ?? ""),
        input.characterName,
      ),
      gamePack,
      state.campaign.settings,
    );
    game.append(unwrap(legacyEvents(state, sheet, view.ended.obituary)));
    return c.json({ id }, 201);
  });
  function launch(
    id: string,
    jobId: string,
    input: string,
    target?: string,
    actions?: Parameters<TurnPipeline["run"]>[0]["actions"],
  ) {
    const game = campaign(id);
    const canon = new CanonQueries(game);
    const frozen = game.packSnapshot()!.content as CompiledPack;
    let firstId = true;
    const pipeline = new TurnPipeline({
      store: game,
      canon,
      router: models.router(),
      lore: options.offline
        ? undefined
        : new LoreResearch({
            router: models.router(),
            cache: new LoreCache(options.home),
            client: options.loreClient,
          }),
      rules: { skills: skillCatalog([frozen]), tuning: defaultTuning, classes: frozen.classes },
      content: combatContent(frozen),
      recruitSheet: (npcId, state) =>
        recruitSheet(frozen, canon.entity(npcId) ?? null, npcId, state.campaign.settings),
      lazy: lazyFor(game, canon),
      tone: frozen.tone,
      worldBible: canon.entity("concept:world-bible")?.summary ?? "",
      styleExamples,
      campaignId: game.campaignId,
      newId: () => {
        if (firstId) {
          firstId = false;
          return jobId;
        }
        return randomUUID();
      },
    });
    const emit = (e: TurnStreamEvent) =>
      store.emit(
        jobId,
        e.type,
        e.type === "error"
          ? { ...e, message: "The model could not finish this passage. You can retry narration." }
          : e,
      );
    const task = (async () => {
      try {
        if (target) await pipeline.reroll(target, emit);
        else {
          await pipeline.run({ input, ...(actions ? { actions } : {}), onEvent: emit });
          // A companion who just joined gets their values and personal quest (spec 04).
          await profileNewCompanions(game, options.offline ? null : models.router()).catch(() => undefined);
          // Memory pyramid (spec 07): close scenes, chapters and arcs as their boundaries pass.
          await writeSummaries(game, canon, options.offline ? null : models.router(), {
            gameTime: game.state().campaign.gameTime,
            content: game.state().campaign.settings.content,
            onClose: (level) =>
              game.append(closeEvents(game.state(), level, creationContent([frozen]), defaultTuning)),
          }).catch(() => 0);
        }
        store.touchCampaign(id);
      } catch {
        emit({
          type: "error",
          message: "The turn could not be completed. Refresh before trying again.",
          retryable: false,
        });
        emit({ type: "turn.completed", turnId: target ?? jobId });
      } finally {
        store.finish(jobId);
      }
    })();
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  }
  app.post("/api/campaigns/:id/turns", async (c) => {
    const id = c.req.param("id");
    const game = campaign(id);
    const input = await body(c, SubmitTurnInput);
    const existing = store.request(id, input.clientTurnId);
    if (existing) {
      if (existing.input !== JSON.stringify(input))
        throw new HTTPException(409, { message: "This turn ID was already used for another input" });
      return c.json({ turnId: existing.id });
    }
    if (store.running(id)) throw new HTTPException(409, { message: "A turn is already running" });
    const now = game.state();
    if (now.actors[now.party.pcId ?? ""]?.dead)
      throw new HTTPException(409, { message: "Your character has died. Begin a new life to go on." });
    let actions: Parameters<TurnPipeline["run"]>[0]["actions"];
    let text = input.input;
    if (input.clarification) {
      const turns = new CanonQueries(game).recentTurns(1);
      const last = turns[0];
      const record = last?.record ? TurnCompletedEventPayload.parse(last.record) : null;
      const choice = record?.clarification?.options[input.clarification.option];
      if (last?.id !== input.clarification.turnId || !choice)
        throw new HTTPException(409, { message: "That clarification is no longer current" });
      text = choice.label;
      actions = choice.actions as typeof actions;
    }
    models.router();
    const jobId = randomUUID();
    store.startJob({
      id: jobId,
      campaign_id: id,
      client_id: input.clientTurnId,
      input: JSON.stringify(input),
      status: "running",
      target_id: null,
    });
    launch(id, jobId, text, undefined, actions);
    return c.json({ turnId: jobId }, 202);
  });
  app.post("/api/campaigns/:id/turns/:turnId/reroll", (c) => {
    const id = c.req.param("id");
    const target = c.req.param("turnId");
    const game = campaign(id);
    if (store.running(id)) throw new HTTPException(409, { message: "A turn is already running" });
    if (new CanonQueries(game).turn(target)?.status !== "resolved")
      throw new HTTPException(409, { message: "Only a resolved passage can be rerolled" });
    models.router();
    const jobId = randomUUID();
    store.startJob({
      id: jobId,
      campaign_id: id,
      client_id: jobId,
      input: "reroll",
      status: "running",
      target_id: target,
    });
    launch(id, jobId, "", target);
    return c.json({ turnId: jobId }, 202);
  });
  app.post("/api/campaigns/:id/levels/:proposalId/accept", (c) => {
    const id = c.req.param("id");
    const game = campaign(id);
    if (store.running(id)) throw new HTTPException(409, { message: "A turn is already running" });
    const state = game.state();
    const proposalId = c.req.param("proposalId");
    const proposal = levelProposals(state).find((p) => p.id === proposalId);
    if (
      !proposal ||
      (proposal.actorId !== state.party.pcId && !state.party.companionIds.includes(proposal.actorId))
    )
      throw new HTTPException(404, { message: "No such level proposal" });
    const result = acceptLevelUp(state, proposalId);
    if (!result.ok) throw new HTTPException(409, { message: result.errors[0]!.message });
    game.append(result.value);
    store.touchCampaign(id);
    return c.json(gameView(id));
  });
  /** Undo a retcon until the player takes another turn (D144). */
  app.post("/api/campaigns/:id/retcons/:retconId/undo", (c) => {
    const id = c.req.param("id");
    const retconId = c.req.param("retconId");
    const game = campaign(id);
    const record = game.state().retcons.find((r) => r.retconId === retconId);
    if (!record) throw new HTTPException(404, { message: "No such retcon" });
    const latest = new CanonQueries(game).recentTurns(1)[0];
    if (record.undone || latest?.id !== record.turnId)
      throw new HTTPException(409, { message: "Undo is only available until your next turn" });
    const applied = game
      .events()
      .filter((e) => e.type === "RetconApplied")
      .map((e) => parseEventPayload("RetconApplied", e.payload))
      .find((p) => p.retconId === retconId);
    if (!applied) throw new HTTPException(404, { message: "No such retcon" });
    game.append([...(applied.inverse as EventDraft[]), draft("RetconUndone", { retconId })]);
    return c.json(gameView(id));
  });
  /** Fix a structural check's flags by queueing a GM turn that reconciles the story with the record. */
  app.post("/api/campaigns/:id/turns/:turnId/fix", (c) => {
    const id = c.req.param("id");
    const target = c.req.param("turnId");
    const game = campaign(id);
    if (store.running(id)) throw new HTTPException(409, { message: "A turn is already running" });
    const report = game
      .events()
      .filter((e) => e.type === "CheckReported")
      .map((e) => parseEventPayload("CheckReported", e.payload))
      .filter((p) => p.turnId === target)
      .at(-1);
    if (!report?.flags.length)
      throw new HTTPException(409, { message: "There is nothing to fix on that passage" });
    const text = `Reconcile the story with the recorded state for these claims: ${report.flags
      .map((flag) => flag.claim)
      .join("; ")}`;
    models.router();
    const jobId = randomUUID();
    store.startJob({
      id: jobId,
      campaign_id: id,
      client_id: jobId,
      input: "fix",
      status: "running",
      target_id: null,
    });
    launch(id, jobId, text);
    return c.json({ turnId: jobId }, 202);
  });
  app.post("/api/campaigns/:id/downtime", async (c) => {
    const id = c.req.param("id");
    const game = campaign(id);
    const input = await body(c, DowntimeRequest);
    if (!input.action) throw new HTTPException(422, { message: "Choose a downtime activity from the list" });
    const state = game.state();
    const pcId = state.party.pcId;
    if (!pcId) throw new HTTPException(409, { message: "This campaign has no player character" });
    const pack = game.packSnapshot()!.content as CompiledPack;
    const canon = new CanonQueries(game);
    const out = resolveDowntime(state, pcId, input.action, {
      skills: skillCatalog([pack]),
      tuning: defaultTuning,
      nameOf: (eid: string) => state.actors[eid]?.sheet.identity.name ?? canon.entity(eid)?.name ?? eid,
      recipes: pack.recipes ?? {},
      items: catalogWith(state, pack.items),
    });
    if (!out.ok)
      throw new HTTPException(422, {
        message: out.errors.map((e) => e.message).join("; ") || "That downtime activity can't be done",
      });
    game.append(out.value.events);
    // Source canon advances during downtime too, without waiting for another player turn.
    if (
      game.state().flags.canonActors ||
      Object.values(game.state().clocks).some((clock) => clock.kind === "canon")
    ) {
      game.append(
        runTicks(
          game.state(),
          makeTurnContext(
            game.state(),
            canon,
            { skills: skillCatalog([pack]), tuning: defaultTuning },
            combatContent(pack),
          ),
        ),
      );
    }
    return c.json(out.value.result);
  });
  app.post("/api/campaigns/:id/inventory/move", async (c) => {
    const id = c.req.param("id");
    const game = campaign(id);
    if (store.running(id))
      throw new HTTPException(409, { message: "A turn is running. Wait for it to finish." });
    const state = game.state();
    const pcId = state.party.pcId;
    if (!pcId) throw new HTTPException(409, { message: "This campaign has no player character" });
    const input = await body(
      c,
      z
        .object({
          itemId: z.string().min(1).max(200),
          to: z.enum(["main", "off", "worn", "carried"]),
        })
        .strict(),
    );
    const pack = game.packSnapshot()!.content as CompiledPack;
    const out = moveEquipment(state, pcId, input.itemId, input.to, catalogWith(state, pack.items));
    if (!out.ok) throw new HTTPException(409, { message: out.errors.map((e) => e.message).join("; ") });
    game.append(out.value);
    return c.json({ ok: true });
  });
  app.post("/api/campaigns/:id/shop/:verb", async (c) => {
    const id = c.req.param("id");
    const verb = c.req.param("verb");
    const game = campaign(id);
    const state = game.state();
    const pcId = state.party.pcId;
    const shopState = Object.values(state.economy?.shops ?? {})[0];
    if (!pcId || !shopState) throw new HTTPException(409, { message: "There is no shop here to trade with" });
    const pack = game.packSnapshot()!.content as CompiledPack;
    const canon = new CanonQueries(game);
    const ctx = {
      skills: skillCatalog([pack]),
      tuning: defaultTuning,
      nameOf: (eid: string) => state.actors[eid]?.sheet.identity.name ?? canon.entity(eid)?.name ?? eid,
      items: catalogWith(state, pack.items),
    };
    const out =
      verb === "haggle"
        ? haggle(state, pcId, shopState.id, ctx)
        : await (async () => {
            const input = await body(
              c,
              z.object({ itemId: z.string().min(1), qty: z.number().int().positive().max(99) }),
            );
            return verb === "buy"
              ? buy(state, pcId, shopState.id, input.itemId, input.qty, ctx)
              : verb === "sell"
                ? sell(state, pcId, shopState.id, input.itemId, input.qty, ctx)
                : null;
          })();
    if (!out) throw new HTTPException(404, { message: "Unknown shop action" });
    if (!out.ok) throw new HTTPException(409, { message: out.errors.map((e) => e.message).join("; ") });
    game.append(out.value);
    return c.json({ ok: true });
  });
  app.get("/api/campaigns/:id/turns/:turnId/stream", (c) => {
    const jobId = c.req.param("turnId");
    const job = store.job(jobId);
    if (!job || job.campaign_id !== c.req.param("id"))
      throw new HTTPException(404, { message: "Turn not found" });
    const after = Number(c.req.header("Last-Event-ID") ?? c.req.query("after") ?? "0");
    if (!Number.isSafeInteger(after) || after < 0)
      throw new HTTPException(422, { message: "Invalid stream cursor" });
    return streamSSE(c, async (stream) => {
      let cursor = after;
      while (!stream.aborted) {
        const done = store.job(jobId)?.status === "done";
        for (const event of store.stream(jobId, cursor)) {
          await stream.writeSSE({ id: String(event.seq), event: event.type, data: event.data });
          cursor = event.seq;
        }
        if (done) break;
        await stream.sleep(100);
      }
    });
  });
  function draftErrorDetail(error: unknown): string {
    if (error instanceof HTTPException) return error.message;
    if (error instanceof Error) {
      const provider = (error as { provider?: string }).provider;
      return `${error.message}${provider ? ` (${provider})` : ""}`;
    }
    return String(error);
  }

  app.onError((error, c) =>
    c.json(
      { error: error instanceof HTTPException ? error.message : "The request could not be completed" },
      error instanceof HTTPException ? error.status : 500,
    ),
  );
  app.notFound((c) => c.json({ error: "Not found" }, 404));
  return {
    app,
    store,
    idle: () => Promise.all(tasks),
    close: () => {
      for (const game of campaigns.values()) game.close();
      store.close();
    },
  };
}

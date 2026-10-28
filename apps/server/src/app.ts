import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type CompiledPack,
  defaultTuning,
  draft,
  Entity,
  GameView,
  LegacyInput,
  PasscodeInput,
  QuickStartInput,
  StartGeneratedCampaign,
  SubmitTurnInput,
  TurnCompletedPayload,
  WorldPitch,
  WorldProposal,
} from "@wyrd/core";
import {
  buildSheet,
  combatView,
  createActor,
  createCampaign,
  type GameState,
  legacyEvents,
  obituary,
  reduce,
  skillLabel,
  skillValue,
  startingEquipment,
  unwrap,
  validateCreation,
} from "@wyrd/engine";
import {
  combatContent,
  generateWorld,
  makeTurnContext,
  type RoleRouter,
  SecretStore,
  TurnPipeline,
  type TurnStreamEvent,
} from "@wyrd/llm";
import {
  compileGeneratedWorld,
  creationContent,
  generatedWorldPreview,
  loadPack,
  loadWorld,
  skillCatalog,
  type WorldDef,
  worldEvents,
} from "@wyrd/packs";
import { AppStore, CampaignStore, CanonQueries } from "@wyrd/storage";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { NONCE, type SecureHeadersVariables, secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { EXAMPLE_WORLD } from "./example-world.ts";
import { ModelServices, mountModels } from "./models.ts";

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const loopback = (ip: string) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
export type AppEnvironment = { Bindings: { remoteAddress?: string }; Variables: SecureHeadersVariables };
type Options = { home: string; offline: boolean; packDir?: string; router?: RoleRouter; now?: () => number };

export function createApp(options: Options) {
  mkdirSync(options.home, { recursive: true });
  const store = new AppStore(join(options.home, "app.db"));
  store.recover();
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
  app.use("/api/*", bodyLimit({ maxSize: 16 * 1024 }));
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
    }
    return opened;
  }
  app.get("/api/campaigns", (c) => c.json(store.campaigns()));
  app.get("/api/packs", (c) =>
    c.json({
      archetypes: Object.values(content.archetypes).map((a) => ({ id: a.id.split(":")[1], name: a.name })),
      ancestries: Object.values(content.ancestries).map((a) => ({ id: a.id.split(":")[1], name: a.name })),
    }),
  );
  const StoredDraft = z.object({
    input: WorldPitch,
    proposal: WorldProposal,
    offline: z.boolean(),
    campaignId: z.string().optional(),
  });
  let generating = false;
  app.post("/api/world-drafts", async (c) => {
    const input = await body(c, WorldPitch);
    if (generating)
      throw new HTTPException(409, { message: "A world is already being generated. Please wait." });
    generating = true;
    try {
      const offline = options.offline && !options.router;
      const proposal = offline ? EXAMPLE_WORLD : await generateWorld(models.router(), input);
      const { pack } = compileGeneratedWorld(proposal);
      const id = randomUUID();
      store.saveCreationDraft(id, { input, proposal, offline });
      return c.json(generatedWorldPreview(id, input.name, proposal, pack, offline), 201);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      throw new HTTPException(502, {
        message:
          "The world could not be generated or validated. Your description is still here; try again or check model settings.",
      });
    } finally {
      generating = false;
    }
  });
  app.post("/api/campaigns", async (c) => {
    const input = await body(c, StartGeneratedCampaign);
    const saved = StoredDraft.safeParse(store.creationDraft(input.draftId));
    if (!saved.success)
      throw new HTTPException(404, { message: "World draft not found. Generate your world first." });
    if (saved.data.campaignId) return c.json({ id: saved.data.campaignId }, 201);
    const { pack, world } = compileGeneratedWorld(saved.data.proposal);
    const id = createGame(
      {
        name: saved.data.input.name,
        characterName: input.characterName || saved.data.proposal.suggestedCharacterName,
        ancestry: input.ancestry,
        archetype: input.archetype,
      },
      pack,
      world,
    );
    store.saveCreationDraft(input.draftId, { ...saved.data, campaignId: id });
    return c.json({ id }, 201);
  });
  // Explicit authored test fixture; the normal web flow never chooses fantasy-core implicitly.
  app.post("/api/campaigns/quick-start", async (c) => {
    const { world: worldId, ...input } = await body(c, QuickStartInput);
    const id = createGame(
      {
        ...input,
        ancestry: `${pack.manifest.id}:${input.ancestry}`,
        archetype: `${pack.manifest.id}:${input.archetype}`,
      },
      pack,
      worlds[worldId]!,
    );
    return c.json({ id }, 201);
  });
  /** A PC sheet from an origin and background, with the background's kit (spec 04 quick start). */
  function buildPc(
    id: string,
    input: { characterName: string; ancestry: string; archetype: string },
    pack: CompiledPack,
    settings: GameState["campaign"]["settings"],
  ) {
    const content = creationContent([pack]);
    const archetype = content.archetypes[input.archetype];
    if (!archetype || !content.ancestries[input.ancestry])
      throw new HTTPException(422, { message: "Choose an origin and background from this world" });
    return buildSheet(
      {
        id,
        identity: { name: input.characterName, ancestry: input.ancestry, background: archetype.description },
        bodyPlan: content.ancestries[input.ancestry]!.bodyPlan,
        archetypeId: archetype.id,
        attributes: archetype.suggestedAttributes,
        skills: Object.fromEntries(
          Object.entries(archetype.skills).map(([sk, trained]) => [sk, { trained }]),
        ),
        talents: [archetype.talent],
        equipment: startingEquipment(archetype.kit, pack.items),
      },
      settings,
      defaultTuning,
    );
  }
  function createGame(
    input: { name: string; characterName: string; ancestry: string; archetype: string },
    pack: CompiledPack,
    world: WorldDef,
  ) {
    const content = creationContent([pack]);
    const archetype = content.archetypes[input.archetype];
    if (!archetype || !content.ancestries[input.ancestry])
      throw new HTTPException(422, { message: "Choose an origin and background from this world" });
    const created = unwrap(
      createCampaign({
        name: input.name,
        packIds: [pack.manifest.id],
        packHash: pack.hash,
        seed: randomBytes(16).toString("hex"),
      }),
    );
    const sheet = buildPc("pc", input, pack, created.payload.settings);
    if (
      validateCreation(sheet, content, created.payload.settings, defaultTuning).some(
        (i) => i.severity === "error",
      )
    )
      throw new HTTPException(422, { message: "This character combination is invalid" });
    const id = randomUUID();
    const dir = join(options.home, "campaigns", id);
    mkdirSync(dir, { recursive: true });
    const game = CampaignStore.create<GameState>(join(dir, "campaign.db"), created, {
      reduce,
      pack: { hash: pack.hash, content: pack },
    });
    try {
      game.append(unwrap(createActor(game.state(), sheet, "pc")));
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
      ]);
      store.addCampaign({
        id,
        name: input.name,
        characterName: input.characterName,
        updatedAt: new Date(now()).toISOString(),
      });
      campaigns.set(id, game);
    } catch (error) {
      game.close();
      throw error;
    }
    return id;
  }
  app.get("/api/campaigns/:id/view", (c) => {
    const id = c.req.param("id");
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
    const skills = skillCatalog([gamePack]);
    const view = combatParts(game, state, gamePack);
    const turns = canon.recentTurns(100);
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
    return c.json(
      GameView.parse({
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
        pc,
        speakers,
        skills: Object.keys(pc.skills).map((id) => ({
          id,
          name: skillLabel(id, skills),
          value: skillValue(pc, id, skills, defaultTuning),
        })),
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
          const record = TurnCompletedPayload.parse(t.record);
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
          };
        }),
        suggestions: view.combat
          ? view.combat.actions
              .filter((a) => a.legal)
              .slice(0, 4)
              .map((a) => a.fill)
          : ["Look around", "Search the area", "Wait 10 minutes"],
        offline: options.offline,
        combat: view.combat,
        ended: view.ended,
      }),
    );
  });
  /** Combat panel and death screen for the PC's view. */
  function combatParts(game: CampaignStore<GameState>, state: GameState, gamePack: CompiledPack) {
    const canon = new CanonQueries(game);
    const pcId = state.party.pcId!;
    const ctx = makeTurnContext(
      state,
      canon,
      { skills: skillCatalog([gamePack]), tuning: defaultTuning },
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
    return { combat: combatView(state, pcId, ctx), ended };
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
    const newId = `pc-${Object.values(state.actors).filter((a) => a.role === "pc").length + 1}`;
    const sheet = buildPc(
      newId,
      {
        characterName: input.characterName,
        ancestry: qualify(input.ancestry),
        archetype: qualify(input.archetype),
      },
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
      rules: { skills: skillCatalog([frozen]), tuning: defaultTuning },
      content: combatContent(frozen),
      tone: frozen.tone,
      worldBible: canon.entity("concept:world-bible")?.summary ?? "",
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
        else await pipeline.run({ input, ...(actions ? { actions } : {}), onEvent: emit });
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
    let actions: Parameters<TurnPipeline["run"]>[0]["actions"];
    let text = input.input;
    if (input.clarification) {
      const turns = new CanonQueries(game).recentTurns(1);
      const last = turns[0];
      const record = last?.record ? TurnCompletedPayload.parse(last.record) : null;
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

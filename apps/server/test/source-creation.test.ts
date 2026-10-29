import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CampaignSettingsView, CreationReview, GameView, GeneratedWorldPreview } from "@wyrd/core";
import { type GameState, reduce } from "@wyrd/engine";
import { FakeProvider, offlineBible, RoleRouter } from "@wyrd/llm";
import { CampaignStore } from "@wyrd/storage";
import wikipedia from "../../../packages/llm/test/fixtures/lore/wikipedia.json";
import { createApp } from "../src/app.ts";
import { EXAMPLE_WORLD } from "../src/example-world.ts";

const homes: string[] = [];
const apps: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

test("source review, sample revision and player overrides survive creation and settings edits", async () => {
  const home = mkdtempSync(join(tmpdir(), "wyrd-source-"));
  homes.push(home);
  const proposed = CreationReview.parse({
    subsystems: {
      survival: false,
      inventory: "abstract",
      weatherEffects: false,
      disease: false,
      lightingAndVision: false,
    },
    theme: null,
    resolution: "d20",
    hardcore: false,
    lethality: "gritty",
    companionDeath: false,
    startingLevel: 9,
    style: { source: "Cosmic adventure", playerWords: "", sample: "A green light wakes in your palm." },
  });
  const fake = new FakeProvider([
    {
      match: (r) => r.tools?.[0]?.name === "propose_lore",
      reply: { toolCall: { name: "propose_lore", args: { facts: ["Marsh lights lure travellers."] } } },
    },
    {
      match: (r) => r.tools?.[0]?.name === "propose_world",
      reply: { toolCall: { name: "propose_world", args: EXAMPLE_WORLD } },
    },
    {
      match: (r) => r.tools?.[0]?.name === "propose_source_bible",
      reply: {
        toolCall: {
          name: "propose_source_bible",
          args: offlineBible({
            worldName: "Lights",
            openingSite: EXAMPLE_WORLD.location.name,
            threat: false,
          }),
        },
      },
    },
    {
      match: (r) => r.tools?.[0]?.name === "propose_source_extras",
      reply: {
        toolCall: {
          name: "propose_source_extras",
          args: {
            abilities: [
              { id: "light", name: "Light", description: "Shape light", level: 9, cost: "Will", rank: 1 },
            ],
            characters: [
              {
                name: "Mina Vale",
                motivation: "Protect the station",
                action: "Inspects the relays",
                paceDays: 1,
              },
            ],
            canonEvents: [
              {
                name: "Relay opens",
                days: 2,
                subject: "Mina Vale",
                predicate: "relay",
                value: "open",
                interventionPredicate: "relayStopped",
              },
            ],
          },
        },
      },
    },
    {
      match: (r) => r.tools?.[0]?.name === "propose_creation_review",
      reply: { toolCall: { name: "propose_creation_review", args: proposed } },
    },
    {
      match: (r) => r.tools?.[0]?.name === "propose_style_sample",
      reply: {
        toolCall: {
          name: "propose_style_sample",
          args: { sample: "Rain on the window. The green light flickers." },
        },
      },
    },
  ]);
  const router = new RoleRouter({
    providers: { fake },
    routing: { worldGen: { provider: "fake", model: "test", fallbacks: [] } },
  });
  const app = createApp({
    home,
    offline: false,
    router,
    loreClient: {
      fetchPage: async () => ({
        title: "Wisp",
        text: Object.values(wikipedia.query.pages)[0]!.extract,
        url: "https://en.wikipedia.org/wiki/Will-o%27-the-wisp",
      }),
      search: async () => [],
    },
  });
  apps.push(app);
  let cookie = "";
  const req = (path: string, data?: unknown, method = data === undefined ? "GET" : "POST") =>
    app.app.request(`http://localhost/api${path}`, {
      method,
      headers: { Cookie: cookie, "X-Wyrd": "1", "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  cookie = (await req("/auth/setup", { passcode: "a long source test passcode" })).headers
    .get("set-cookie")!
    .split(";")[0]!;
  const response = await req("/world-drafts", {
    name: "Light",
    pitch: "Cosmic adventure inside a story",
    source: { title: "Wisp", wiki: "en.wikipedia.org" },
  });
  expect(response.status).toBe(201);
  const preview = GeneratedWorldPreview.parse(await response.json());
  expect(preview.review?.startingLevel).toBe(9);
  const revised = await req(`/world-drafts/${preview.id}/style`, {
    ...proposed.style,
    playerWords: "More like a tense thriller",
  });
  expect(revised.status).toBe(200);
  const review = CreationReview.parse(await revised.json());
  expect(review.style.sample).toContain("Rain");
  const override = {
    ...review,
    startingLevel: 12,
    resolution: "d100",
    hardcore: true,
    subsystems: { ...review.subsystems, survival: true },
  };
  expect((await req(`/world-drafts/${preview.id}/review`, override, "PUT")).status).toBe(200);
  const made = await req("/campaigns", {
    draftId: preview.id,
    ancestry: preview.origins[0]!.id,
    archetype: preview.backgrounds[0]!.id,
  });
  expect(made.status).toBe(201);
  const { id } = (await made.json()) as { id: string };
  const settings = CampaignSettingsView.parse(await (await req(`/campaigns/${id}/settings`)).json()).settings;
  expect(settings.structural.resolution).toBe("d100");
  expect(settings.structural.hardcore).toBe(true);
  expect(settings.subsystems.survival).toBe(true);
  expect(settings.style).toEqual(review.style);
  const view = GameView.parse(await (await req(`/campaigns/${id}/view`)).json());
  expect(view.pc.level).toBe(12);
  expect(view.pc.abilities[0]?.name).toBe("Light");
  expect(JSON.stringify(view)).not.toContain("relayStopped");
  const changed = await req(`/campaigns/${id}/settings`, { style: { playerWords: "Even terser" } }, "PATCH");
  expect(changed.status).toBe(200);
  expect(CampaignSettingsView.parse(await changed.json()).settings.style.playerWords).toBe("Even terser");
  expect((await req(`/world-drafts/${preview.id}/style`, review.style)).status).toBe(409);
  for (let day = 0; day < 9; day++)
    expect((await req(`/campaigns/${id}/downtime`, { action: { type: "recover" } })).status).toBe(200);
  app.close();
  apps.splice(apps.indexOf(app), 1);
  const game = CampaignStore.open<GameState>(join(home, "campaigns", id, "campaign.db"), { reduce });
  try {
    const before = game.state();
    game.rebuild();
    expect(game.state()).toEqual(before);
    expect(Object.values(game.state().clocks).filter((c) => c.kind === "canon")).toHaveLength(1);
    expect(game.state().worlds[0]?.source).toBe("Wisp");
    expect(Object.keys(game.state().flags.canonResults as object)).toHaveLength(1);
    expect(Object.keys(game.state().flags.canonActors as object).length).toBeGreaterThan(1);
    expect(JSON.stringify(game.state().flags.loreRecords)).toContain("wikipedia.org");
    expect(
      game
        .events()
        .filter((e) => e.type === "FactAsserted")
        .some((e) => e.payload.fact.source === "lore"),
    ).toBe(true);
  } finally {
    game.close();
  }
});

import { expect, test } from "bun:test";
import { CampaignSettings, CreationReview, WorldPitch } from "@wyrd/core";
import { EXAMPLE_WORLD } from "../../../apps/server/src/example-world.ts";
import { FakeProvider } from "../src/fake.ts";
import { MediaWikiClient } from "../src/lore/mediawiki.ts";
import { LoreResearch } from "../src/lore/research.ts";
import { offlineBible } from "../src/offline-world.ts";
import { gmInstructions, HOUSE_STYLE } from "../src/prompts/gm.ts";
import { RoleRouter } from "../src/router.ts";
import { generateCreationReview, generateStyleSample, researchSource } from "../src/source-creation.ts";
import wikipedia from "./fixtures/lore/wikipedia.json";

const input = WorldPitch.parse({
  name: "Wisp",
  pitch: "An adventure in the marsh",
  source: { title: "Will-o'-the-wisp", wiki: "en.wikipedia.org" },
});
const routerFor = (fake: FakeProvider) =>
  new RoleRouter({
    providers: { fake },
    routing: { worldGen: { provider: "fake", model: "test", fallbacks: [] } },
  });

test("source creation reuses recorded-wiki research, then builds the bible, powers and timeline", async () => {
  const fake = new FakeProvider([
    {
      match: (r) => r.tools?.[0]?.name === "propose_lore",
      reply: {
        toolCall: {
          name: "propose_lore",
          args: { facts: ["Marsh lights lure travellers away from paths."] },
        },
      },
    },
    {
      match: (r) => r.tools?.[0]?.name === "propose_source",
      reply: {
        toolCall: {
          name: "propose_source",
          args: {
            proposal: EXAMPLE_WORLD,
            bible: offlineBible({ worldName: "Wisp", openingSite: "Marsh", threat: false }),
            abilities: [
              {
                id: "wisp-light",
                name: "Marsh light",
                description: "Shape a small light",
                level: 1,
                cost: "Concentration",
                rank: 1,
              },
            ],
            characters: [
              {
                name: "Watcher",
                motivation: "Keep travellers safe",
                action: "Marks safe paths",
                paceDays: 1,
              },
            ],
            canonEvents: [
              {
                name: "The lights rise",
                days: 2,
                subject: "Marsh",
                predicate: "lights",
                value: "risen",
                interventionPredicate: "lightsStopped",
              },
            ],
          },
        },
      },
    },
  ]);
  const router = routerFor(fake);
  const lore = new LoreResearch({
    router,
    cache: { get: () => null, put: () => {} },
    client: new MediaWikiClient({ fetch: async () => Response.json(wikipedia) }),
  });
  const result = await researchSource(router, input, lore);
  expect(result.abilities[0]?.name).toBe("Marsh light");
  expect(result.research.confidence).toBe("high");
  expect(result.research.evidence?.quote).toContain("wikipedia.org");
  expect(fake.calls()[1]!.messages[0]!.content).toContain("Marsh lights lure");
  expect(fake.calls()[1]!.instructions).toContain("greatest hits");
});

test("GM proposes survival on for apocalypse and off for cosmic settings", async () => {
  for (const survival of [true, false]) {
    const settings = CampaignSettings.parse({
      subsystems: {
        survival,
        weatherEffects: survival,
        disease: survival,
        lightingAndVision: survival,
        inventory: survival ? "weight" : "abstract",
      },
    });
    const proposed = CreationReview.parse({
      subsystems: settings.subsystems,
      theme: null,
      resolution: "d20",
      hardcore: survival,
      lethality: "gritty",
      companionDeath: false,
      startingLevel: survival ? 1 : 9,
      style: {
        source: "Direct, vivid adventure",
        playerWords: "",
        sample: "The door opens. Someone is waiting.",
      },
    });
    const fake = new FakeProvider([
      { reply: { toolCall: { name: "propose_creation_review", args: proposed } } },
    ]);
    const review = await generateCreationReview(
      routerFor(fake),
      { ...input, pitch: survival ? "A ruined apocalypse" : "A rookie Lantern in cosmic DC" },
      EXAMPLE_WORLD,
    );
    expect(review.subsystems.survival).toBe(survival);
    expect(review.startingLevel).toBe(survival ? 1 : 9);
    expect(fake.calls()[0]!.instructions).toContain(HOUSE_STYLE);
  }
});

test("sample revision preserves player's words and enters the GM instructions", async () => {
  const fake = new FakeProvider([
    {
      reply: {
        toolCall: {
          name: "propose_style_sample",
          args: { sample: "Rain needles the window. Your ring wakes." },
        },
      },
    },
  ]);
  const style = await generateStyleSample(routerFor(fake), input.pitch, {
    source: "Cosmic adventure",
    playerWords: "More like a tense thriller",
    sample: "Old sample",
  });
  const settings = CampaignSettings.parse({ style });
  const instructions = gmInstructions({ policy: "gm", length: "normal", style: settings.style });
  expect(instructions).toContain("More like a tense thriller");
  expect(instructions).toContain(style.sample);
  expect(style.playerWords).toBe("More like a tense thriller");
});

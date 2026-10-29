import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../apps/server/src/app.ts";
import { EXAMPLE_WORLD } from "../apps/server/src/example-world.ts";
import { webAssets } from "../apps/server/src/web.ts";
import { type ChatProvider, FakeProvider, offlineProvider, RoleRouter } from "../packages/llm/src/index.ts";
import wikipedia from "../packages/llm/test/fixtures/lore/wikipedia.json";
import { SOURCE_FIXTURE, SOURCE_REVIEW } from "./source-fixture.ts";

const offline = offlineProvider();
const cases = new FakeProvider([
  {
    role: "worldGen",
    match: (r) => r.tools?.[0]?.name === "propose_lore",
    reply: {
      toolCall: { name: "propose_lore", args: { facts: ["Marsh lights guide travellers away from paths."] } },
    },
  },
  // Source worlds are three calls (D154): the opening world falls through to propose_world below.
  {
    role: "worldGen",
    match: (r) => r.tools?.[0]?.name === "propose_source_bible",
    reply: { toolCall: { name: "propose_source_bible", args: SOURCE_FIXTURE.bible } },
  },
  {
    role: "worldGen",
    match: (r) => r.tools?.[0]?.name === "propose_source_extras",
    reply: {
      toolCall: {
        name: "propose_source_extras",
        args: {
          abilities: SOURCE_FIXTURE.abilities,
          characters: SOURCE_FIXTURE.characters,
          canonEvents: SOURCE_FIXTURE.canonEvents,
        },
      },
    },
  },
  {
    role: "worldGen",
    match: (r) =>
      r.tools?.[0]?.name === "propose_creation_review" &&
      r.messages.some((m) => m.content.includes("source workflow")),
    reply: { toolCall: { name: "propose_creation_review", args: SOURCE_REVIEW } },
  },
  {
    role: "worldGen",
    match: (r) =>
      r.tools?.[0]?.name === "propose_style_sample" &&
      r.messages.some((m) => m.content.includes("make the provider fail")),
    reply: {
      error: {
        code: "server",
        retryable: false,
        message: "The story model is unavailable.",
      },
    },
  },
  {
    role: "worldGen",
    match: (r) => r.tools?.[0]?.name === "propose_style_sample",
    reply: {
      toolCall: {
        name: "propose_style_sample",
        args: { sample: "Rain needles the window. Your green light flickers." },
      },
    },
  },
  {
    role: "narrator",
    match: (r) => r.messages.some((m) => m.content.includes("readability check")),
    reply: {
      text: 'Mina Vale waits at Relay Nine. She points to **the sealed hatch**. <say who="Mina Vale">Check **the inspection desk**.</say> <say who="npc:person-2">I can hear you.</say>',
    },
  },
  { role: "worldGen", reply: { toolCall: { name: "propose_world", args: EXAMPLE_WORLD } } },
  {
    role: "parser",
    reply: {
      toolCall: {
        name: "ask_clarification",
        args: {
          question: "Where would you like to look?",
          options: [
            { label: "Look around the room", actions: [{ type: "examine", area: "the room" }] },
            { label: "Wait a moment", actions: [{ type: "wait", minutes: 1 }] },
          ],
        },
      },
    },
  },
  { role: "narrator", reply: { text: "A crown materializes in your pack." } },
  {
    role: "guard",
    reply: {
      toolCall: {
        name: "report_canon",
        args: {
          stateClaims: [
            { quote: "A crown materializes in your pack.", claim: "The engine did not grant an item." },
          ],
        },
      },
    },
  },
]);
// Levels UI fixture: all other GM calls fail into the existing classic offline path.
const levelModel = new FakeProvider([
  {
    role: "gm",
    match: (r) => r.messages.some((m) => m.role === "user" && m.content.includes("level workflow")),
    reply: (r) => {
      const count = r.messages.filter((m) => m.role === "tool").length;
      if (count === 0)
        return {
          toolCall: {
            name: "grant_ability",
            args: {
              ability: {
                id: "marshfire",
                name: "Marshfire",
                description: "A pale guiding flame.",
                level: 1,
                rank: 3,
                cost: "Once per scene",
              },
            },
          },
        };
      if (count === 1)
        return {
          toolCall: {
            name: "propose_level_up",
            args: { level: 2, reason: "You completed the first journey." },
          },
        };
      return { text: "The first journey is complete. Your next level awaits your choice." };
    },
  },
]);
const provider: ChatProvider = {
  id: "offline",
  kind: "fake",
  listModels: () => offline.listModels(),
  generate: (request) => {
    if (request.role === "gm") return levelModel.generate(request);
    const input = request.messages[0];
    const context = input?.role === "user" ? input.content : "";
    const current = /## This turn\n\n(?:[\s\S]*?\n)?Player: (.*)/.exec(context)?.[1] ?? "";
    const special =
      request.role === "worldGen" ||
      (request.role === "parser"
        ? current === "ambiguous request"
        : current === "force a canon flag" ||
          (request.role === "narrator" && context.includes("readability check")));
    return (special ? cases : offline).generate(request);
  },
};
const router = new RoleRouter({
  usage: { record: (r) => instance.store.recordUsage(r) },
  providers: { offline: provider },
  routing: Object.fromEntries(
    ["parser", "narrator", "guard", "worldGen", "gm"].map((role) => [
      role,
      { provider: "offline", model: "offline", fallbacks: [] },
    ]),
  ),
});
const home = mkdtempSync(join(tmpdir(), "wyrd-e2e-"));
const instance = createApp({
  home,
  offline: true,
  router,
  seed: "e2e-combat",
  loreClient: {
    fetchPage: async () => ({
      title: "Will-o'-the-wisp",
      text: Object.values(wikipedia.query.pages)[0]!.extract,
      url: "https://en.wikipedia.org/wiki/Will-o%27-the-wisp",
    }),
    search: async () => [],
  },
});
instance.app.use("/*", webAssets(resolve("apps/web/dist")));
// A second checkout (worktree, parallel agent) can pick its own port.
const port = Number(process.env.WYRD_E2E_PORT ?? 4789);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: (req, server) =>
    instance.app.fetch(req, { remoteAddress: server.requestIP(req)?.address ?? "unknown" }),
});
process.on("SIGTERM", async () => {
  await server.stop(true);
  await instance.idle();
  instance.close();
  process.exit(0);
});
console.log(`Isolated offline browser tests: ${server.url}`);

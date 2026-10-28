import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../apps/server/src/app.ts";
import { EXAMPLE_WORLD } from "../apps/server/src/example-world.ts";
import { webAssets } from "../apps/server/src/web.ts";
import { type ChatProvider, FakeProvider, offlineProvider, RoleRouter } from "../packages/llm/src/index.ts";

const offline = offlineProvider();
const cases = new FakeProvider([
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
const provider: ChatProvider = {
  id: "offline",
  kind: "fake",
  listModels: () => offline.listModels(),
  generate: (request) => {
    const input = request.messages[0];
    const context = input?.role === "user" ? input.content : "";
    const current = /## This turn\n\nPlayer: (.*)/.exec(context)?.[1] ?? "";
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
    ["parser", "narrator", "guard", "worldGen"].map((role) => [
      role,
      { provider: "offline", model: "offline", fallbacks: [] },
    ]),
  ),
});
const home = mkdtempSync(join(tmpdir(), "wyrd-e2e-"));
const instance = createApp({ home, offline: true, router, seed: "e2e-combat" });
instance.app.use("/*", webAssets(resolve("apps/web/dist")));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4789,
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

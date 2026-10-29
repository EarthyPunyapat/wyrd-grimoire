import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CampaignImport, GameView, GeneratedWorldPreview } from "@wyrd/core";
import { FakeProvider, RoleRouter } from "@wyrd/llm";
import { createApp } from "../src/app.ts";
import { EXAMPLE_WORLD } from "../src/example-world.ts";

const homes: string[] = [];
const apps: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

const SHARE = "https://chatgpt.com/share/6ae2f007-c2bc-83ec-a136-51fcc6381dce";
const page = () => {
  // The smallest real-shaped share page: a turbo-stream array holding one user turn.
  const arr = [
    { _1: 2 },
    "share",
    { _3: 4, _5: 6 },
    "title",
    "First Light",
    "linear_conversation",
    [7],
    { _8: 9 },
    "message",
    { _10: 11, _12: 13 },
    "author",
    { _14: 15 },
    "content",
    { _16: 17, _18: 19 },
    "role",
    "user",
    "content_type",
    "text",
    "parts",
    [20],
    `Continue my campaign. ${"Ari keeps watch over the Crownfold. ".repeat(10)}`,
  ];
  return `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(JSON.stringify(arr))});</script>`;
};
const drafted = CampaignImport.parse({
  pc: {
    name: "Ethan Hunt",
    level: "infinite",
    backstory: "An engineer from Coast City who became the Absolute Sovereign.",
    abilities: [{ name: "Hard-light constructs", description: "Shapes will into matter", rank: 10 }],
    gear: [{ name: "AXIOM PRIME", description: "A self-forged Source ring" }],
  },
  companions: [
    {
      name: "Ari",
      summary: "The ring AI, now his right hand",
      voice: "Formal and warm; calls him Master",
      level: 20,
    },
  ],
  history: [{ subject: "Vale", fact: "Ethan's successor, training alone on Oa" }],
});

async function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-import-"));
  homes.push(home);
  const fake = new FakeProvider([
    {
      match: (r) => r.tools?.[0]?.name === "propose_import",
      reply: { toolCall: { name: "propose_import", args: drafted } },
    },
    {
      match: (r) => r.tools?.[0]?.name === "propose_world",
      reply: { toolCall: { name: "propose_world", args: EXAMPLE_WORLD } },
    },
    { reply: { error: { code: "invalid_output", retryable: false } } },
  ]);
  const router = new RoleRouter({
    providers: { fake },
    routing: { worldGen: { provider: "fake", model: "test", fallbacks: [] } },
  });
  const fetched: string[] = [];
  const app = createApp({
    home,
    offline: false,
    router,
    shareFetch: (async (url: string) => {
      fetched.push(String(url));
      return new Response(page());
    }) as unknown as typeof fetch,
  });
  apps.push(app);
  let cookie = "";
  const req = (path: string, data?: unknown) =>
    app.app.request(`http://localhost/api${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, "X-Wyrd": "1", "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  cookie = (await req("/auth/setup", { passcode: "a long import test passcode" })).headers
    .get("set-cookie")!
    .split(";")[0]!;
  return { req, fake, fetched };
}

test("share links are read and drafted for review", async () => {
  const { req, fake, fetched } = await setup();
  const res = await req("/import/chatgpt", { urls: [SHARE], exclude: ["Reverend Insanity"] });
  expect(res.status).toBe(200);
  const draft = CampaignImport.parse(await res.json());
  expect(draft.pc.name).toBe("Ethan Hunt");
  expect(fetched).toEqual([SHARE]);
  expect(fake.calls("worldGen")[0]!.messages[0]!.content).toContain("Ari keeps watch");
});

test("only ChatGPT share links are fetched", async () => {
  const { req, fetched } = await setup();
  const res = await req("/import/chatgpt", {
    urls: ["https://evil.example/share/6ae2f007-c2bc-83ec-a136-51fcc6381dce"],
  });
  expect(res.status).toBe(422);
  expect(fetched).toEqual([]);
});

test("a reviewed import becomes the campaign's character, companions and history", async () => {
  const { req } = await setup();
  const preview = GeneratedWorldPreview.parse(
    await (await req("/world-drafts", { name: "First Light", pitch: "A ring in Coast City" })).json(),
  );
  const made = await req("/campaigns", {
    draftId: preview.id,
    ancestry: preview.origins[0]!.id,
    archetype: preview.backgrounds[0]!.id,
    import: drafted,
  });
  expect(made.status).toBe(201);
  const { id } = (await made.json()) as { id: string };
  const view = GameView.parse(await (await req(`/campaigns/${id}/view`)).json());
  expect(view.pc.identity.name).toBe("Ethan Hunt");
  expect(view.pc.level).toBe("infinite");
  expect(view.pc.abilities.map((a) => a.name)).toContain("Hard-light constructs");
  expect(view.inventory.items.map((i) => i.name)).toContain("AXIOM PRIME");
  expect(view.companions).toEqual([
    expect.objectContaining({ name: "Ari", loyal: true, voiceProfile: "Formal and warm; calls him Master" }),
  ]);
});

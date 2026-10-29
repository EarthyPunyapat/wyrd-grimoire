import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DraftCard, DraftResume, GameView, GeneratedWorldPreview } from "@wyrd/core";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

async function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-home-"));
  homes.push(home);
  const server = createApp({ home, offline: true, seed: "home" });
  servers.push(server);
  const call = (path: string, cookie: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
    server.app.request(`http://localhost/api${path}`, {
      method,
      headers: { Cookie: cookie, "X-Wyrd": "1", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const auth = await call("/auth/setup", "", { passcode: "a long home test passcode" });
  const cookie = auth.headers.get("set-cookie")!.split(";")[0]!;
  return {
    home,
    server,
    call: async (path: string, body?: unknown, method?: string) => call(path, cookie, body, method),
  };
}

async function startCampaign(
  call: (path: string, body?: unknown, method?: string) => Promise<Response>,
  name: string,
) {
  const draft = GeneratedWorldPreview.parse(
    await (await call("/world-drafts", { name, pitch: "A quiet station mystery in the dark." })).json(),
  );
  const started = await call("/campaigns", {
    draftId: draft.id,
    ancestry: draft.origins[0]!.id,
    archetype: draft.backgrounds[0]!.id,
  });
  expect(started.status).toBe(201);
  return { id: ((await started.json()) as { id: string }).id, draftId: draft.id };
}

test("a campaign can be renamed; the card and the played campaign agree", async () => {
  const { call } = await setup();
  const { id } = await startCampaign(call, "Old Name");
  const renamed = await call(`/campaigns/${id}`, { name: "  The Long Night  " }, "PATCH");
  expect(renamed.status).toBe(200);
  expect((await renamed.json()).name).toBe("The Long Night");
  const cards = (await (await call("/campaigns")).json()) as { id: string; name: string }[];
  expect(cards.find((c) => c.id === id)?.name).toBe("The Long Night");
  const view = GameView.parse(await (await call(`/campaigns/${id}/view`)).json());
  expect(view.name).toBe("The Long Night");
  expect((await call(`/campaigns/${id}`, { name: "" }, "PATCH")).status).toBe(422);
});

test("archiving hides a campaign from the active list without closing it", async () => {
  const { call } = await setup();
  const { id } = await startCampaign(call, "Paused Tale");
  const archived = await call(`/campaigns/${id}`, { archived: true }, "PATCH");
  expect(archived.status).toBe(200);
  expect((await archived.json()).archived).toBe(true);
  const cards = (await (await call("/campaigns")).json()) as { id: string; archived: boolean }[];
  expect(cards.find((c) => c.id === id)?.archived).toBe(true);
  // Archiving is not deletion: the campaign still opens and plays.
  expect((await call(`/campaigns/${id}/view`)).status).toBe(200);
  const restored = await call(`/campaigns/${id}`, { archived: false }, "PATCH");
  expect((await restored.json()).archived).toBe(false);
});

test("the draft library lists unfinished worlds and resumes them; started drafts leave it", async () => {
  const { call } = await setup();
  const draft = GeneratedWorldPreview.parse(
    await (
      await call("/world-drafts", {
        name: "Library Tale",
        characterName: "Wren",
        pitch: "A drowned city and the people still living in it.",
      })
    ).json(),
  );
  let cards = DraftCard.array().parse(await (await call("/world-drafts")).json());
  const listed = cards.find((c) => c.id === draft.id);
  expect(listed?.name).toBe("Library Tale");
  expect(listed?.characterName).toBe("Wren");
  expect(listed?.worldName).toBe(draft.worldName);
  expect(listed?.pitch).toContain("drowned city");

  const resumed = DraftResume.parse(await (await call(`/world-drafts/${draft.id}`)).json());
  expect(resumed.preview.id).toBe(draft.id);
  expect(resumed.preview.name).toBe("Library Tale");
  expect(resumed.hasSheet).toBe(false);

  await startCampaignFrom(call, draft);
  cards = DraftCard.array().parse(await (await call("/world-drafts")).json());
  expect(cards.map((c) => c.id)).not.toContain(draft.id);
  expect((await call(`/world-drafts/${draft.id}`)).status).toBe(404);
});

test("an abandoned draft can be discarded from the library", async () => {
  const { call } = await setup();
  const draft = GeneratedWorldPreview.parse(
    await (await call("/world-drafts", { name: "Discard Me", pitch: "A story I will not start." })).json(),
  );
  expect((await call(`/world-drafts/${draft.id}`, undefined, "DELETE")).status).toBe(204);
  const cards = DraftCard.array().parse(await (await call("/world-drafts")).json());
  expect(cards.map((c) => c.id)).not.toContain(draft.id);
});

async function startCampaignFrom(
  call: (path: string, body?: unknown, method?: string) => Promise<Response>,
  draft: GeneratedWorldPreview,
) {
  const started = await call("/campaigns", {
    draftId: draft.id,
    ancestry: draft.origins[0]!.id,
    archetype: draft.backgrounds[0]!.id,
  });
  expect(started.status).toBe(201);
}

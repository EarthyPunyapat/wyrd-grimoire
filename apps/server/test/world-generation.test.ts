import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameView, GeneratedWorldPreview } from "@wyrd/core";
import { FakeProvider, RoleRouter } from "@wyrd/llm";
import { createApp } from "../src/app.ts";
import { EXAMPLE_WORLD } from "../src/example-world.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
const request = (server: ReturnType<typeof createApp>, path: string, cookie: string, body?: unknown) =>
  server.app.request(`http://localhost/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Cookie: cookie, "X-Wyrd": "1", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function setup(proposal: unknown = EXAMPLE_WORLD) {
  const home = mkdtempSync(join(tmpdir(), "wyrd-generation-"));
  homes.push(home);
  const provider = new FakeProvider([
    { role: "worldGen", reply: { toolCall: { name: "propose_world", args: proposal } } },
  ]);
  const router = new RoleRouter({
    providers: { fake: provider },
    routing: { worldGen: { provider: "fake", model: "test", fallbacks: [] } },
  });
  const server = createApp({ home, offline: false, router });
  servers.push(server);
  const response = await request(server, "/auth/setup", "", { passcode: "a long generation test passcode" });
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  return { server, cookie, home, router };
}

test("pitch generates reviewed options, persists a draft across restart and starts a frozen non-fantasy campaign once", async () => {
  const { server, cookie, home, router } = await setup();
  expect(
    (await request(server, "/world-drafts", "", { name: "Test", pitch: "A space mystery" })).status,
  ).toBe(401);
  const response = await request(server, "/world-drafts", cookie, {
    name: "My station mystery",
    pitch: "Hard sci-fi with a human crew and no magic",
  });
  expect(response.status).toBe(201);
  const previewText = await response.text();
  expect(previewText).not.toContain(EXAMPLE_WORLD.location.people[0]!.secret!);
  expect(JSON.parse(previewText)).not.toHaveProperty("people");
  const preview = GeneratedWorldPreview.parse(JSON.parse(previewText));
  expect(preview.offline).toBe(false);
  expect(preview.origins.map((o) => o.name)).toEqual(["Station-born", "Earthside"]);
  server.close();
  servers.splice(servers.indexOf(server), 1);
  const restarted = createApp({ home, offline: false, router });
  servers.push(restarted);
  const input = {
    draftId: preview.id,
    characterName: "",
    ancestry: preview.origins[0]!.id,
    archetype: preview.backgrounds[0]!.id,
  };
  expect(
    (await request(restarted, "/campaigns", cookie, { ...input, ancestry: "fantasy-core:elf" })).status,
  ).toBe(422);
  const made = await request(restarted, "/campaigns", cookie, input);
  expect(made.status).toBe(201);
  const { id } = (await made.json()) as { id: string };
  expect(await (await request(restarted, "/campaigns", cookie, input)).json()).toEqual({ id });
  expect(restarted.store.campaigns()).toHaveLength(1);
  const viewText = await (await request(restarted, `/campaigns/${id}/view`, cookie)).text();
  expect(viewText).not.toContain(EXAMPLE_WORLD.location.people[0]!.secret!);
  expect(viewText).not.toContain("Ashford");
  const view = GameView.parse(JSON.parse(viewText));
  expect(view.pc.identity.name).toBe("Alex Chen");
  expect(view.originName).toBe("Station-born");
  expect(view.backgroundName).toBe("Systems technician");
  expect(view.scene?.present.map((p) => p.name)).toEqual(["Mina Vale"]);
  expect(view.opening).toBe(EXAMPLE_WORLD.location.opening);
  expect(Object.values(view.pc.attributes).reduce((a, b) => a + b, 0)).toBe(39);
});

test("different generated genres are preserved, with no forced fantasy ancestry or build", async () => {
  const proposal = structuredClone(EXAMPLE_WORLD);
  proposal.worldName = "The Last Witness";
  proposal.premise = "A contemporary human-only crime story in a rain-soaked coastal city.";
  proposal.originLabel = "Origin";
  proposal.origins = [{ name: "Human", description: "An ordinary person in the present day." }];
  proposal.backgrounds[0]!.name = "Private investigator";
  const { server, cookie } = await setup(proposal);
  const made = await request(server, "/world-drafts", cookie, {
    name: "Case One",
    characterName: "Morgan",
    pitch: "A modern detective thriller without magic",
  });
  const preview = GeneratedWorldPreview.parse(await made.json());
  expect(preview.worldName).toBe("The Last Witness");
  expect(preview.origins).toHaveLength(1);
  expect(preview.origins[0]!.name).toBe("Human");
  expect(preview.backgrounds[0]!.name).toBe("Private investigator");
});

test("invalid proposals cannot create canon and failure allows a subsequent generation attempt", async () => {
  for (const change of [
    (p: typeof EXAMPLE_WORLD) => {
      p.backgrounds[0]!.skills[0] = "core:hacking";
    },
    (p: typeof EXAMPLE_WORLD) => {
      p.backgrounds[0]!.attributePriority.fill("str");
    },
    (p: typeof EXAMPLE_WORLD) => {
      p.location.people[0]!.zone = 4;
    },
  ]) {
    const proposal = structuredClone(EXAMPLE_WORLD);
    change(proposal);
    const { server, cookie } = await setup(proposal);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        (await request(server, "/world-drafts", cookie, { name: "Bad proposal", pitch: "A detective story" }))
          .status,
      ).toBe(502);
    }
    expect(server.store.campaigns()).toHaveLength(0);
  }
});

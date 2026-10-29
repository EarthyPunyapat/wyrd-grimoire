import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreationView, GameView, GeneratedWorldPreview } from "@wyrd/core";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

async function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-creation-"));
  homes.push(home);
  const server = createApp({ home, offline: true, seed: "creation" });
  servers.push(server);
  const call = (path: string, cookie: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
    server.app.request(`http://localhost/api${path}`, {
      method,
      headers: { Cookie: cookie, "X-Wyrd": "1", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const auth = await call("/auth/setup", "", { passcode: "a long creation test passcode" });
  const cookie = auth.headers.get("set-cookie")!.split(";")[0]!;
  return { call: (path: string, body?: unknown, method?: string) => call(path, cookie, body, method) };
}

test("the sheet editor validates every edit and the campaign starts from the edited sheet", async () => {
  const { call } = await setup();
  const world = GeneratedWorldPreview.parse(
    await (await call("/world-drafts", { name: "Edited", pitch: "A station mystery" })).json(),
  );
  const opened = CreationView.parse(await (await call(`/world-drafts/${world.id}/creation`)).json());
  expect(opened.draft.name).toBe(world.suggestedCharacterName);
  expect(opened.issues.filter((i) => i.severity === "error")).toEqual([]);
  expect(opened.options.archetypes.length).toBe(world.backgrounds.length);

  // Overspend an attribute: the editor saves the draft and names the broken rule.
  const strong = { ...opened.draft, attributes: { ...opened.draft.attributes, str: 9 } };
  const broken = CreationView.parse(
    await (await call(`/world-drafts/${world.id}/sheet`, strong, "PUT")).json(),
  );
  expect(broken.issues.map((i) => i.code)).toContain("ATTR_ABOVE_MAX");
  const refused = await call("/campaigns", { draftId: world.id });
  expect(refused.status).toBe(422);
  expect((await refused.json()).error).toContain("above the creation max");

  // A valid edit: rename, add looks and a backstory, then start.
  const edited = {
    ...opened.draft,
    name: "Ines Varga",
    pronouns: "she/her",
    appearance: { build: "wiry", marks: ["a burn on one wrist"] },
    backstory: "A reactor tech who stayed when everyone else evacuated.",
  };
  const saved = CreationView.parse(
    await (await call(`/world-drafts/${world.id}/sheet`, edited, "PUT")).json(),
  );
  expect(saved.issues.filter((i) => i.severity === "error")).toEqual([]);
  expect(saved.preview.identity.appearance.marks).toEqual(["a burn on one wrist"]);
  const started = await call("/campaigns", { draftId: world.id });
  expect(started.status).toBe(201);
  const { id } = (await started.json()) as { id: string };
  const view = GameView.parse(await (await call(`/campaigns/${id}/view`)).json());
  expect(view.pc.identity.name).toBe("Ines Varga");
  expect(view.pc.identity.backstory).toContain("reactor tech");
  // The draft is closed once the campaign exists.
  expect((await call(`/world-drafts/${world.id}/sheet`, edited, "PUT")).status).toBe(409);
});

test("quick start can begin with a pack pregen, keeping its person and the archetype's kit", async () => {
  const { call } = await setup();
  const started = await call("/campaigns/quick-start", { name: "Pregen", pregen: "sefa" });
  expect(started.status).toBe(201);
  const { id } = (await started.json()) as { id: string };
  const view = GameView.parse(await (await call(`/campaigns/${id}/view`)).json());
  expect(view.pc.identity.name).toBe("Sefa Lindqvist");
  expect(view.pc.talents).toEqual(["fantasy-core:hedge-lore", "fantasy-core:iron-will"]);
  expect(view.pc.equipment.carried.map((c) => c.item)).toContain("fantasy-core:healers-kit");
  expect((await call("/campaigns/quick-start", { name: "Nobody", pregen: "nobody" })).status).toBe(422);
});

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexView, CreationView, GameView, GeneratedWorldPreview, InterviewView } from "@wyrd/core";
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

test("session zero interviews, fills the sheet as answers arrive, and its hooks are placed in the world", async () => {
  const { call } = await setup();
  const world = GeneratedWorldPreview.parse(
    await (await call("/world-drafts", { name: "Interview", pitch: "A station mystery" })).json(),
  );
  let view = InterviewView.parse(await (await call(`/world-drafts/${world.id}/interview`, {})).json());
  expect(view.interview.offline).toBe(true);
  expect(view.interview.messages.at(-1)!.text).toContain("who is your character");
  const answers = [
    "A tired engineer who keeps the reactor running.",
    "Born on the station, never been planetside.",
    "Fixing things nobody else can.",
    "To find out why the relay went dark.",
    "My sister, Juno Reyes, who runs the docks.",
    "Director Hale, who blames me for the accident.",
    "I owe the Quartermaster for my transfer papers.",
    "A burn scar across my left hand.",
  ];
  for (const answer of answers) {
    view = InterviewView.parse(await (await call(`/world-drafts/${world.id}/interview`, { answer })).json());
  }
  expect(view.interview.done).toBe(true);
  const draft = view.creation.draft;
  expect(draft.hooks.map((h) => [h.kind, h.name])).toEqual([
    ["bond", "Juno Reyes"],
    ["rival", "Director Hale"],
    ["debt", "Quartermaster"],
  ]);
  expect(draft.appearance.marks).toEqual(["A burn scar across my left hand."]);
  expect(draft.backstory).toContain("reactor");
  expect(view.creation.issues.filter((i) => i.severity === "error")).toEqual([]);

  const started = await call("/campaigns", { draftId: world.id });
  expect(started.status).toBe(201);
  const { id } = (await started.json()) as { id: string };
  const game = GameView.parse(await (await call(`/campaigns/${id}/view`)).json());
  expect(game.pc.identity.hookIds).toHaveLength(3);
  const codex = CodexView.parse(await (await call(`/campaigns/${id}/codex`)).json());
  const juno = codex.entries.find((e) => e.name === "Juno Reyes")!;
  expect(juno).toBeDefined();
  const journal = await (await call(`/campaigns/${id}/journal`)).text();
  expect(journal).toContain("What you owe Quartermaster");
  // People from the past are placed at a site of the wider world, away from the start.
  const map = await (await call(`/campaigns/${id}/map`)).json();
  expect(map.sites.length).toBeGreaterThan(1);
});

test("the wizard's suggest buttons fill one field through the engine", async () => {
  const { call } = await setup();
  const world = GeneratedWorldPreview.parse(
    await (await call("/world-drafts", { name: "Suggest", pitch: "A station mystery" })).json(),
  );
  const before = CreationView.parse(await (await call(`/world-drafts/${world.id}/creation`)).json());
  const named = CreationView.parse(
    await (await call(`/world-drafts/${world.id}/suggest`, { field: "name" })).json(),
  );
  expect(named.draft.name).not.toBe(before.draft.name);
  const hooked = CreationView.parse(
    await (await call(`/world-drafts/${world.id}/suggest`, { field: "hooks" })).json(),
  );
  expect(hooked.draft.hooks).toHaveLength(1);
  expect(hooked.draft.attributes).toEqual(before.draft.attributes);
});

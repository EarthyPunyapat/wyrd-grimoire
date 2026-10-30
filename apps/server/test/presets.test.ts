import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { WorldSetup } from "@wyrd/core";
import { createApp } from "../src/app.ts";
import { EXAMPLE_WORLD } from "../src/example-world.ts";
import { WORLD_STARTERS } from "../src/world-starters.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0).reverse()) f();
});
async function setup(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  const home = mkdtempSync("/tmp/wyrd-presets-");
  const app = createApp({ home, offline: true, ...options });
  cleanups.push(
    () => rmSync(home, { recursive: true, force: true }),
    () => app.close(),
  );
  let cookie = "";
  const req = (path: string, data?: unknown, method = data === undefined ? "GET" : "POST") =>
    app.app.request(`http://localhost/api${path}`, {
      method,
      headers: { Cookie: cookie, "X-Wyrd": "1", "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  cookie = (await req("/auth/setup", { passcode: "a long presets test passcode" })).headers
    .get("set-cookie")!
    .split(";")[0]!;
  return { req, home };
}

test("eight original starters validate and include bundled art", () => {
  expect(WORLD_STARTERS).toHaveLength(8);
  for (const s of WORLD_STARTERS) {
    expect(WorldSetup.parse(s).builtin).toBe(true);
    expect(s.art).toBeTruthy();
    if (s.art) expect(existsSync(join(import.meta.dir, "../../web/public", s.art))).toBe(true);
  }
});
test("setup CRUD returns fresh records; built-ins are immutable", async () => {
  const { req } = await setup();
  const made = await req("/world-setups", {
    name: "My stars",
    pitch: "You travel between forgotten stars.",
    rules: { resolution: "d20" },
  });
  expect(made.status).toBe(201);
  const own = WorldSetup.parse(await made.json());
  expect(own.updatedAt).toBeTruthy();
  const all = (await (await req("/world-setups")).json()) as WorldSetup[];
  expect(all.slice(0, 8).every((s) => s.builtin)).toBe(true);
  expect(all[8]!.id).toBe(own.id);
  const changed = WorldSetup.parse(
    await (await req(`/world-setups/${own.id}`, { name: "Fresh stars" }, "PATCH")).json(),
  );
  expect(changed.name).toBe("Fresh stars");
  expect(((await (await req("/world-setups")).json()) as WorldSetup[])[8]).toEqual(changed);
  for (const method of ["PATCH", "DELETE"]) {
    const res = await req(
      "/world-setups/dc-superhero",
      method === "PATCH" ? { name: "bad" } : undefined,
      method,
    );
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Built-in setups can't be changed; duplicate it");
  }
  expect((await req(`/world-setups/${own.id}`, undefined, "DELETE")).status).toBe(200);
});
test("saving a campaign setup copies pitch and rules", async () => {
  const { req } = await setup();
  const preview = (await (
    await req("/world-drafts", { name: "Space", pitch: "You sail between broken stars." })
  ).json()) as { id: string; origins: { id: string }[]; backgrounds: { id: string }[] };
  const made = await req("/campaigns", {
    draftId: preview.id,
    ancestry: preview.origins[0]!.id,
    archetype: preview.backgrounds[0]!.id,
    resolution: "d20",
  });
  expect(made.status).toBe(201);
  const { id } = (await made.json()) as { id: string };
  const saved = await req(`/campaigns/${id}/world-setup`, {});
  expect(saved.status).toBe(201);
  const s = WorldSetup.parse(await saved.json());
  expect(s.pitch).toBe("You sail between broken stars.");
  expect(s.rules.resolution).toBe("d20");
});

test("character cards snapshot a campaign and update only on request", async () => {
  const { req, home } = await setup();
  const preview = (await (
    await req("/world-drafts", { name: "Card source", pitch: "You cross a distant star ocean." })
  ).json()) as { id: string; origins: { id: string }[]; backgrounds: { id: string }[] };
  const imported = {
    pc: {
      name: "Ethan",
      level: "infinite",
      backstory: "A wandering sovereign",
      abilities: [
        { name: "Light", description: "Shapes light", rank: 10 },
        { name: "Flight", description: "Crosses the sky", rank: 2 },
      ],
      gear: [{ name: "Signet", description: "A personal seal" }],
    },
    companions: [{ name: "Ari", summary: "A loyal friend", voice: "Warm and precise", level: 20 }],
  };
  const started = await req("/campaigns", {
    draftId: preview.id,
    ancestry: preview.origins[0]!.id,
    archetype: preview.backgrounds[0]!.id,
    import: imported,
  });
  const { id } = (await started.json()) as { id: string };
  const made = await req(`/campaigns/${id}/character-card`, {});
  expect(made.status).toBe(201);
  const { CharacterCard } = await import("@wyrd/core");
  const card = CharacterCard.parse(await made.json());
  expect(card.pc.level).toBe("infinite");
  expect(card.pc.abilities).toHaveLength(2);
  expect(card.pc.gear[0]!.name).toBe("Signet");
  expect(card.companions[0]!.voice).toBe("Warm and precise");
  expect(card.sheet?.attributes).toBeTruthy();
  const renamed = await req(`/character-cards/${card.id}`, { title: "My sovereign" }, "PATCH");
  expect(renamed.status).toBe(200);
  const { CampaignStore } = await import("@wyrd/storage");
  const { reduce } = await import("@wyrd/engine");
  const { draft } = await import("@wyrd/core");
  const game = CampaignStore.open(join(home, "campaigns", id, "campaign.db"), { reduce });
  game.append([
    draft("AbilityGained", {
      actorId: "pc",
      ability: {
        id: "test:later",
        name: "Later power",
        description: "A newly learned power",
        level: 1,
        cost: "At will",
        rank: 1,
      },
    }),
  ]);
  game.close();
  expect((await (await req(`/character-cards/${card.id}`)).json()).pc.abilities).toHaveLength(2);
  const updated = CharacterCard.parse(
    await (await req(`/character-cards/${card.id}/update-from/${id}`, {})).json(),
  );
  expect(updated.title).toBe("My sovereign");
  expect(updated.origin).toBe("campaign");
  expect(updated.pc.abilities.map((a) => a.name)).toContain("Later power");
  expect((await (await req("/character-cards")).json()) as unknown[]).toHaveLength(1);
  expect((await req(`/character-cards/${card.id}`, undefined, "DELETE")).status).toBe(200);
});

test("saved worlds clone the generated world without a character; quick starts return 409", async () => {
  const { req } = await setup();
  const p = (await (
    await req("/world-drafts", { name: "Same stars", pitch: "You cross a distant star ocean." })
  ).json()) as { id: string; worldName: string; origins: { id: string }[]; backgrounds: { id: string }[] };
  const { id } = (await (
    await req("/campaigns", { draftId: p.id, ancestry: p.origins[0]!.id, archetype: p.backgrounds[0]!.id })
  ).json()) as { id: string };
  const saved = await req(`/campaigns/${id}/save-world`, {});
  expect(saved.status).toBe(201);
  const world = (await saved.json()) as { id: string; worldName: string };
  expect(world.worldName).toBe(p.worldName);
  expect((await (await req("/worlds")).json()) as unknown[]).toHaveLength(1);
  const { draftId } = (await (await req(`/worlds/${world.id}/draft`, {})).json()) as { draftId: string };
  const resumed = (await (await req(`/world-drafts/${draftId}`)).json()) as {
    preview: { worldName: string };
    hasSheet: boolean;
  };
  expect(resumed.preview.worldName).toBe(p.worldName);
  expect(resumed.hasSheet).toBe(false);
  const quick = (await (await req("/campaigns/quick-start", { name: "Quick", pregen: "sefa" })).json()) as {
    id: string;
  };
  const unavailable = await req(`/campaigns/${quick.id}/save-world`, {});
  expect(unavailable.status).toBe(409);
  expect(await unavailable.text()).toContain("This campaign has no saved world to copy");
});

test("cards start new worlds, drop unknown skills and adapt without changing the library", async () => {
  const { req } = await setup();
  const { CharacterCard, GameView } = await import("@wyrd/core");
  const card = CharacterCard.parse(
    await (
      await req("/character-cards", {
        title: "Ethan",
        origin: "created",
        pc: {
          name: "Ethan",
          level: "infinite",
          backstory: "A wandering sovereign",
          abilities: [{ name: "Light", description: "Shapes light", rank: 10 }],
        },
        companions: [{ name: "Ari", summary: "A loyal friend", voice: "Warm and precise", level: 20 }],
        sheet: {
          pronouns: "he/him",
          skills: { "core:athletics": 10, "custom:nonexistent": 50 },
          appearance: { hair: "Silver" },
          personality: ["Patient"],
        },
      })
    ).json(),
  );
  for (const adapted of [
    undefined,
    { ...card.pc, abilities: [{ name: "Starfire", description: "Shapes starlight", rank: 5 }] },
  ]) {
    const p = (await (
      await req("/world-drafts", { name: "Card world", pitch: "You cross a distant star ocean." })
    ).json()) as { id: string; origins: { id: string }[]; backgrounds: { id: string }[] };
    const started = await req("/campaigns", {
      draftId: p.id,
      ancestry: p.origins[0]!.id,
      archetype: p.backgrounds[0]!.id,
      card: { id: card.id, adapted },
    });
    expect(started.status).toBe(201);
    const { id } = (await started.json()) as { id: string };
    const view = GameView.parse(await (await req(`/campaigns/${id}/view`)).json());
    expect(view.pc.identity.name).toBe("Ethan");
    expect(view.pc.level).toBe("infinite");
    expect(view.pc.abilities[0]!.name).toBe(adapted ? "Starfire" : "Light");
    expect(view.pc.skills["custom:nonexistent"]).toBeUndefined();
    expect(view.pc.skills["core:athletics"]?.trained).toBe(10);
    expect(view.pc.identity.appearance.hair).toBe("Silver");
    expect(view.pc.identity.pronouns).toBe("he/him");
    expect(view.companions[0]).toMatchObject({ name: "Ari", loyal: true, voiceProfile: "Warm and precise" });
  }
  expect(CharacterCard.parse(await (await req(`/character-cards/${card.id}`)).json())).toEqual(card);
  const missing = await req("/campaigns", { draftId: crypto.randomUUID(), card: { id: "missing" } });
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain("Character card not found");
});

test("vary and adaptation return actionable errors offline", async () => {
  const { req } = await setup();
  const varied = await req("/world-setups/vary", { pitch: "You cross a distant star ocean." });
  expect(varied.status).toBe(422);
  expect(await varied.text()).toContain("Connect a model to vary a pitch.");
  const card = (await (
    await req("/character-cards", {
      title: "Ethan",
      origin: "created",
      pc: { name: "Ethan", level: 1, backstory: "A wandering sovereign" },
    })
  ).json()) as { id: string };
  const adapted = await req(`/character-cards/${card.id}/adapt`, { draftId: crypto.randomUUID() });
  expect(adapted.status).toBe(422);
  expect(await adapted.text()).toContain("Connect a model");
});

test("saved worlds can be renamed and duplicated without exposing private draft data", async () => {
  const { req } = await setup();
  const p = (await (
    await req("/world-drafts", { name: "Reuse", pitch: "You cross a distant star ocean." })
  ).json()) as { id: string; origins: { id: string }[]; backgrounds: { id: string }[] };
  const { id } = (await (
    await req("/campaigns", { draftId: p.id, ancestry: p.origins[0]!.id, archetype: p.backgrounds[0]!.id })
  ).json()) as { id: string };
  const w = (await (await req(`/campaigns/${id}/save-world`, {})).json()) as { id: string };
  const renamed = await req(`/worlds/${w.id}`, { name: "Fresh world" }, "PATCH");
  expect(renamed.status).toBe(200);
  expect((await renamed.json()).name).toBe("Fresh world");
  const duplicate = await req(`/worlds/${w.id}/duplicate`, {});
  expect(duplicate.status).toBe(201);
  expect((await duplicate.json()).draft).toBeUndefined();
});

test("injected FakeProvider varies and adapts proposals without changing saved cards", async () => {
  const { FakeProvider, RoleRouter } = await import("@wyrd/llm");
  const { CampaignImport } = await import("@wyrd/core");
  const pc = CampaignImport.shape.pc.parse({
    name: "Ethan",
    level: "infinite",
    backstory: "A wandering sovereign",
  });
  const fake = new FakeProvider([
    {
      match: (r) => r.tools?.[0]?.name === "propose_world",
      reply: { toolCall: { name: "propose_world", args: EXAMPLE_WORLD } },
    },
    {
      match: (r) => r.tools?.[0]?.name === "propose_pitch",
      reply: {
        toolCall: { name: "propose_pitch", args: { pitch: "You discover a ship under a frozen sea." } },
      },
    },
    {
      match: (r) => r.tools?.[0]?.name === "propose_adaptation",
      reply: { toolCall: { name: "propose_adaptation", args: { ...pc, level: 5, name: "Wrong" } } },
    },
  ]);
  const { req } = await setup({
    router: new RoleRouter({
      providers: { fake },
      routing: { worldGen: { provider: "fake", model: "test", fallbacks: [] } },
    }),
  });
  const varied = await req("/world-setups/vary", { pitch: "You cross a distant star ocean." });
  expect(varied.status).toBe(200);
  const card = (await (await req("/character-cards", { title: "Ethan", origin: "created", pc })).json()) as {
    id: string;
  };
  const p = (await (
    await req("/world-drafts", { name: "Adapt", pitch: "You cross a distant star ocean." })
  ).json()) as { id: string };
  const adapted = await req(`/character-cards/${card.id}/adapt`, { draftId: p.id });
  expect(adapted.status).toBe(200);
  expect((await adapted.json()).pc).toMatchObject({ name: "Ethan", level: 5 });
  expect((await (await req(`/character-cards/${card.id}`)).json()).pc.level).toBe("infinite");
});

test("a reviewed card survives draft resume and is not copied into a saved world", async () => {
  const { req } = await setup();
  const p = (await (
    await req("/world-drafts", { name: "Resume card", pitch: "You cross a distant star ocean." })
  ).json()) as { id: string; origins: { id: string }[]; backgrounds: { id: string }[] };
  const card = (await (
    await req("/character-cards", {
      title: "Ethan",
      origin: "created",
      pc: { name: "Ethan", level: "infinite", backstory: "A wandering sovereign" },
    })
  ).json()) as { id: string };
  const choice = {
    id: card.id,
    adapted: { name: "Ethan", level: 7, backstory: "A new arrival", abilities: [], gear: [] },
  };
  expect((await req(`/world-drafts/${p.id}/card`, choice, "PUT")).status).toBe(200);
  const resumed = await (await req(`/world-drafts/${p.id}`)).json();
  expect(resumed.card).toEqual(choice);
  const { id } = (await (
    await req("/campaigns", {
      draftId: p.id,
      ancestry: p.origins[0]!.id,
      archetype: p.backgrounds[0]!.id,
      card: choice,
    })
  ).json()) as { id: string };
  const world = (await (await req(`/campaigns/${id}/save-world`, {})).json()) as { id: string };
  const cloned = (await (await req(`/worlds/${world.id}/draft`, {})).json()) as { draftId: string };
  expect((await (await req(`/world-drafts/${cloned.draftId}`)).json()).card).toBeUndefined();
});

test("a reused source world's preview retains the source for saving another setup", async () => {
  const { req, home } = await setup();
  const p = (await (
    await req("/world-drafts", { name: "Source copy", pitch: "You cross a distant star ocean." })
  ).json()) as { id: string; origins: { id: string }[]; backgrounds: { id: string }[] };
  const { AppStore } = await import("@wyrd/storage");
  const store = new AppStore(join(home, "app.db"));
  const saved = store.creationDraft(p.id) as { input: Record<string, unknown> };
  store.saveCreationDraft(p.id, {
    ...saved,
    input: { ...saved.input, source: { title: "A fictional source", wiki: "source.example" } },
  });
  store.close();
  const { id } = (await (
    await req("/campaigns", { draftId: p.id, ancestry: p.origins[0]!.id, archetype: p.backgrounds[0]!.id })
  ).json()) as { id: string };
  const world = (await (await req(`/campaigns/${id}/save-world`, {})).json()) as { id: string };
  const { draftId } = (await (await req(`/worlds/${world.id}/draft`, {})).json()) as { draftId: string };
  expect((await (await req(`/world-drafts/${draftId}`)).json()).preview.source).toEqual({
    title: "A fictional source",
    wiki: "source.example",
  });
});

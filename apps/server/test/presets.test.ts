import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { WorldSetup } from "@wyrd/core";
import { createApp } from "../src/app.ts";
import { WORLD_STARTERS } from "../src/world-starters.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0).reverse()) f();
});
async function setup() {
  const home = mkdtempSync("/tmp/wyrd-presets-");
  const app = createApp({ home, offline: true });
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

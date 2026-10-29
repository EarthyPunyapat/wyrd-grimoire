import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draft, Entity, Fact, GameView } from "@wyrd/core";
import { type GameState, reduce } from "@wyrd/engine";
import { FakeProvider, RoleRouter } from "@wyrd/llm";
import { CampaignStore } from "@wyrd/storage";
import { createApp } from "../src/app.ts";

const homes: string[] = [];
const servers: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
async function setup(infinite = false) {
  const home = mkdtempSync(join(tmpdir(), "wyrd-skips-"));
  homes.push(home);
  const fake = new FakeProvider([
    {
      role: "gm",
      reply: (req) => {
        const n = req.messages.filter((m) => m.role === "tool").length;
        if (n === 0) return { toolCall: { name: "observe", args: { targetId: "npc:hidden" } } };
        if (n === 1) return { toolCall: { name: "watch", args: { entityId: "npc:hidden" } } };
        if (n === 2) return { toolCall: { name: "time_skip", args: { duration: "2 days" } } };
        return { text: "Two quiet days pass as you watch the distant keeper." };
      },
    },
  ]);
  const router = new RoleRouter({
    providers: { fake },
    routing: { gm: { provider: "fake", model: "test", fallbacks: [] } },
  });
  const server = createApp({ home, offline: false, router });
  servers.push(server);
  let cookie = "";
  const request = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
    server.app.request(`http://localhost/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Wyrd": "1", Cookie: cookie },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const auth = await request("/auth/setup", { passcode: "skips test passcode" });
  cookie = auth.headers.get("set-cookie")!.split(";")[0]!;
  const made = await request("/campaigns/quick-start", {
    name: "God-game",
    characterName: "Ethan",
    archetype: "hunter",
    resolution: "d20",
  });
  const { id } = (await made.json()) as { id: string };
  const store = CampaignStore.open<GameState>(join(home, "campaigns", id, "campaign.db"), { reduce });
  store.append([
    draft("EntityCreated", {
      entity: Entity.parse({
        id: "npc:hidden",
        name: "Distant Keeper",
        kind: "npc",
        detail: "full",
        data: { private: "SECRET DATA" },
      }),
    }),
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "hidden-secret",
        entityId: "npc:hidden",
        predicate: "secret",
        value: "SECRET FACT",
        source: "pack",
        visibility: "secret",
      }),
    }),
    draft("MemoryRecorded", {
      memory: {
        id: "hidden-mind",
        npcId: "npc:hidden",
        gameTime: 0,
        kind: "heard",
        content: "SECRET MIND",
        about: [],
        importance: 2,
        feeling: 0,
        belief: 1,
      },
    }),
    ...(infinite
      ? [draft("LevelGained", { actorId: "pc", from: 1, level: "infinite", method: "gm", reason: "test" })]
      : []),
  ]);
  store.close();
  const view = async () => GameView.parse(await (await request(`/campaigns/${id}/view`)).json());
  return { request, view, id, home };
}

test("watch API is event backed, idempotent, and refuses unknown entities", async () => {
  const s = await setup();
  const path = `/campaigns/${s.id}/watch/pc`;
  expect((await s.request(path, { watch: true }, "PUT")).status).toBe(200);
  expect((await s.request(path, { watch: true }, "PUT")).status).toBe(200);
  expect((await s.view()).watched.map((e) => e.id)).toEqual(["pc"]);
  expect((await s.request(`/campaigns/${s.id}/watch/npc:hidden`, { watch: true }, "PUT")).status).toBe(422);
  expect((await s.request(path, { watch: false }, "PUT")).status).toBe(200);
  expect((await s.view()).watched).toEqual([]);
});

test("infinite observation, watch reports and daily digest persist through real GM turns without NPC secrets", async () => {
  const s = await setup(true);
  const accepted = await s.request(`/campaigns/${s.id}/turns`, {
    input: "Watch the distant keeper for two days",
    clientTurnId: "skip-1",
  });
  expect(accepted.status).toBe(202);
  const { turnId } = (await accepted.json()) as { turnId: string };
  const stream = await (await s.request(`/campaigns/${s.id}/turns/${turnId}/stream`)).text();
  expect(stream).toContain("Watch: Distant Keeper");
  expect(stream).not.toContain("SECRET");
  const view = await s.view();
  expect(view.watched[0]?.name).toBe("Distant Keeper");
  expect(view.gameTime).toBeGreaterThanOrEqual(2880);
  expect(JSON.stringify(view)).not.toContain("SECRET");
  expect(view.turns.at(-1)?.cards).toContainEqual(
    expect.objectContaining({ title: "Watch: Distant Keeper" }),
  );
  const game = CampaignStore.open<GameState>(join(s.home, "campaigns", s.id, "campaign.db"), { reduce });
  const state = game.state();
  game.rebuild();
  expect(game.state()).toEqual(state);
  game.close();
});

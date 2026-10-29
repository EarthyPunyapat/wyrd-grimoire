import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterSheet, draft, Entity, Fact, GameView, ProgressionView } from "@wyrd/core";
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

async function setup() {
  const home = mkdtempSync(join(tmpdir(), "wyrd-delegation-"));
  homes.push(home);
  const fake = new FakeProvider([
    {
      role: "gm",
      reply: (req) => {
        const n = req.messages.filter((m) => m.role === "tool").length;
        if (n === 0)
          return {
            toolCall: {
              name: "delegate",
              args: { assignee: "ari", goal: "Inspect the beacon", opposition: { level: 18 } },
            },
          };
        if (n === 1)
          return { toolCall: { name: "time_skip", args: { minutes: 1440, reason: "Wait for Ari" } } };
        return { text: '<say who="ari">The beacon is secure.</say>' };
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
  const auth = await request("/auth/setup", { passcode: "delegation test passcode" });
  cookie = auth.headers.get("set-cookie")!.split(";")[0]!;
  const made = await request("/campaigns/quick-start", {
    name: "Delegation",
    characterName: "Ethan",
    archetype: "hunter",
    resolution: "d20",
  });
  expect(made.status).toBe(201);
  const { id } = (await made.json()) as { id: string };
  const store = CampaignStore.open<GameState>(join(home, "campaigns", id, "campaign.db"), { reduce });
  const sheet = CharacterSheet.parse({
    ...store.state().actors.pc!.sheet,
    id: "ari",
    level: 20,
    identity: { name: "Ari", ancestry: "fantasy-core:human" },
  });
  store.append([
    draft("EntityCreated", { entity: Entity.parse({ id: "ari", name: "Ari", kind: "npc", detail: "full" }) }),
    draft("CompanionJoined", { companionId: "ari", reason: "Long-standing bond", sheet }),
    draft("FactAsserted", {
      fact: Fact.parse({
        id: "private-ari",
        entityId: "ari",
        predicate: "secret",
        source: "pack",
        value: "never-print-this",
        visibility: "secret",
      }),
    }),
  ]);
  store.close();
  const view = async () => GameView.parse(await (await request(`/campaigns/${id}/view`)).json());
  return { server, fake, id, request, view };
}

test("bond API stores persistent loyalty and voice, hides approval, and rejects revocation", async () => {
  const s = await setup();
  const bonded = await s.request(
    `/campaigns/${s.id}/companions/ari/bond`,
    { loyal: true, voiceProfile: "Warm and candid; addresses Ethan by name." },
    "PUT",
  );
  expect(bonded.status).toBe(200);
  const party = ProgressionView.parse(await bonded.json());
  const ari = party.members.find((m) => m.actorId === "ari")!.companion!;
  expect(ari.approval).toBeNull();
  expect(ari.loyal).toBe(true);
  expect(ari.voiceProfile).toContain("Warm and candid");
  expect((await s.request(`/campaigns/${s.id}/companions/ari/bond`, { loyal: false }, "PUT")).status).toBe(
    422,
  );
  const view = await s.view();
  expect(view.companions[0]?.name).toBe("Ari");
  expect(JSON.stringify(view)).not.toContain("never-print-this");
});

test("actual GM turns persist task reports, speaker names and player-safe task state", async () => {
  const s = await setup();
  await s.request(
    `/campaigns/${s.id}/companions/ari/bond`,
    { loyal: true, voiceProfile: "Warm and candid." },
    "PUT",
  );
  const started = await s.request(`/campaigns/${s.id}/turns`, {
    input: "Ari, inspect the beacon. I wait.",
    clientTurnId: "delegate-1",
  });
  expect(started.status).toBe(202);
  const { turnId } = (await started.json()) as { turnId: string };
  const stream = await (await s.request(`/campaigns/${s.id}/turns/${turnId}/stream`)).text();
  expect(stream).toContain("event: card");
  expect(stream).toContain("Delegation report");
  const view = await s.view();
  expect(view.delegations[0]?.status).toBe("done");
  expect(view.speakers.ari).toBe("Ari");
  expect(view.turns.at(-1)!.cards.some((c) => c.type === "report")).toBe(true);
  expect(JSON.stringify(view)).not.toContain("never-print-this");
  expect(s.fake.calls("gm")[0]!.messages[0]!.content).toContain("Warm and candid");
});

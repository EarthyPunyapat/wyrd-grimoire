import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameView, JournalView } from "@wyrd/core";
import { type GameState, reduce } from "@wyrd/engine";
import { CampaignStore } from "@wyrd/storage";
import { createApp } from "../src/app.ts";

/**
 * M5 acceptance, offline: generate a world from a pitch, then play 100+ turns across at least
 * three sites. Every turn must resolve or ask; replaying the log must reproduce the same state.
 * (The real-model run of the same check is the owner's.)
 */
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

test("100+ turns across three sites from a generated world", async () => {
  const home = mkdtempSync(join(tmpdir(), "wyrd-soak-"));
  homes.push(home);
  const server = createApp({ home, offline: true, seed: "soak" });
  const request = (path: string, body?: unknown, cookie?: string) =>
    server.app.request(`http://localhost/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Wyrd": "1", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const cookie = (await request("/auth/setup", { passcode: "a long soak passcode" })).headers
    .get("set-cookie")!
    .split(";")[0]!;
  const draft = (await (
    await request("/world-drafts", { name: "Soak", characterName: "", pitch: "A frontier mystery." }, cookie)
  ).json()) as {
    id: string;
    origins: Array<{ id: string }>;
    backgrounds: Array<{ id: string }>;
  };
  const { id } = (await (
    await request(
      "/campaigns",
      {
        draftId: draft.id,
        characterName: "Ash",
        ancestry: draft.origins[0]!.id,
        archetype: draft.backgrounds[0]!.id,
      },
      cookie,
    )
  ).json()) as { id: string };

  const view = async () =>
    GameView.parse(await (await request(`/campaigns/${id}/view`, undefined, cookie)).json());
  let n = 0;
  const statuses = new Map<string, number>();
  const turn = async (input: string) => {
    const r = await request(`/campaigns/${id}/turns`, { input, clientTurnId: `soak-${n++}` }, cookie);
    const { turnId } = (await r.json()) as { turnId: string };
    await (await request(`/campaigns/${id}/turns/${turnId}/stream`, undefined, cookie)).text();
    const v = await view();
    const status = v.turns.find((t) => t.id === turnId)?.status ?? "missing";
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    return v;
  };

  const sites = ["Greywater Market", "Hollow Watch", "Cinder Steading", "Greywater Market"];
  const places = new Set<string>();
  const idle = [
    "I look around",
    "I search the area",
    "I wait 30 minutes",
    "I examine the crossroads",
    '"Any news?" I ask the gatekeeper',
  ];
  let v = await view();
  places.add(v.scene!.location);
  for (const site of sites) {
    for (let tries = 0; tries < 8 && !v.scene!.location.startsWith(site); tries++) {
      v = await turn(`I travel to ${site}`);
      for (let i = 0; i < 25 && v.combat; i++) {
        const foe = v.combat.combatants.find((c) => c.side === "enemy" && c.status === "active");
        v = await turn(foe ? `I attack ${foe.name}` : "I defend");
      }
    }
    places.add(v.scene!.location);
    for (let i = 0; i < 25; i++) v = await turn(idle[i % idle.length]!);
  }
  while (n < 100) v = await turn(idle[n % idle.length]!);

  expect(n).toBeGreaterThanOrEqual(100);
  expect([...places].filter((p) => !p.startsWith("the ")).length).toBeGreaterThanOrEqual(3);
  expect(statuses.get("failed") ?? 0).toBe(0);
  expect(statuses.get("missing") ?? 0).toBe(0);
  const journal = JournalView.parse(
    await (await request(`/campaigns/${id}/journal`, undefined, cookie)).json(),
  );
  expect(journal.summaries.length).toBeGreaterThan(3);
  expect(journal.recap).toContain("Previously");

  await server.idle();
  server.close();
  const store = CampaignStore.open<GameState>(join(home, "campaigns", id, "campaign.db"), { reduce });
  const live = store.stateHash();
  expect(store.rebuild()).toBe(live);
  store.close();
}, 120_000);

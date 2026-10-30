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
  return { req };
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

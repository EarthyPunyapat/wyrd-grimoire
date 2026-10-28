import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPack } from "../src/loader.ts";
import { listWorlds, loadWorld, worldEvents } from "../src/world.ts";

const FANTASY = join(import.meta.dir, "../../../packs/fantasy-core");
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wyrd-world-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("ashford-ferry loads and becomes canon events with the party at the start zone", () => {
  expect(listWorlds(FANTASY)).toEqual(["ashford-ferry"]);
  const { world, issues } = loadWorld(FANTASY, "ashford-ferry");
  expect(issues).toEqual([]);
  const events = worldEvents(world!, ["pc"]);
  const scene = events.at(-1);
  expect(scene?.type).toBe("SceneOpened");
  if (scene?.type !== "SceneOpened") throw new Error("no scene");
  expect(scene.payload.scene.positions.pc).toBe("z:common");
  expect(scene.payload.scene.positions["npc:wenna"]).toBe("z:common");
  const secrets = events.filter((e) => e.type === "FactAsserted" && e.payload.fact.visibility === "secret");
  expect(secrets.length).toBeGreaterThanOrEqual(3);
  expect(events.find((e) => e.type === "TimeAdvanced")).toMatchObject({ payload: { minutes: 1110 } });
});

test("pack validate reports broken world references", () => {
  const d = join(dir, "pack");
  cpSync(FANTASY, d, { recursive: true });
  const file = join(d, "worlds/ashford-ferry/world.yaml");
  writeFileSync(file, readFileSync(file, "utf8").replace("npc:hob: z:jetty", "npc:hob: z:moon"));
  const { pack, issues } = loadPack(d);
  expect(pack).toBeNull();
  expect(issues).toContainEqual(
    expect.objectContaining({ code: "WORLD_REFERENCE_BROKEN", file: "worlds/ashford-ferry/world.yaml" }),
  );
});

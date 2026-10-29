import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const MAIN = join(ROOT, "apps/cli/src/main.ts");
const dir = mkdtempSync(join(tmpdir(), "wyrd-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function wyrd(...args: string[]) {
  const p = Bun.spawnSync(["bun", MAIN, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, WYRD_HOME: join(dir, "home") },
  });
  return { code: p.exitCode, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
}
const ok = (...args: string[]) => {
  const r = wyrd(...args);
  if (r.code !== 0) throw new Error(`wyrd ${args.join(" ")} failed (${r.code}):\n${r.err}\n${r.out}`);
  return r.out;
};
const hashOf = (db: string) => ok("hash", db);

describe("dev CLI", () => {
  test("--help lists the commands", () => {
    const out = ok("--help");
    for (const c of [
      "roll",
      "sheet build",
      "campaign create",
      "events append",
      "rewind",
      "rebuild",
      "pack validate",
    ]) {
      expect(out).toContain(c);
    }
  });

  test("roll prints the mechanics line", () => {
    expect(ok("roll", "65", "--difficulty", "hard", "--seed", "3", "--label", "Stealth")).toMatch(
      /^Stealth 65% · Hard \(−20\) → 45% · rolled \d+ · (Critical success|Success|Failure|Critical failure)$/,
    );
    expect(ok("roll", "65", "--dice", "d20", "--seed", "3")).toMatch(
      /^Check \+3 vs DC 11 \(Normal\) · rolled/,
    );
  });

  test("pack validate passes for fantasy-core and fails for a broken pack", () => {
    expect(ok("pack", "validate", "packs/fantasy-core")).toContain("fantasy-core 0.1.0: valid");
    expect(wyrd("pack", "validate", dir).code).toBe(1);
  });

  test("sheet build makes a valid sheet; sheet validate reports broken rules", () => {
    const file = join(dir, "hunter.json");
    ok("sheet", "build", "--archetype", "hunter", "--name", "Ash", "--out", file);
    expect(ok("sheet", "validate", file)).toStartWith("valid");
    const bad = join(dir, "bad.json");
    writeFileSync(
      bad,
      JSON.stringify({
        id: "pc",
        identity: { name: "Greedy", ancestry: "fantasy-core:human" },
        attributes: { str: 7, agi: 7, end: 7, int: 7, awa: 7, wil: 7, pre: 7 },
      }),
    );
    const r = wyrd("sheet", "validate", bad);
    expect(r.code).toBe(1);
    expect(r.err).toContain("ATTR_POINTS_OVERSPENT");
  });

  test("M1 acceptance: create, append, rewind, rebuild → identical state hash", () => {
    const pc = join(dir, "pc.json");
    const db = join(dir, "campaign.db");
    const later = join(dir, "later.jsonl");
    ok("sheet", "build", "--archetype", "cutpurse", "--name", "Wren", "--ancestry", "halfling", "--out", pc);
    ok("campaign", "create", db, "--name", "Ford of Ash", "--seed", "7", "--pc", pc);
    ok("check", db, "--skill", "stealth", "--difficulty", "hard");
    ok("events", "append", db, "TimeAdvanced", '{"minutes":30,"reason":"wait for dusk"}');
    ok("check", db, "--skill", "sleight-of-hand", "--mod", "crowd=10");
    ok("events", "append", db, "ConditionApplied", '{"actorId":"pc","condition":{"id":"core:inspired"}}');
    ok("check", db, "--skill", "perception");
    const head = hashOf(db);

    writeFileSync(later, ok("events", "export", db, "--from", "3"));
    expect(ok("rewind", db, "2")).toContain("rewound to seq 2");
    expect(hashOf(db)).not.toBe(head);
    ok("events", "append", db, "--file", later);
    expect(hashOf(db)).toBe(head);

    expect(ok("rebuild", db)).toBe(`hash ${head}`);
    expect(ok("branches", db).split("\n")).toHaveLength(2);
  }, 20000);

  test("hardcore campaigns refuse rewind", () => {
    const db = join(dir, "hardcore.db");
    ok("campaign", "create", db, "--name", "Iron", "--hardcore", "--seed", "1");
    ok("events", "append", db, "TimeAdvanced", '{"minutes":1,"reason":"x"}');
    const r = wyrd("rewind", db, "1");
    expect(r.code).toBe(2);
    expect(r.err).toContain("hardcore");
  });

  test("invalid events are rejected with a clear error", () => {
    const db = join(dir, "strict.db");
    ok("campaign", "create", db, "--name", "Strict", "--seed", "1");
    const r = wyrd("events", "append", db, "TimeAdvanced", '{"minutes":-5,"reason":"x"}');
    expect(r.code).toBe(2);
    expect(r.err).toContain("Invalid TimeAdvanced payload");
  });

  test("play --offline: a world, a PC, a few scripted turns", () => {
    const pc = join(dir, "wren.json");
    const db = join(dir, "ashford.db");
    ok("sheet", "build", "--archetype", "cutpurse", "--name", "Wren", "--ancestry", "halfling", "--out", pc);
    expect(
      ok(
        "campaign",
        "create",
        db,
        "--name",
        "Ashford",
        "--seed",
        "5",
        "--pc",
        pc,
        "--world",
        "ashford-ferry",
      ),
    ).toContain("loaded world Ashford Ferry");
    const out = ok(
      "play",
      db,
      "--offline",
      "--input",
      "I look at the hearth",
      "--input",
      "I go out to the yard",
      "--input",
      "I climb into the hayloft",
      "--input",
      "/where",
    );
    expect(out).toContain("Ashford Ferry House, the common room · with Wenna Harrow, Aldric Vane");
    expect(out).toContain("(offline narrator) Wren examines the hearth.");
    expect(out.indexOf("Working on your turn")).toBeGreaterThan(-1);
    expect(out.indexOf("Working on your turn")).toBeLessThan(out.indexOf("(offline narrator)"));
    expect(out).toContain("Getting to the hayloft needs a climb");
    expect(out).toContain("1. Try to climb to the hayloft (athletics, normal)");
    expect(out).toContain("Ashford Ferry House, the yard");
    // Real providers need a config: first none, then the example's placeholder model IDs are refused.
    expect(wyrd("play", db).err).toContain("No provider config");
    expect(ok("config", "init")).toContain("config.json");
    expect(wyrd("play", db).err).toContain('Pick a model for "plan"');
  });
});

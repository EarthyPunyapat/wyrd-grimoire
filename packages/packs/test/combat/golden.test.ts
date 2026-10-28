import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableStringify } from "@wyrd/core";
import { autoFight, startCombat, unwrap } from "@wyrd/engine";
import { Fight } from "./fixture.ts";

/**
 * Golden combat scenarios (spec 15): seeded fights must produce the exact recorded event sequence.
 * A rules change that alters one is deliberate: rerun with WYRD_UPDATE_GOLDEN=1 and review the diff.
 */
const DIR = join(import.meta.dir, "golden");
const SCENARIOS = [
  { name: "tavern-pc-companion-vs-bandits", seed: 42, companion: true, settings: {} },
  { name: "tavern-pc-alone-hard", seed: 7, companion: false, settings: { difficulty: "hard" as const } },
  { name: "tavern-hardcore", seed: 11, companion: true, settings: { structural: { hardcore: true } } },
];

function record(s: (typeof SCENARIOS)[number]) {
  const f = new Fight({ seed: s.seed, companion: s.companion, settings: s.settings });
  const started = unwrap(
    startCombat(f.state, { initiatorId: "pc", targetIds: ["npc:cutter"], combatId: s.name }, f.ctx),
  );
  f.commit(started.events);
  f.commit(autoFight(f.state, f.ctx).events);
  return f.events.map(
    (e) => `${e.type} ${createHash("sha256").update(stableStringify(e.payload)).digest("hex").slice(0, 12)}`,
  );
}

describe("golden combat scenarios", () => {
  for (const s of SCENARIOS) {
    test(s.name, () => {
      const lines = record(s);
      const file = join(DIR, `${s.name}.txt`);
      if (process.env.WYRD_UPDATE_GOLDEN || !existsSync(file)) {
        mkdirSync(DIR, { recursive: true });
        writeFileSync(file, `${lines.join("\n")}\n`);
      }
      expect(lines).toEqual(readFileSync(file, "utf8").trimEnd().split("\n"));
      expect(lines.some((l) => l.startsWith("CombatEnded"))).toBe(true);
      // Determinism: a second run gives the same sequence.
      expect(record(s)).toEqual(lines);
    });
  }
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeProvider, RoleRouter } from "../../../packages/llm/src/index.ts";
import { gmFixture } from "../../../packages/llm/test/gm-fixture.ts";
import { parseReplayArgs, runReplay } from "../run.ts";

let fx: ReturnType<typeof gmFixture>;
let dir: string;
beforeEach(() => {
  fx = gmFixture();
  dir = mkdtempSync(join(tmpdir(), "wyrd-run-test-"));
});
afterEach(() => {
  fx.close();
  rmSync(dir, { recursive: true, force: true });
});
const route = { provider: "fake", model: "fixture-model", fallbacks: [] };

test("CLI requires a campaign, defaults to private host transcripts, and rejects invalid spend limits/options", () => {
  const o = parseReplayArgs(["--campaign", "baseline.db"]);
  expect(o?.input).toEndWith("/Downloads/chatgpt-rpg");
  expect(o?.out).toEndWith("/evals/replay/out");
  expect(parseReplayArgs(["--help"])).toBeNull();
  for (const args of [
    [],
    ["--offline"],
    ["--campaign"],
    ["--campaign", "x", "--limit", "0"],
    ["--campaign", "x", "--limit", "1.5"],
    ["--campaign", "x", "--limit", "oops"],
  ])
    expect(() => parseReplayArgs(args)).toThrow();
});

test("full eval is sequential, checkpoints rows, labels bad files and keeps source/transcripts untouched", async () => {
  const input = join(dir, "input");
  mkdirSync(input);
  copyFileSync(join(import.meta.dir, "fixtures/ferry.html"), join(input, "a.html"));
  writeFileSync(join(input, "b.json"), "PRIVATE invalid transcript");
  writeFileSync(join(input, "decode.py"), "must not be run");
  const fake = new FakeProvider([{ role: "gm", reply: { text: "Wyrd ferry reply." } }]);
  const router = new RoleRouter({ providers: { fake }, routing: { gm: route } });
  const before = fx.store.stateHash();
  const checkpoints: number[] = [];
  const result = await runReplay(
    { campaign: fx.store.db.filename, input, out: join(dir, "out"), home: dir, limit: 2 },
    {
      router,
      now: () => new Date("2026-10-30T12:00:00Z"),
      tempRoot: dir,
      onProgress: () => {
        const html = readFileSync(join(dir, "out/2026-10-30.html"), "utf8");
        checkpoints.push((html.match(/class="turn"/g) ?? []).length);
      },
    },
  );
  expect(result.ok).toBe(false); // malformed second file is visible and yields a nonzero exit
  expect(fake.calls("gm")).toHaveLength(2);
  expect(checkpoints).toEqual([1, 2]);
  expect(fx.store.stateHash()).toBe(before);
  expect(result.report.chats[0]?.rows.map((r) => r.input)).toEqual([
    "I hail the ferryman.",
    "I ask the fare.",
  ]);
  expect(result.report.chats[0]?.total).toBe(4);
  expect(result.report.complete).toBe(true);
  const html = readFileSync(result.path, "utf8");
  expect(html).toContain("fixture-model");
  expect(html).toContain("Could not read transcript");
  expect(html).not.toContain("PRIVATE");
  expect(readdirSync(dir).filter((name) => name.startsWith("wyrd-replay-"))).toEqual([]);
  expect(readFileSync(join(input, "b.json"), "utf8")).toBe("PRIVATE invalid transcript");
});

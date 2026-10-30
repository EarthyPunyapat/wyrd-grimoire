import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeProvider, RoleRouter } from "../../../packages/llm/src/index.ts";
import { gmFixture } from "../../../packages/llm/test/gm-fixture.ts";
import { withReplaySession } from "../replay.ts";
import { snapshotDatabase } from "../runtime.ts";
import { pairTurns, readTranscript } from "../transcripts.ts";

let fx: ReturnType<typeof gmFixture>;
let home: string;
beforeEach(() => {
  fx = gmFixture();
  home = mkdtempSync(join(tmpdir(), "wyrd-replay-test-"));
});
afterEach(() => {
  fx.close();
  rmSync(home, { recursive: true, force: true });
});
const route = { provider: "fake", model: "test-model", fallbacks: [] };
const routerFor = (fake: FakeProvider, check = false) =>
  new RoleRouter({
    providers: { fake },
    routing: { gm: route, ...(check ? { check: route } : {}) },
  });

test("real GM tools persist between inputs, checks finish, and reference replies never enter prompts", async () => {
  const fake = new FakeProvider([
    {
      role: "gm",
      times: 1,
      reply: {
        toolCall: {
          name: "change_state",
          args: {
            changes: [
              { kind: "item.define", name: "Ferry token" },
              { kind: "item.give", actorId: "pc", itemId: "campaign:ferry-token" },
            ],
          },
        },
      },
    },
    { role: "gm", reply: { text: "Wyrd: you receive a ferry token." } },
    {
      role: "check",
      reply: {
        toolCall: {
          name: "report_unrecorded",
          args: { claims: [{ quote: "ferry token", claim: "Check this claim." }], entities: [] },
        },
      },
    },
  ]);
  const source = fx.store.db.filename;
  const before = readFileSync(`${source}-wal`);
  const databaseBefore = readFileSync(source);
  const hash = fx.store.stateHash();
  const chat = readTranscript(join(import.meta.dir, "fixtures/ferry.html"));
  await withReplaySession(
    { snapshot: snapshotDatabase(source), router: routerFor(fake, true), home, tempRoot: home },
    async (session) => {
      expect(session.store.stateHash()).toBe(hash);
      const first = await session.run(pairTurns(chat)[0]!.input);
      expect(first.ok).toBe(true);
      expect(first.gm?.tools[0]).toMatchObject({ name: "change_state", ok: true });
      expect(first.checked).toBe(true);
      expect(first.flags).toEqual([{ quote: "ferry token", claim: "Check this claim." }]);
      expect(first.gm?.provider).toBe("fake");
      expect(first.promptVersion).toMatch(/^gm@/);
      expect(session.store.state().customItems["campaign:ferry-token"]).toBeDefined();
      const second = await session.run(pairTurns(chat)[1]!.input);
      expect(second.checked).toBe(true);
      const prompt = fake.calls("gm").at(-1)!;
      const text = JSON.stringify(prompt);
      expect(text).toContain("Wyrd: you receive a ferry token.");
      expect(text).toContain("campaign:ferry-token");
      expect(text).toContain("I ask the fare.");
      for (const t of chat.turns.filter((t) => t.role === "assistant")) expect(text).not.toContain(t.text);
    },
  );
  expect(readFileSync(`${source}-wal`)).toEqual(before);
  expect(readFileSync(source)).toEqual(databaseBefore);
  expect(fx.store.stateHash()).toBe(hash);
  expect(readdirSync(home)).toEqual([]);
});

test("each transcript starts from the same snapshot; thrown callback still removes temp files", async () => {
  const branch = fx.store.rewind(fx.store.branch("main").head, "Replay baseline");
  const snapshot = snapshotDatabase(fx.store.db.filename);
  const fake = new FakeProvider([{ role: "gm", reply: { text: "Wyrd reply." } }]);
  for (let i = 0; i < 2; i++)
    await withReplaySession({ snapshot, router: routerFor(fake), home, tempRoot: home }, async (s) => {
      expect(s.store.stateHash()).toBe(fx.store.stateHash());
      expect(s.store.activeBranchId).toBe(branch.id);
      await s.run("Unique player move.");
      expect(
        fake
          .calls("gm")
          .at(-1)!
          .messages[0]?.content.match(/Wyrd reply/g),
      ).toBeNull();
    });
  await expect(
    withReplaySession({ snapshot, router: routerFor(fake), home, tempRoot: home }, async () => {
      throw new Error("test");
    }),
  ).rejects.toThrow("test");
  expect(readdirSync(home)).toEqual([]);
});

test("GM failures and classic fallback are explicit, with no upstream error text", async () => {
  const fake = new FakeProvider([
    { role: "gm", times: 1, reply: { error: { code: "bad_request", message: "PRIVATE upstream prompt" } } },
    { role: "gm", reply: { text: "A later turn succeeds." } },
  ]);
  await withReplaySession(
    { snapshot: snapshotDatabase(fx.store.db.filename), router: routerFor(fake), home, tempRoot: home },
    async (s) => {
      const result = await s.run("Try anyway.");
      expect(result.ok).toBe(false);
      expect(result.classicFallback).toBe(true);
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
      expect(result.error).toBeDefined();
      expect((await s.run("Next player input.")).ok).toBe(true);
    },
  );
  expect(readdirSync(home)).toEqual([]);
});

test("configured backup GM completion keeps the actual model and backup badge", async () => {
  const primary = new FakeProvider([{ role: "gm", reply: { error: { code: "usage_limit" } } }], "primary");
  const backup = new FakeProvider([{ role: "gm", reply: { text: "Backup prose." } }]);
  const router = new RoleRouter({
    providers: { primary, fake: backup },
    routing: {
      gm: { provider: "primary", model: "primary-model", fallbacks: [route] },
    },
  });
  await withReplaySession(
    { snapshot: snapshotDatabase(fx.store.db.filename), router, home, tempRoot: home },
    async (s) => {
      const result = await s.run("I wave.");
      expect(result.ok).toBe(true);
      expect(result.gm).toMatchObject({ provider: "fake", model: "test-model", backup: true });
      expect(result.classicFallback).toBe(false);
    },
  );
});

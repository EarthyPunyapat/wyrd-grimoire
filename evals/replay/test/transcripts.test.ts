import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTranscripts, pairTurns, readTranscript } from "../transcripts.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("reuses the share decoder and pairs all player inputs, including unanswered inputs", () => {
  const chat = readTranscript(join(import.meta.dir, "fixtures/ferry.html"));
  expect(chat.title).toBe("The Reed ferry");
  expect(pairTurns(chat)).toEqual([
    { input: "I hail the ferryman.", reference: "He raises a hand.\n\n“Coming across?”" },
    { input: "I ask the fare.", reference: "" },
    { input: "And the name of the boat?", reference: "“Two coppers. She is the Reed.”" },
    { input: "I step aboard.", reference: "" },
  ]);
});

test("decoded JSON keeps player input verbatim and rejects other shapes without echoing text", () => {
  const dir = mkdtempSync(join(tmpdir(), "wyrd-transcript-test-"));
  dirs.push(dir);
  const path = join(dir, "chat.json");
  writeFileSync(path, JSON.stringify({ title: "Test", turns: [{ role: "user", text: "  /gm hi\n " }] }));
  expect(pairTurns(readTranscript(path))[0]?.input).toBe("  /gm hi\n ");
  for (const invalid of [
    "private bad JSON",
    JSON.stringify({ title: "Test", turns: [{ role: "system", text: "private input" }] }),
    JSON.stringify({ title: "Test", turns: [{ role: "user", text: 42 }] }),
    JSON.stringify({ title: "Test", turns: [] }),
  ]) {
    writeFileSync(path, invalid);
    expect(() => readTranscript(path)).toThrow(
      "Could not read transcript; use a saved share HTML page or SharedChat JSON.",
    );
  }
});

test("discovers sorted supported regular files only and validates explicit selections", () => {
  const dir = mkdtempSync(join(tmpdir(), "wyrd-transcript-test-"));
  dirs.push(dir);
  for (const name of ["z.HTML", "a.json", "decode.py", "notes.txt"]) writeFileSync(join(dir, name), "");
  mkdirSync(join(dir, "folder.html"));
  symlinkSync(join(dir, "a.json"), join(dir, "link.json"));
  expect(listTranscripts(dir)).toEqual(["a.json", "z.HTML"]);
  expect(listTranscripts(dir, ["z.HTML"])).toEqual(["z.HTML"]);
  for (const files of [["../a.json"], ["decode.py"], ["link.json"], ["missing.html"]])
    expect(() => listTranscripts(dir, files)).toThrow();
  expect(() => listTranscripts(join(dir, "missing"))).toThrow();
});

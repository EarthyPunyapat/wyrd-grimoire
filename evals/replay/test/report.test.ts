import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ReplayReport, renderReport, writeReport } from "../report.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const hostile = '<script>alert("x")</script><img src="https://example.invalid/x"> &';
export function reportFixture(): ReplayReport {
  return {
    at: "2026-10-30T12:00:00.000Z",
    complete: false,
    target: { provider: "fake", model: "test" },
    campaign: { hash: "abc123", branch: "main", seq: 10 },
    chats: [
      {
        file: hostile,
        title: hostile,
        total: 1,
        rows: [
          {
            input: hostile,
            reference: hostile,
            wyrd: {
              ok: false,
              status: "failed",
              narration: hostile,
              elapsedMs: 23,
              checked: false,
              flags: [{ quote: hostile, claim: hostile }],
              mechanics: [],
              classicFallback: true,
              error: "Failed safely.",
              gm: {
                provider: hostile,
                model: hostile,
                backup: true,
                rounds: 1,
                tools: [{ name: hostile, ok: false, note: hostile }],
                cards: [{ type: "report", title: "Report", body: hostile }],
                choices: [],
              },
            },
          },
        ],
      },
    ],
  };
}

test("self-contained side-by-side report escapes every data field and labels fallback, errors and missing replies", () => {
  const report = reportFixture();
  const html = renderReport(report);
  expect(html).toContain("ChatGPT");
  expect(html).toContain("Wyrd");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).toContain("Classic fallback");
  expect(html).toContain("Backup model");
  expect(html).toContain("Failed safely.");
  expect(html).toContain("In progress");
  expect(html).toContain("Not checked");
  expect(html).toContain("abc123");
  report.chats[0]!.rows[0]!.reference = "";
  expect(renderReport(report)).toContain("No ChatGPT reply recorded");
});

test("dated private HTML is checkpointed and replaced atomically", () => {
  const dir = mkdtempSync(join(tmpdir(), "wyrd-report-test-"));
  dirs.push(dir);
  const report = reportFixture();
  const path = writeReport(report, join(dir, "out"));
  expect(path).toBe(join(dir, "out/2026-10-30.html"));
  expect(readFileSync(path, "utf8")).toContain("In progress");
  report.complete = true;
  writeReport(report, join(dir, "out"));
  expect(readFileSync(path, "utf8")).toContain("Complete");
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

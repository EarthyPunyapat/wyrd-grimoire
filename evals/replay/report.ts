import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Target } from "../../packages/llm/src/router.ts";
import type { ReplayTurn } from "./replay.ts";
import type { ReplayInput } from "./transcripts.ts";

export type ReplayReport = {
  at: string;
  complete: boolean;
  target: Target;
  campaign: { hash: string; branch: string; seq: number };
  chats: {
    file: string;
    title: string;
    total: number;
    rows: (ReplayInput & { wyrd: ReplayTurn })[];
    error?: string;
  }[];
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );

/** All transcript and model text stays text, including speaker tags and Markdown/HTML. */
export function renderReport(report: ReplayReport): string {
  const rows = report.chats.flatMap((chat) => chat.rows);
  const failures = rows.filter((r) => !r.wyrd.ok).length + report.chats.filter((c) => c.error).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Wyrd replay — ${escapeHtml(report.at.slice(0, 10))}</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.6}
body{max-width:1500px;margin:auto;padding:2rem}h1,h2,h3{line-height:1.3}
.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2rem}
.turn{border-top:2px solid #888;padding:1rem 0 2rem;margin-top:2rem}
.prose{white-space:pre-wrap;overflow-wrap:anywhere;font-family:Georgia,serif}
.meta{font-size:.85rem;overflow-wrap:anywhere}.player{white-space:pre-wrap;overflow-wrap:anywhere}
.alert{border-left:4px solid #c56a29;padding-left:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}
details{margin-top:1rem}section{min-width:0}a{color:inherit}
@media(max-width:700px){body{padding:1rem}.columns{grid-template-columns:1fr;gap:1rem}}
@media print{details{display:block}.turn{break-before:auto}}
</style></head><body>
<h1>ChatGPT / Wyrd replay</h1>
<p>${report.complete ? "Complete" : "In progress"} · ${rows.length} inputs replayed · ${failures} failures</p>
<p class="meta">Started ${escapeHtml(report.at)} · configured GM: ${escapeHtml(report.target.provider)} / ${escapeHtml(report.target.model)}<br>
Baseline state ${escapeHtml(report.campaign.hash)} · branch ${escapeHtml(report.campaign.branch)} · seq ${report.campaign.seq}</p>
<p>Each transcript starts from the same campaign snapshot. Wyrd accumulates its own history; ChatGPT replies are reference only. This page contains private transcript text. Review prose, intent, refusals and recorded changes; completion is not an acceptance verdict.</p>
${report.chats
  .map(
    (chat, ci) => `<article><h2>${ci + 1}. ${escapeHtml(chat.title)}</h2>
<p class="meta">${escapeHtml(chat.file)} · ${chat.rows.length} / ${chat.total} player inputs replayed</p>
${chat.error ? `<p class="alert">${escapeHtml(chat.error)}</p>` : ""}
${chat.rows
  .map((row, ri) => {
    const w = row.wyrd;
    return `<div class="turn" id="chat-${ci + 1}-turn-${ri + 1}">
<h3>Turn ${ri + 1}</h3><p class="player"><strong>Player</strong><br>${escapeHtml(row.input)}</p>
<div class="columns"><section aria-label="ChatGPT turn ${ri + 1}"><h3>ChatGPT</h3><div class="prose">${escapeHtml(row.reference || "No ChatGPT reply recorded.")}</div></section>
<section aria-label="Wyrd turn ${ri + 1}"><h3>Wyrd</h3>
<p class="meta">${escapeHtml(w.status)} · ${w.elapsedMs} ms · ${escapeHtml(w.gm ? `${w.gm.provider} / ${w.gm.model}` : "No GM record")} · ${escapeHtml(w.promptVersion ?? "Unknown prompt version")}${w.gm?.backup ? " · Backup model" : ""}${w.classicFallback ? " · Classic fallback (not a GM replay success)" : ""}</p>
${w.error ? `<p class="alert">${escapeHtml(w.error)}</p>` : ""}
<div class="prose">${escapeHtml(w.narration || "No Wyrd prose recorded.")}</div>
<details><summary>Recorded tools, cards, choices and mechanics</summary><pre>${escapeHtml(JSON.stringify({ gm: w.gm, mechanics: w.mechanics }, null, 2))}</pre></details>
<details${w.flags.length ? " open" : ""}><summary>Structural check: ${w.checked ? `${w.flags.length} flags` : "Not checked"}</summary><pre>${escapeHtml(JSON.stringify(w.flags, null, 2))}</pre></details>
</section></div></div>`;
  })
  .join("\n")}</article>`,
  )
  .join("\n")}
</body></html>`;
}

/** Atomic checkpoints leave a complete, readable HTML file even if a later provider call fails. */
export function writeReport(report: ReplayReport, out: string): string {
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const path = join(out, `${new Date(report.at).toISOString().slice(0, 10)}.html`);
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, renderReport(report), { mode: 0o600 });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  return path;
}

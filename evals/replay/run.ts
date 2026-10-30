import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { wyrdHome } from "../../apps/cli/src/providers.ts";
import type { RoleRouter } from "../../packages/llm/src/router.ts";
import { withReplaySession } from "./replay.ts";
import { type ReplayReport, writeReport } from "./report.ts";
import { createReplayRouter, ReplaySetupError, readReplayConfig, snapshotDatabase } from "./runtime.ts";
import { listTranscripts, pairTurns, readTranscript } from "./transcripts.ts";

const HELP = `Wyrd replay eval — real configured providers, never CI

bun run eval:replay --campaign <campaign.db> [options]
  --input <directory>   Default: ~/Downloads/chatgpt-rpg/
  --file <filename>     Select a supported file inside --input (repeatable)
  --limit <count>       Replay only the first N player inputs per transcript
  --out <directory>     Default: evals/replay/out/; writes <UTC date>.html
  --config <file>       Override provider settings (default: WYRD_HOME/app.db, then config.json)
  --home <directory>    Override WYRD_HOME for credentials, settings and house style
  --help               Show this help without reading private files or calling providers

Prepare a baseline campaign at the start of the replay. Each transcript uses a fresh temporary
copy of it. Real calls consume provider usage. Output is private and ignored by git; reruns on
the same UTC day replace that day's report. No browser is launched.
`;

export type ReplayOptions = {
  campaign: string;
  input: string;
  out: string;
  home: string;
  config?: string;
  files?: string[];
  limit?: number;
};

function expand(path: string): string {
  return resolve(path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
}

export function parseReplayArgs(args: string[]): ReplayOptions | null {
  if (args.includes("--help")) return null;
  let values: ReturnType<typeof parseArgs>["values"];
  try {
    ({ values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        campaign: { type: "string" },
        input: { type: "string" },
        out: { type: "string" },
        home: { type: "string" },
        config: { type: "string" },
        file: { type: "string", multiple: true },
        limit: { type: "string" },
      },
    }));
  } catch {
    throw new ReplaySetupError("Invalid replay options. Run bun run eval:replay --help.");
  }
  if (typeof values.campaign !== "string" || !values.campaign.trim())
    throw new ReplaySetupError("Pass --campaign <campaign.db> for the prepared replay baseline.");
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new ReplaySetupError("--limit must be a positive integer.");
  return {
    campaign: expand(values.campaign),
    input: expand(
      typeof values.input === "string" ? values.input : join(homedir(), "Downloads", "chatgpt-rpg"),
    ),
    out: expand(typeof values.out === "string" ? values.out : join(import.meta.dir, "out")),
    home: expand(typeof values.home === "string" ? values.home : wyrdHome()),
    config: typeof values.config === "string" ? expand(values.config) : undefined,
    files: Array.isArray(values.file)
      ? values.file.filter((v): v is string => typeof v === "string")
      : undefined,
    limit,
  };
}

/** Dependencies make orchestration testable with FakeProvider; the command always builds real providers. */
export async function runReplay(
  o: ReplayOptions,
  deps: {
    router?: RoleRouter;
    now?: () => Date;
    tempRoot?: string;
    onProgress?: (p: { transcript: number; transcripts: number; turn: number; turns: number }) => void;
  } = {},
): Promise<{ path: string; ok: boolean; report: ReplayReport }> {
  const files = listTranscripts(o.input, o.files);
  const snapshot = snapshotDatabase(o.campaign);
  const router = deps.router ?? createReplayRouter(readReplayConfig(o), o.home);
  const sessionOptions = { snapshot, router, home: o.home, tempRoot: deps.tempRoot };
  const campaign = await withReplaySession(sessionOptions, async ({ store }) => ({
    hash: store.stateHash(),
    branch: store.activeBranchId,
    seq: store.branch(store.activeBranchId).head,
  }));
  const report: ReplayReport = {
    at: (deps.now?.() ?? new Date()).toISOString(),
    complete: false,
    target: { provider: router.route("gm").provider, model: router.route("gm").model },
    campaign,
    chats: [],
  };
  let path = writeReport(report, o.out);
  for (const [i, file] of files.entries()) {
    const result: ReplayReport["chats"][number] = { file, title: file, total: 0, rows: [] };
    report.chats.push(result);
    let chat: ReturnType<typeof readTranscript>;
    try {
      chat = readTranscript(join(o.input, file));
    } catch {
      result.error = "Could not read transcript; use a saved share HTML page or SharedChat JSON.";
      path = writeReport(report, o.out);
      continue;
    }
    result.title = chat.title;
    const all = pairTurns(chat);
    result.total = all.length;
    const pairs = o.limit ? all.slice(0, o.limit) : all;
    await withReplaySession(sessionOptions, async (session) => {
      for (const [j, pair] of pairs.entries()) {
        const wyrd = await session.run(pair.input);
        result.rows.push({ ...pair, wyrd });
        path = writeReport(report, o.out);
        deps.onProgress?.({ transcript: i + 1, transcripts: files.length, turn: j + 1, turns: pairs.length });
      }
    });
  }
  report.complete = true;
  path = writeReport(report, o.out);
  return { path, report, ok: report.chats.every((c) => !c.error && c.rows.every((r) => r.wyrd.ok)) };
}

if (import.meta.main) {
  try {
    const options = parseReplayArgs(process.argv.slice(2));
    if (!options) console.log(HELP);
    else {
      const result = await runReplay(options, {
        onProgress: (p) =>
          console.log(
            `Transcript ${p.transcript}/${p.transcripts}, input ${p.turn}/${p.turns} checkpointed.`,
          ),
      });
      console.log("Replay report written to the output directory.");
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    console.error(
      error instanceof ReplaySetupError
        ? error.message
        : "Replay failed. Check input files, campaign and provider setup on the host; no upstream error text is logged.",
    );
    process.exitCode = 1;
  }
}

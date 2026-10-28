import { getRandomValues } from "node:crypto";
import { createInterface } from "node:readline/promises";
import type { Clarification, CompiledPack } from "@wyrd/core";
import { createUlidFactory } from "@wyrd/core";
import type { GameState, RulesContext } from "@wyrd/engine";
import {
  type FallbackNotice,
  offlineProvider,
  RoleRouter,
  TurnPipeline,
  type TurnResult,
  type TurnStreamEvent,
} from "@wyrd/llm";
import { type CampaignStore, CanonQueries } from "@wyrd/storage";
import { CliError } from "./errors.ts";
import { loadRouterFromConfig } from "./providers.ts";

/** Canon entity holding the world bible (the hand-authored world's premise in M2). */
export const WORLD_BIBLE_ID = "concept:world-bible";

const out = (s = "") => process.stdout.write(`${s}\n`);
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);

/** Word-wraps prose and turns `<say who="…">…</say>` into `Name: "…"` lines. */
export function renderNarration(text: string, nameOf: (id: string) => string, width = 88): string {
  const withSpeech = text.replace(/<say who="([^"]*)">([\s\S]*?)<\/say>/g, (_, who: string, line: string) => {
    return `\n${nameOf(who)}: “${line.trim()}”\n`;
  });
  return withSpeech
    .split(/\n+/)
    .map((para) => {
      const words = para.trim().split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = "";
      for (const w of words) {
        if (line && line.length + 1 + w.length > width) {
          lines.push(line);
          line = w;
        } else line = line ? `${line} ${w}` : w;
      }
      if (line) lines.push(line);
      return lines.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

export type PlayOptions = { offline: boolean; inputs?: string[] | undefined; configPath?: string };

export async function playCommand(
  store: CampaignStore<GameState>,
  rules: RulesContext,
  opts: PlayOptions,
): Promise<number> {
  const state = store.state();
  if (!state.party.pcId) throw new CliError("The campaign has no PC; create it with --pc");
  if (!state.scene) throw new CliError("No scene is open; create the campaign with --world ashford-ferry");

  const notices: FallbackNotice[] = [];
  const router = opts.offline
    ? new RoleRouter({
        providers: { offline: offlineProvider() },
        routing: Object.fromEntries(
          (["parser", "narrator", "guard"] as const).map((r) => [
            r,
            { provider: "offline", model: "offline", fallbacks: [] },
          ]),
        ),
      })
    : loadRouterFromConfig({
        ...(opts.configPath ? { path: opts.configPath } : {}),
        onFallback: (n) => notices.push(n),
      });

  const canon = new CanonQueries(store);
  const pack = store.packSnapshot()?.content as CompiledPack | undefined;
  const ulid = createUlidFactory({ now: Date.now, random: (n) => getRandomValues(new Uint8Array(n)) });
  const pipeline = new TurnPipeline({
    store,
    canon,
    router,
    rules,
    tone: pack?.tone ?? "",
    worldBible: canon.entity(WORLD_BIBLE_ID)?.summary ?? "",
    newId: ulid,
    campaignId: store.campaignId,
  });

  const nameOf = (id: string) =>
    store.state().actors[id]?.sheet.identity.name ?? canon.entity(id)?.name ?? id;
  const where = () => {
    const s = store.state();
    const scene = s.scene!;
    const zoneName = (z: string) => scene.zones.find((x) => x.id === z)?.name ?? z;
    const here = scene.positions[s.party.pcId!]!;
    const others = Object.entries(scene.positions)
      .filter(([id, z]) => z === here && id !== s.party.pcId)
      .map(([id]) => nameOf(id));
    return `${nameOf(scene.locationId)}, ${zoneName(here)}${others.length ? ` · with ${others.join(", ")}` : ""}`;
  };

  const onEvent = (e: TurnStreamEvent) => {
    if (e.type === "mechanics.line") out(dim(`  ⚄ ${e.line.text}`));
    if (e.type === "error") out(dim(`  ! ${e.message}`));
  };
  let pending: Clarification | null = null;

  const show = (r: TurnResult) => {
    while (notices.length) {
      const n = notices.shift()!;
      out(
        dim(`  (${n.from.provider} unavailable: ${n.reason}; ${n.role} is using ${n.to.provider} for now)`),
      );
    }
    if (r.status === "resolved" && r.narration) {
      out();
      out(renderNarration(r.narration, nameOf));
      for (const f of r.guard?.flagged ?? [])
        out(dim(`  ⚑ canon check: "${f.quote}" — ${f.detail} (use /reroll)`));
      if (r.guard && !r.guard.checked) out(dim("  (unchecked: the canon guard didn't answer)"));
    } else if (r.status === "clarify" && r.clarification) {
      pending = r.clarification;
      out();
      out(bold(r.clarification.question));
      r.clarification.options.forEach((o, i) => {
        out(`  ${i + 1}. ${o.label}`);
      });
      out(dim("  (type a number, or say something else)"));
    } else if (r.status === "ooc") {
      out(dim(r.answer ?? ""));
    } else if (r.status === "failed") {
      out(dim(`Turn failed: ${r.error}`));
    }
  };

  let last: TurnResult | null = null;
  const handle = async (line: string): Promise<boolean> => {
    const input = line.trim();
    if (!input) return true;
    if (input === "/quit" || input === "/exit") return false;
    if (input === "/help") {
      out(
        "Type what your character does. /where shows where you are, /reroll re-narrates the last turn, /quit leaves.",
      );
      return true;
    }
    if (input === "/where") {
      out(dim(where()));
      return true;
    }
    if (input === "/reroll") {
      if (last?.status !== "resolved") {
        out(dim("Nothing to reroll yet."));
        return true;
      }
      last = await pipeline.reroll(last.turnId, onEvent);
      show(last);
      return true;
    }
    const choice = pending && /^\d+$/.test(input) ? pending.options[Number(input) - 1] : undefined;
    pending = null;
    last = await pipeline.run({
      input: choice?.label ?? input,
      ...(choice?.actions ? { actions: choice.actions as never } : {}),
      onEvent,
    });
    show(last);
    return true;
  };

  out(bold(state.campaign.name));
  out(dim(where()));
  if (opts.inputs) {
    for (const line of opts.inputs) {
      out(`\n> ${line}`);
      if (!(await handle(line))) break;
    }
    return 0;
  }
  out(dim("Type what you do. /help for commands."));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const line = await rl.question("\n> ");
      if (!(await handle(line))) break;
    }
  } finally {
    rl.close();
  }
  return 0;
}

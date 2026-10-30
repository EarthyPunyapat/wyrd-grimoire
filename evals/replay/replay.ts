import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CompiledPack,
  defaultTuning,
  type GmTurnRecord,
  type MechanicsLine,
} from "../../packages/core/src/index.ts";
import { CORE_SKILL_CATALOG, type GameState, reduce } from "../../packages/engine/src/index.ts";
import {
  combatContent,
  LoreResearch,
  type RoleRouter,
  TurnPipeline,
  type TurnResult,
} from "../../packages/llm/src/index.ts";
import { skillCatalog } from "../../packages/packs/src/index.ts";
import { CampaignStore, CanonQueries, LoreCache } from "../../packages/storage/src/index.ts";
import { ReplaySetupError } from "./runtime.ts";

export type ReplayTurn = {
  ok: boolean;
  status: TurnResult["status"];
  narration: string;
  elapsedMs: number;
  gm?: GmTurnRecord;
  promptVersion?: string;
  mechanics: MechanicsLine[];
  checked: boolean;
  flags: { quote: string; claim: string }[];
  classicFallback: boolean;
  error?: string;
};

function houseStyle(home: string): string[] {
  const dir = join(home, "style", "house");
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => readFileSync(join(dir, name), "utf8").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export type ReplaySession = {
  store: CampaignStore<GameState>;
  run(input: string): Promise<ReplayTurn>;
};

/** One transcript, one fresh campaign copy. Only the temporary copy is ever migrated or appended. */
export async function withReplaySession<T>(
  o: { snapshot: Uint8Array; router: RoleRouter; home: string; tempRoot?: string },
  use: (session: ReplaySession) => Promise<T>,
): Promise<T> {
  if (!o.router.has("gm")) throw new ReplaySetupError("The replay requires a configured GM route.");
  const dir = mkdtempSync(join(o.tempRoot ?? tmpdir(), "wyrd-replay-"));
  let store: CampaignStore<GameState> | undefined;
  try {
    const path = join(dir, "campaign.db");
    writeFileSync(path, o.snapshot, { mode: 0o600 });
    store = CampaignStore.open<GameState>(path, { reduce });
    const game = store;
    const state = game.state();
    if (!state.party.pcId || !state.scene)
      throw new ReplaySetupError(
        "Prepare a campaign with a player character and opening scene before replaying.",
      );
    const canon = new CanonQueries(game);
    const pack = game.packSnapshot()?.content as CompiledPack | undefined;
    const pipeline = new TurnPipeline({
      store: game,
      canon,
      router: o.router,
      rules: {
        skills: pack ? skillCatalog([pack]) : CORE_SKILL_CATALOG,
        tuning: defaultTuning,
        classes: pack?.classes,
      },
      ...(pack ? { content: combatContent(pack) } : {}),
      lore: new LoreResearch({ router: o.router, cache: new LoreCache(o.home) }),
      tone: pack?.tone ?? "",
      worldBible: canon.entity("concept:world-bible")?.summary ?? "",
      styleExamples: houseStyle(o.home),
      newId: randomUUID,
      campaignId: game.campaignId,
    });
    return await use({
      store: game,
      async run(input) {
        const started = performance.now();
        const seq = game.branch(game.activeBranchId).head;
        let classicFallback = false;
        let result: TurnResult | undefined;
        try {
          result = await pipeline.run({
            input,
            onEvent: (e) => {
              if (e.type === "fallback") classicFallback = true;
            },
          });
          // The check can append stub entities: finish it before the next input or cleanup.
          await result.check;
        } catch {
          // Never retain upstream errors: adapters may include request text or authentication data.
        }
        const events = game.events(game.activeBranchId, seq + 1);
        const completed = events.find((e) => e.type === "TurnCompleted");
        const narration = events.find((e) => e.type === "NarrationCommitted");
        const check = events.find((e) => e.type === "CheckReported");
        const gm = completed?.type === "TurnCompleted" ? completed.payload.gm : undefined;
        const ok =
          result?.status === "resolved" &&
          Boolean(gm) &&
          Boolean(result.narration?.trim()) &&
          !classicFallback;
        return {
          ok,
          status: result?.status ?? "failed",
          narration: result?.narration ?? result?.answer ?? "",
          elapsedMs: Math.round(performance.now() - started),
          gm,
          promptVersion:
            narration?.type === "NarrationCommitted" ? narration.payload.promptVersion : undefined,
          mechanics: result?.mechanics ?? [],
          checked: Boolean(check),
          flags: check?.type === "CheckReported" ? check.payload.flags : [],
          classicFallback,
          ...(!ok
            ? { error: "GM turn did not complete normally; inspect model settings and the fallback status." }
            : {}),
        };
      },
    });
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

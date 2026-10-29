import { join } from "node:path";
import { ImportResult, RewindInput, SaveInput } from "@wyrd/core";
import { type GameState, reduce } from "@wyrd/engine";
import {
  type AppStore,
  branchesView,
  type CampaignStore,
  exportCampaign,
  importCampaign,
  rewindToTurn,
  StorageError,
  savesView,
  timelineView,
} from "@wyrd/storage";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { AppEnvironment } from "./app.ts";

type Deps = {
  home: string;
  now: () => number;
  campaign: (id: string) => CampaignStore<GameState>;
  store: AppStore;
  body: <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) => Promise<T>;
  running: (id: string) => boolean;
};

const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

/** Storage refusals become the API's status codes; hardcore is always a 409. */
function httpError(error: unknown): HTTPException {
  if (error instanceof HTTPException) return error;
  if (error instanceof StorageError) {
    if (error.code === "hardcore") return new HTTPException(409, { message: error.message });
    if (error.code === "not_found") return new HTTPException(404, { message: error.message });
    return new HTTPException(422, { message: error.message });
  }
  return new HTTPException(500, { message: "The request could not be completed" });
}

function filename(name: string): string {
  const safe = name
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safe || "campaign"}.wyrd`;
}

export function mountHistory(app: Hono<AppEnvironment>, d: Deps) {
  app.get("/api/campaigns/:id/timeline", (c) => {
    try {
      const branchId = c.req.query("branch");
      return c.json(timelineView(d.campaign(c.req.param("id")), branchId || undefined));
    } catch (error) {
      throw httpError(error);
    }
  });

  // Rewind to just before a turn's TurnStarted. Hardcore campaigns refuse with 409.
  app.post("/api/campaigns/:id/rewind", async (c) => {
    const id = c.req.param("id");
    const game = d.campaign(id);
    const input = await d.body(c, RewindInput);
    if (d.running(id)) throw new HTTPException(409, { message: "Wait for the current turn to finish" });
    try {
      rewindToTurn(game, input.turnId, input.label);
      return c.json(timelineView(game));
    } catch (error) {
      throw httpError(error);
    }
  });

  app.get("/api/campaigns/:id/branches", (c) => {
    try {
      return c.json(branchesView(d.campaign(c.req.param("id"))));
    } catch (error) {
      throw httpError(error);
    }
  });

  app.post("/api/campaigns/:id/branches/:branchId/activate", (c) => {
    const id = c.req.param("id");
    const game = d.campaign(id);
    if (d.running(id)) throw new HTTPException(409, { message: "Wait for the current turn to finish" });
    try {
      game.activateBranch(c.req.param("branchId"));
      return c.json(branchesView(game));
    } catch (error) {
      throw httpError(error);
    }
  });

  app.get("/api/campaigns/:id/saves", (c) => {
    try {
      return c.json(savesView(d.campaign(c.req.param("id"))));
    } catch (error) {
      throw httpError(error);
    }
  });

  app.post("/api/campaigns/:id/saves", async (c) => {
    const game = d.campaign(c.req.param("id"));
    const input = await d.body(c, SaveInput);
    try {
      game.saveAs(input.name);
      return c.json(savesView(game), 201);
    } catch (error) {
      throw httpError(error);
    }
  });

  app.post("/api/campaigns/:id/export", (c) => {
    const id = c.req.param("id");
    const game = d.campaign(id);
    try {
      const state = game.state();
      const archive = exportCampaign({
        dir: join(d.home, "campaigns", id),
        campaignId: id,
        name: state.campaign.name,
        characterName: state.actors[state.party.pcId ?? ""]?.sheet.identity.name ?? "",
        now: d.now,
      });
      c.header("Content-Type", "application/zip");
      c.header("Content-Disposition", `attachment; filename="${filename(state.campaign.name)}"`);
      const body = archive.buffer.slice(
        archive.byteOffset,
        archive.byteOffset + archive.byteLength,
      ) as ArrayBuffer;
      return c.body(body);
    } catch (error) {
      throw httpError(error);
    }
  });

  // Raw `.wyrd` bytes: the 16 KB JSON body limit in app.ts exempts this route.
  app.post("/api/campaigns/import", async (c) => {
    const length = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_IMPORT_BYTES)
      throw new HTTPException(413, { message: "This archive is too large to import" });
    const archive = new Uint8Array(await c.req.arrayBuffer());
    if (!archive.byteLength) throw new HTTPException(422, { message: "Choose a .wyrd archive to import" });
    try {
      const imported = importCampaign<GameState>({
        archive,
        campaignsDir: join(d.home, "campaigns"),
        reduce,
        now: d.now,
      });
      d.store.addCampaign({
        id: imported.id,
        name: imported.name,
        characterName: imported.characterName,
        updatedAt: new Date(d.now()).toISOString(),
      });
      return c.json(ImportResult.parse(imported), 201);
    } catch (error) {
      throw httpError(error);
    }
  });
}

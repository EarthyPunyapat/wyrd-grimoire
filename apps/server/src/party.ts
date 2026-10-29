import {
  AdvanceInput,
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  type CompiledPack,
  defaultTuning,
  ProgressionView,
} from "@wyrd/core";
import {
  buyAdvancement,
  type CreationContent,
  type GameState,
  type Purchase,
  priceOf,
  skillLabel,
  skillValue,
  unwrap,
  xpAvailable,
} from "@wyrd/engine";
import { creationContent } from "@wyrd/packs";
import type { CampaignStore } from "@wyrd/storage";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { AppEnvironment } from "./app.ts";

type Deps = {
  campaign: (id: string) => CampaignStore<GameState>;
  body: <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) => Promise<T>;
  running: (id: string) => boolean;
};

/** What each party member could buy now, priced by the engine (spec 04 spend UI). */
export function progressionView(state: GameState, content: CreationContent) {
  const members = [state.party.pcId, ...state.party.companionIds].flatMap((id) => {
    const actor = id ? state.actors[id] : undefined;
    if (!id || !actor || actor.dead) return [];
    const sheet = actor.sheet;
    const price = (purchase: Purchase) => {
      const p = priceOf(state, id, purchase, content, defaultTuning);
      return p.ok ? { cost: p.value.cost } : { cost: null, why: p.errors.map((e) => e.message).join("; ") };
    };
    return [
      {
        actorId: id,
        name: sheet.identity.name,
        role: actor.role === "pc" ? ("pc" as const) : ("companion" as const),
        xp: {
          earned: sheet.progression.xpEarned,
          spent: sheet.progression.xpSpent,
          available: xpAvailable(sheet),
        },
        pending: {
          attributes: sheet.progression.pendingAttributes,
          talents: sheet.progression.pendingTalents,
        },
        marks: sheet.progression.marks.map((s) => skillLabel(s, content.skills)),
        attributes: ATTRIBUTE_IDS.map((a) => ({
          id: a,
          name: ATTRIBUTE_NAMES[a],
          value: sheet.attributes[a],
          ...price({ kind: "attribute", id: a }),
        })),
        skills: Object.keys(sheet.skills).map((s) => ({
          id: s,
          name: skillLabel(s, content.skills),
          value: skillValue(sheet, s, content.skills, defaultTuning),
          ...price({ kind: "skill", id: s }),
        })),
        talents: Object.values(content.talents)
          .filter((t) => !sheet.talents.includes(t.id))
          .map((t) => ({
            id: t.id,
            name: t.name,
            tier: t.tier,
            description: t.description,
            ...price({ kind: "talent", id: t.id }),
          })),
        fieldSkills: Object.values(content.skills)
          .filter((s) => s.field)
          .map((s) => ({ id: s.id, name: s.name, ...price({ kind: "fieldSkill", id: `${s.id}/x` }) })),
      },
    ];
  });
  return ProgressionView.parse({ mode: state.campaign.settings.structural.progression, members });
}

export function mountParty(app: Hono<AppEnvironment>, d: Deps) {
  const content = (game: CampaignStore<GameState>) =>
    creationContent([game.packSnapshot()!.content as CompiledPack]);
  app.get("/api/campaigns/:id/progression", (c) => {
    const game = d.campaign(c.req.param("id"));
    return c.json(progressionView(game.state(), content(game)));
  });
  // Spending XP (spec 04): the engine prices and validates; the purchase is one event.
  app.post("/api/campaigns/:id/advance", async (c) => {
    const id = c.req.param("id");
    if (d.running(id)) throw new HTTPException(409, { message: "Wait for the current turn to finish" });
    const game = d.campaign(id);
    const input = await d.body(c, AdvanceInput);
    if (game.state().combat) throw new HTTPException(409, { message: "Not in the middle of a fight" });
    const result = buyAdvancement(
      game.state(),
      input.actorId,
      { kind: input.kind, id: input.id },
      content(game),
      defaultTuning,
    );
    if (!result.ok) throw new HTTPException(422, { message: result.errors.map((e) => e.message).join("; ") });
    game.append(unwrap(result));
    return c.json(progressionView(game.state(), content(game)));
  });
}

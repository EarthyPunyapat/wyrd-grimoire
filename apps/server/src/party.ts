import {
  AdvanceInput,
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  type CharacterSheet,
  CompanionControlInput,
  type CompiledPack,
  defaultTuning,
  draft,
  type Entity,
  type EventDraft,
  ProgressionView,
} from "@wyrd/core";
import {
  buyAdvancement,
  type CreationContent,
  draftFromArchetype,
  type GameState,
  type Purchase,
  priceOf,
  sheetFromDraft,
  skillLabel,
  skillValue,
  unwrap,
  xpAvailable,
} from "@wyrd/engine";
import { generateCompanionProfile, offlineCompanionProfile, type RoleRouter } from "@wyrd/llm";
import { creationContent } from "@wyrd/packs";
import type { CampaignStore } from "@wyrd/storage";
import { CanonQueries } from "@wyrd/storage";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { AppEnvironment } from "./app.ts";

type Deps = {
  campaign: (id: string) => CampaignStore<GameState>;
  body: <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) => Promise<T>;
  running: (id: string) => boolean;
};

const t = defaultTuning.companions.thresholds;
/** Approval as a word (spec 04: a word and a bar; the number only with "Show the math"). */
export const approvalWord = (approval: number) =>
  approval >= t.loyal
    ? "Loyal"
    : approval >= t.quest
      ? "Trusting"
      : approval > 10
        ? "Friendly"
        : approval >= -10
          ? "Neutral"
          : approval > t.confront
            ? "Uneasy"
            : "Close to leaving";

function companionSummary(c: GameState["companions"][string]) {
  return {
    approval: c.approval,
    mood: approvalWord(c.approval),
    control: c.control,
    directive: c.directive,
    values: c.profile?.values ?? [],
    likes: c.profile?.likes ?? [],
    dislikes: c.profile?.dislikes ?? [],
    loyal: c.loyal,
  };
}

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
          // Sheets saved before M6 lack the use-based counters.
          attributes: sheet.progression.pendingAttributes ?? 0,
          talents: sheet.progression.pendingTalents ?? 0,
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
        ...(state.companions?.[id] ? { companion: companionSummary(state.companions[id]!) } : {}),
      },
    ];
  });
  const former = Object.values(state.companions ?? {}).flatMap((c) =>
    c.status === "active"
      ? []
      : [{ name: state.actors[c.id]?.sheet.identity.name ?? c.id, status: c.status }],
  );
  return ProgressionView.parse({ mode: state.campaign.settings.structural.progression, members, former });
}

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);

/**
 * A full sheet for a recruited NPC (spec 04: companions use full sheets): the pack background whose
 * description best matches who they are, at the creation budget, under their own name.
 */
export function recruitSheet(
  pack: CompiledPack,
  entity: Entity | null,
  id: string,
  settings: GameState["campaign"]["settings"],
): CharacterSheet | null {
  if (entity?.kind !== "npc") return null;
  const content = creationContent([pack]);
  const archetypes = Object.values(content.archetypes);
  const ancestry = Object.keys(pack.ancestries)[0];
  if (!archetypes.length || !ancestry) return null;
  const about = words(`${entity.summary} ${String((entity.data as { role?: string }).role ?? "")}`);
  const score = (a: (typeof archetypes)[number]) =>
    [...words(`${a.name} ${a.description}`)].filter((w) => about.has(w)).length;
  const fallback = archetypes[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % archetypes.length]!;
  const best = archetypes.reduce((top, a) => (score(a) > score(top) ? a : top), fallback);
  const draftSheet = {
    ...draftFromArchetype(ancestry, best, entity.name),
    background: entity.summary || best.description,
  };
  return sheetFromDraft(id, draftSheet, content, pack.items, settings, defaultTuning);
}

/** Profiles for companions who joined without one: the worldGen role, or the offline stand-in. */
export async function profileNewCompanions(
  game: CampaignStore<GameState>,
  router: RoleRouter | null,
): Promise<void> {
  const state = game.state();
  const canon = new CanonQueries(game);
  const drafts: EventDraft[] = [];
  for (const c of Object.values(state.companions ?? {})) {
    if (c.profile || c.status !== "active") continue;
    const name = state.actors[c.id]?.sheet.identity.name ?? c.id;
    const entity = canon.entity(c.id);
    const profile = router
      ? await generateCompanionProfile(
          router,
          {
            world: {
              name: canon.entity("concept:world-bible")?.name ?? "",
              premise: canon.entity("concept:world-bible")?.summary ?? "",
            },
            companion: {
              name,
              summary: entity?.summary ?? "",
              facts: canon
                .factsAbout(c.id)
                .filter((f) => f.visibility === "public")
                .map(
                  (f) => `${f.predicate}: ${typeof f.value === "string" ? f.value : JSON.stringify(f.value)}`,
                )
                .slice(0, 12),
            },
            reason: c.reason,
          },
          state.campaign.settings.content,
        ).catch(() => offlineCompanionProfile(name))
      : offlineCompanionProfile(name);
    drafts.push(draft("CompanionProfiled", { companionId: c.id, profile }, "engine"));
  }
  if (drafts.length) game.append(drafts);
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
    const game = d.campaign(id);
    const input = await d.body(c, AdvanceInput);
    // Checked after the body arrives, so a turn can't start in between.
    if (d.running(id)) throw new HTTPException(409, { message: "Wait for the current turn to finish" });
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
  // Companion control and directives (spec 04): AI with a standing order, or manual.
  app.put("/api/campaigns/:id/companions/:companionId", async (c) => {
    const id = c.req.param("id");
    const game = d.campaign(id);
    const companionId = c.req.param("companionId");
    const input = await d.body(c, CompanionControlInput);
    if (d.running(id)) throw new HTTPException(409, { message: "Wait for the current turn to finish" });
    // Who takes orders is fixed when a fight starts.
    if (game.state().combat) throw new HTTPException(409, { message: "Change orders between fights" });
    if (game.state().companions?.[companionId]?.status !== "active")
      throw new HTTPException(404, { message: "No such companion in the party" });
    game.append([draft("CompanionControlSet", { companionId, ...input }, "player")]);
    return c.json(progressionView(game.state(), content(game)));
  });
}

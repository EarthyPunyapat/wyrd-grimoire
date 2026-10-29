import {
  CampaignSettings,
  type CharacterSheet,
  type CompiledPack,
  CreationView,
  DraftSheet,
  defaultTuning,
  InterviewAnswer,
  InterviewState,
  InterviewView,
  SuggestInput,
  WorldBible,
  WorldPitch,
  WorldProposal,
} from "@wyrd/core";
import {
  applyProposals,
  type CreationIssue,
  draftFromArchetype,
  draftFromPregen,
  sheetFromDraft,
  skillValue,
  validateCreation,
} from "@wyrd/engine";
import {
  interviewStep,
  offlineInterviewStep,
  offlineSuggestion,
  type RoleRouter,
  type SessionZeroContext,
  suggestField,
} from "@wyrd/llm";
import { compileGeneratedWorld, creationContent } from "@wyrd/packs";
import type { AppStore } from "@wyrd/storage";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnvironment } from "./app.ts";

/** A pitch-first creation draft (spec 04): the generated world, then the character being built. */
export const StoredDraft = z.object({
  input: WorldPitch,
  proposal: WorldProposal,
  /** Stage 1 world bible (M5); drafts from before M5 have none and start as a single site. */
  bible: WorldBible.optional(),
  offline: z.boolean(),
  campaignId: z.string().optional(),
  /** The character as the sheet editor last saved it; absent until the player opens the editor. */
  sheet: DraftSheet.optional(),
  /** The session-zero interview, if the player chose that path. */
  interview: InterviewState.optional(),
});
export type StoredDraft = z.infer<typeof StoredDraft>;

/** Creation is validated against default settings: the campaign's own don't exist yet. */
export const CREATION_SETTINGS = CampaignSettings.parse({});

export function creationOptions(pack: CompiledPack, originLabel: CreationView["options"]["originLabel"]) {
  const content = creationContent([pack]);
  return {
    originLabel,
    ancestries: Object.values(pack.ancestries).map(({ id, name, description, attributeMaxBonus }) => ({
      id,
      name,
      description,
      attributeMaxBonus,
    })),
    archetypes: Object.values(pack.archetypes).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      talent: a.talent,
      backstoryPrompts: a.backstoryPrompts,
      suggestedAttributes: a.suggestedAttributes,
      skills: a.skills,
    })),
    talents: Object.values(pack.talents).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      tier: t.tier,
      requires: [
        ...Object.entries(t.prerequisites.attributes).map(([a, v]) => `${a.toUpperCase()} ${v}`),
        ...Object.entries(t.prerequisites.skills).map(
          ([s, v]) => `${content.skills[s.split("/")[0]!]?.name ?? s} ${v}%`,
        ),
        ...t.prerequisites.talents.map((r) => pack.talents[r]?.name ?? r),
      ],
    })),
    skills: Object.values(content.skills).map(({ id, name, attributes, field }) => ({
      id,
      name,
      attributes,
      field,
    })),
    pregens: Object.values(pack.pregens).map((p) => ({
      id: p.id,
      name: p.name,
      summary:
        `${pack.ancestries[p.ancestry]?.name ?? ""} ${pack.archetypes[p.archetype]?.name ?? ""}`.trim(),
    })),
    budget: defaultTuning.creation,
  };
}

/** Builds and validates a draft: the sheet editor's whole state. */
export function evaluateDraft(
  draft: DraftSheet,
  pack: CompiledPack,
  id = "pc",
  settings: CampaignSettings = CREATION_SETTINGS,
): { sheet: CharacterSheet; issues: CreationIssue[] } {
  const content = creationContent([pack]);
  const sheet = sheetFromDraft(id, draft, content, pack.items, settings, defaultTuning);
  const issues = validateCreation(sheet, content, settings, defaultTuning);
  if (!draft.name.trim())
    issues.push({
      code: "NAME_MISSING",
      path: "name",
      message: "Give your character a name",
      severity: "error",
    });
  return { sheet, issues };
}

export function creationView(
  draft: DraftSheet,
  pack: CompiledPack,
  originLabel: CreationView["options"]["originLabel"],
) {
  const { sheet, issues } = evaluateDraft(draft, pack);
  const catalog = creationContent([pack]).skills;
  const skillValues: Record<string, number> = {};
  for (const id of Object.keys(draft.skills)) {
    try {
      skillValues[id] = skillValue(sheet, id, catalog, defaultTuning);
    } catch {
      // An unknown skill is reported by the validator.
    }
  }
  return CreationView.parse({
    draft,
    preview: sheet,
    issues,
    skillValues,
    options: creationOptions(pack, originLabel),
  });
}

/** The draft a pack pregen starts from, or a 422 if it doesn't exist. */
export function pregenDraft(pack: CompiledPack, pregenId: string): DraftSheet {
  const id = pregenId.includes(":") ? pregenId : `${pack.manifest.id}:${pregenId}`;
  const pregen = pack.pregens[id];
  const archetype = pregen && creationContent([pack]).archetypes[pregen.archetype];
  if (!pregen || !archetype) throw new HTTPException(422, { message: "That character isn't available" });
  return draftFromPregen(pregen, archetype);
}

type Deps = {
  store: AppStore;
  body: <T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) => Promise<T>;
  /** The model router, or null offline (the labelled stand-ins answer instead). */
  router: () => RoleRouter | null;
};

export function mountCreation(app: Hono<AppEnvironment>, d: Deps) {
  const load = (id: string) => {
    const saved = StoredDraft.safeParse(d.store.creationDraft(id));
    if (!saved.success)
      throw new HTTPException(404, { message: "World draft not found. Generate your world first." });
    return { saved: saved.data, pack: compileGeneratedWorld(saved.data.proposal).pack };
  };
  const view = (saved: StoredDraft, pack: CompiledPack, draft: DraftSheet) =>
    creationView(draft, pack, saved.proposal.originLabel);
  const current = (saved: StoredDraft, pack: CompiledPack) =>
    saved.sheet ??
    draftFromArchetype(
      Object.keys(pack.ancestries)[0]!,
      Object.values(creationContent([pack]).archetypes)[0]!,
      saved.input.characterName || saved.proposal.suggestedCharacterName,
    );
  const context = (saved: StoredDraft, pack: CompiledPack, draft: DraftSheet): SessionZeroContext => ({
    world: { name: saved.proposal.worldName, premise: saved.proposal.premise, tone: saved.proposal.tone },
    options: creationOptions(pack, saved.proposal.originLabel),
    draft,
  });
  const apply = (pack: CompiledPack, draft: DraftSheet, proposals: Parameters<typeof applyProposals>[1]) =>
    applyProposals(draft, proposals, creationContent([pack]), pack.items, CREATION_SETTINGS, defaultTuning);
  const busy = new Set<string>();
  /** One model call per draft at a time. */
  async function exclusive<T>(id: string, run: () => Promise<T>): Promise<T> {
    if (busy.has(id)) throw new HTTPException(409, { message: "Still thinking about the last answer" });
    busy.add(id);
    try {
      return await run();
    } finally {
      busy.delete(id);
    }
  }
  /**
   * Saves what a model call produced, unless the draft changed while it ran: an edit made meanwhile
   * would be lost, and a campaign started meanwhile must keep its id.
   */
  const saveAfterCall = (id: string, before: StoredDraft, patch: Partial<StoredDraft>) => {
    const now = load(id).saved;
    if (now.campaignId) throw new HTTPException(409, { message: "This campaign has already started" });
    if (JSON.stringify(now.sheet) !== JSON.stringify(before.sheet))
      throw new HTTPException(409, { message: "Your sheet changed while this was thinking. Try again." });
    d.store.saveCreationDraft(id, { ...now, ...patch });
  };
  const unavailable = () =>
    new HTTPException(502, {
      message: "The interviewer couldn't answer. Try again, or check model settings.",
    });

  // The sheet editor (spec 04): every creation path ends here, and the validator is the only gate.
  app.get("/api/world-drafts/:id/creation", (c) => {
    const { saved, pack } = load(c.req.param("id"));
    return c.json(view(saved, pack, current(saved, pack)));
  });
  app.put("/api/world-drafts/:id/sheet", async (c) => {
    const id = c.req.param("id");
    const draft = await d.body(c, DraftSheet);
    const { saved, pack } = load(id);
    if (saved.campaignId) throw new HTTPException(409, { message: "This campaign has already started" });
    d.store.saveCreationDraft(id, { ...saved, sheet: draft });
    return c.json(view(saved, pack, draft));
  });

  // Session zero (spec 04): each answer gets one interviewer step; the engine applies what fits.
  app.post("/api/world-drafts/:id/interview", async (c) => {
    const id = c.req.param("id");
    const { answer } = await d.body(c, InterviewAnswer);
    return exclusive(id, async () => {
      const { saved, pack } = load(id);
      if (saved.campaignId) throw new HTTPException(409, { message: "This campaign has already started" });
      const router = d.router();
      const before = saved.interview ?? InterviewState.parse({ offline: !router });
      if (!answer && before.messages.length)
        return c.json(
          InterviewView.parse({ interview: before, creation: view(saved, pack, current(saved, pack)) }),
        );
      const interview = {
        ...before,
        messages: [...before.messages, ...(answer ? [{ from: "player" as const, text: answer }] : [])],
      };
      const draft = current(saved, pack);
      const ctx = context(saved, pack, draft);
      const step = router
        ? await interviewStep(router, ctx, interview).catch(() => {
            throw unavailable();
          })
        : offlineInterviewStep(ctx, interview);
      const applied = apply(pack, draft, step.proposals);
      const next = InterviewState.parse({
        ...interview,
        messages: [...interview.messages, { from: "interviewer", text: step.message }],
        done: step.done,
        refused: applied.refused,
      });
      saveAfterCall(id, saved, { sheet: applied.draft, interview: next });
      return c.json(InterviewView.parse({ interview: next, creation: view(saved, pack, applied.draft) }));
    });
  });
  // The form wizard's "suggest" buttons (spec 04): one field per call.
  app.post("/api/world-drafts/:id/suggest", async (c) => {
    const id = c.req.param("id");
    const { field } = await d.body(c, SuggestInput);
    return exclusive(id, async () => {
      const { saved, pack } = load(id);
      if (saved.campaignId) throw new HTTPException(409, { message: "This campaign has already started" });
      const router = d.router();
      const draft = current(saved, pack);
      const ctx = context(saved, pack, draft);
      const proposals = router
        ? await suggestField(router, ctx, field).catch(() => {
            throw new HTTPException(502, {
              message: "No suggestion this time. Try again, or check model settings.",
            });
          })
        : offlineSuggestion(ctx, field);
      const applied = apply(pack, draft, proposals);
      saveAfterCall(id, saved, { sheet: applied.draft });
      return c.json(view(saved, pack, applied.draft));
    });
  });
}

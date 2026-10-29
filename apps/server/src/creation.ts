import {
  CampaignSettings,
  type CharacterSheet,
  type CompiledPack,
  CreationView,
  DraftSheet,
  defaultTuning,
  WorldBible,
  WorldPitch,
  WorldProposal,
} from "@wyrd/core";
import {
  type CreationIssue,
  draftFromArchetype,
  draftFromPregen,
  sheetFromDraft,
  skillValue,
  validateCreation,
} from "@wyrd/engine";
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

  // The sheet editor (spec 04): every creation path ends here, and the validator is the only gate.
  app.get("/api/world-drafts/:id/creation", (c) => {
    const { saved, pack } = load(c.req.param("id"));
    const archetype = Object.values(creationContent([pack]).archetypes)[0]!;
    const draft =
      saved.sheet ??
      draftFromArchetype(
        Object.keys(pack.ancestries)[0]!,
        archetype,
        saved.input.characterName || saved.proposal.suggestedCharacterName,
      );
    return c.json(view(saved, pack, draft));
  });
  app.put("/api/world-drafts/:id/sheet", async (c) => {
    const id = c.req.param("id");
    const { saved, pack } = load(id);
    if (saved.campaignId) throw new HTTPException(409, { message: "This campaign has already started" });
    const draft = await d.body(c, DraftSheet);
    d.store.saveCreationDraft(id, { ...saved, sheet: draft });
    return c.json(view(saved, pack, draft));
  });
}

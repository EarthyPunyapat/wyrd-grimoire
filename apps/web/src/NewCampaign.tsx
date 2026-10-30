import {
  CampaignImport,
  type CampaignPreset,
  type CampaignSettings,
  CharacterCard,
  CreatedCampaign,
  CreationReview,
  CreationView,
  DraftResume,
  GeneratedWorldPreview,
  presetSelection,
  SavedWorldMeta,
  StartGeneratedCampaign,
  type SuggestField,
  WorldPitch,
  WorldSetup,
} from "@wyrd/core";
import { useEffect, useRef, useState } from "react";
import { api, streamApi } from "./api.ts";
import { CharacterArrival } from "./CharacterArrival.tsx";
import { type ChooserValue, CreationChooser, type ManageAction } from "./CreationChooser.tsx";
import { CreationReviewEditor } from "./CreationReview.tsx";
import { ImportPanel } from "./ImportPanel.tsx";
import { Interview } from "./Interview.tsx";
import { type Section, SheetEditor, withArchetype } from "./SheetEditor.tsx";
import { useCreation } from "./use-creation.ts";

/** The form path (spec 04): archetype → attributes → skills → talents → gear → looks and backstory. */
const STEPS: { title: string; sections: Section[] }[] = [
  { title: "Who they are", sections: ["who"] },
  { title: "Attributes", sections: ["attributes"] },
  { title: "Skills", sections: ["skills"] },
  { title: "Talents and gear", sections: ["talents", "gear"] },
  { title: "Looks and backstory", sections: ["looks"] },
  { title: "Hooks", sections: ["hooks"] },
];
type Mode = "review" | "editor" | "wizard" | "interview";
type DraftProgressStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
};
const DRAFT_KEY = "wyrd-new-campaign";
const INITIAL_STEPS: DraftProgressStep[] = [
  { key: "read", label: "Reading your description", status: "running" },
  { key: "world", label: "Generating the setting and opening scene", status: "pending" },
  { key: "bible", label: "Building the wider world", status: "pending" },
  { key: "validate", label: "Checking places, people and rules", status: "pending" },
  { key: "save", label: "Saving your draft", status: "pending" },
];
const STEP_ICON: Record<DraftProgressStep["status"], string> = {
  pending: "○",
  running: "…",
  done: "✓",
  failed: "✗",
};
function loadSavedDraft(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    // A drafted world already lives in the server's draft library; do not silently revive it here.
    return saved.draftId ? null : saved;
  } catch {
    return null;
  }
}

/** Elapsed seconds for the job in flight; progress has to be visible, not a frozen sentence. */
function Elapsed({ active }: { active: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!active || seconds < 1) return null;
  return <span className="creation-elapsed">{seconds}s</span>;
}

export function NewCampaign({
  onCreate,
  offline,
  draftId,
  onOpenSettings,
}: {
  onCreate: (id: string) => void;
  offline: boolean;
  draftId?: string;
  onOpenSettings?: () => void;
}) {
  const [choosing, setChoosing] = useState(!draftId);
  const [choice, setChoice] = useState<ChooserValue>({ cardId: null, setup: null, worldId: null });
  const [cards, setCards] = useState<CharacterCard[]>([]);
  const [setups, setSetups] = useState<WorldSetup[]>([]);
  const [worlds, setWorlds] = useState<SavedWorldMeta[]>([]);
  const [adapting, setAdapting] = useState(false);
  const [adapted, setAdapted] = useState<CampaignImport["pc"] | null>(null);
  const [libraryNote, setLibraryNote] = useState("");
  const card = cards.find((c) => c.id === choice.cardId);
  async function loadLibrary() {
    const [cards, setups, worlds] = await Promise.all([
      api("/character-cards", CharacterCard.array().parse),
      api("/world-setups", WorldSetup.array().parse),
      api("/worlds", SavedWorldMeta.array().parse),
    ]);
    setCards(cards);
    setSetups(setups);
    setWorlds(worlds);
  }
  useEffect(() => {
    void loadLibrary().catch((e) => setError(e.message));
  }, []);
  const [saved] = useState(() => (draftId ? null : loadSavedDraft()));
  const restoredWorld = saved?.world ? GeneratedWorldPreview.safeParse(saved.world) : null;
  const [name, setName] = useState(typeof saved?.name === "string" ? saved.name : "");
  const [imported, setImported] = useState<CampaignImport | null>(null);
  const [characterName, setCharacterName] = useState(
    typeof saved?.characterName === "string" ? saved.characterName : "",
  );
  const [sourceTitle, setSourceTitle] = useState(
    typeof saved?.sourceTitle === "string" ? saved.sourceTitle : "",
  );
  const [sourceMode, setSourceMode] = useState(
    Boolean(typeof saved?.sourceTitle === "string" && saved.sourceTitle),
  );
  const [sourceWiki, setSourceWiki] = useState(
    typeof saved?.sourceWiki === "string" ? saved.sourceWiki : "en.wikipedia.org",
  );
  const [review, setReview] = useState<CreationReview | undefined>(() => {
    const parsed = CreationReview.safeParse(
      saved?.review ?? (restoredWorld?.success ? restoredWorld.data.review : undefined),
    );
    return parsed.success ? parsed.data : undefined;
  });
  const [pitch, setPitch] = useState(typeof saved?.pitch === "string" ? saved.pitch : "");
  const [world, setWorld] = useState<GeneratedWorldPreview | undefined>(
    restoredWorld?.success ? restoredWorld.data : undefined,
  );
  const [ancestry, setAncestry] = useState(typeof saved?.ancestry === "string" ? saved.ancestry : "");
  const [archetype, setArchetype] = useState(typeof saved?.archetype === "string" ? saved.archetype : "");
  // A sheet opened in the editor stays the character's truth through the review step.
  const [customSheet, setCustomSheet] = useState(saved?.customSheet === true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState("");
  const [revising, setRevising] = useState(false);
  const [resuming, setResuming] = useState(Boolean(draftId));
  const [mode, setMode] = useState<Mode>(
    saved?.mode === "editor" || saved?.mode === "wizard" || saved?.mode === "interview"
      ? saved.mode
      : "review",
  );
  const [progression, setProgression] = useState<CampaignSettings["structural"]["progression"]>(
    (saved?.progression as CampaignSettings["structural"]["progression"]) ?? "classless",
  );
  const [preset, setPreset] = useState<CampaignPreset>((saved?.preset as CampaignPreset) ?? "standard");
  const [storyMode, setStoryMode] = useState<"threatClock" | "livingWorld">(
    saved?.storyMode === "livingWorld" ? "livingWorld" : "threatClock",
  );
  const [resolution, setResolution] = useState<"d100" | "d20">(saved?.resolution === "d20" ? "d20" : "d100");
  const [hardcore, setHardcore] = useState(saved?.hardcore === true);
  const [step, setStep] = useState(typeof saved?.step === "number" ? saved.step : 0);
  const [steps, setSteps] = useState<DraftProgressStep[]>(
    Array.isArray(saved?.steps) ? (saved.steps as DraftProgressStep[]) : [],
  );
  const errorBox = useRef<HTMLDivElement>(null);

  // A long review can hide a failure below the fold; bring the message into view when it lands.
  useEffect(() => {
    if (!error) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    errorBox.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  }, [error]);

  // Resume a draft from the server-side library: world, review and sheet all come back together.
  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    setResuming(true);
    setError("");
    void api(`/world-drafts/${draftId}`, DraftResume.parse)
      .then((resumed) => {
        if (cancelled) return;
        setChoice({ cardId: resumed.card?.id ?? null, setup: null, worldId: null });
        setAdapted(resumed.card?.adapted ?? null);
        setWorld(resumed.preview);
        setReview(resumed.review ?? resumed.preview.review);
        setName(resumed.preview.name);
        setPitch(resumed.pitch);
        setCharacterName(resumed.characterName);
        setSourceMode(Boolean(resumed.preview.source?.title));
        setSourceTitle(resumed.preview.source?.title ?? "");
        setSourceWiki(resumed.preview.source?.wiki ?? "en.wikipedia.org");
        setAncestry(resumed.preview.origins[0]?.id ?? "");
        setArchetype(resumed.preview.backgrounds[0]?.id ?? "");
        setProgression(resumed.preview.progressions[0] ?? "classless");
        setCustomSheet(resumed.hasSheet);
        if (resumed.review) {
          setResolution(resumed.review.resolution);
          setHardcore(resumed.review.hardcore);
          setPreset("custom");
        }
        setMode("review");
        setSteps([]);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setResuming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  // Serialize per-field proposal saves so closing/resuming on another device keeps the latest edit.
  const cardSave = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!world || !choice.cardId) return;
    const selected = { id: choice.cardId, ...(adapted ? { adapted } : {}) };
    cardSave.current = cardSave.current
      .catch(() => undefined)
      .then(() => api(`/world-drafts/${world.id}/card`, (x) => x, selected, "PUT"));
    void cardSave.current.catch((e) => setError((e as Error).message));
  }, [world?.id, choice.cardId, adapted]);

  // Keep the unfinished creation on this device, so closing the dialog or the tab loses nothing.
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          name,
          characterName,
          pitch,
          sourceTitle,
          sourceWiki,
          review,
          world,
          ancestry,
          archetype,
          customSheet,
          progression,
          preset,
          storyMode,
          resolution,
          hardcore,
          mode,
          step,
          steps,
          draftId: world?.id ?? null,
        }),
      );
    } catch {
      // Storage can be full or disabled; creation still works for this visit.
    }
  }, [
    name,
    characterName,
    pitch,
    sourceTitle,
    sourceWiki,
    review,
    world,
    ancestry,
    archetype,
    customSheet,
    progression,
    preset,
    storyMode,
    resolution,
    hardcore,
    mode,
    step,
    steps,
  ]);
  const creation = useCreation(world?.id);
  const editing = mode !== "review";
  const blocked =
    mode === "editor" && (!creation.view || creation.view.issues.some((i) => i.severity === "error"));
  const doneSteps = steps.filter((s) => s.status === "done").length;

  /** Opens the sheet (editor or wizard) on the saved draft, carrying over the quick picks and name. */
  async function customise(next: Mode) {
    if (!world) return;
    setBusy(true);
    setBusyNote("Opening your character sheet…");
    try {
      const view = await api(`/world-drafts/${world.id}/creation`, CreationView.parse);
      let draft =
        view.draft.archetype === archetype ? view.draft : withArchetype(view.draft, view, archetype);
      draft = { ...draft, ancestry, name: characterName.trim() || draft.name };
      creation.setView(view);
      await creation.save(draft);
      setStep(0);
      setCustomSheet(true);
      setMode(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyNote("");
    }
  }

  async function suggest(field: SuggestField) {
    if (!world) return;
    setBusy(true);
    setBusyNote("Asking for a suggestion…");
    try {
      await creation.flush();
      creation.setView(await api(`/world-drafts/${world.id}/suggest`, CreationView.parse, { field }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyNote("");
    }
  }

  /** The style sample's “More like…” loop: one model revision, with its own progress and error. */
  async function reviseSample() {
    if (!world || !review) return;
    setRevising(true);
    setError("");
    setDetail("");
    try {
      const next = await api(`/world-drafts/${world.id}/style`, CreationReview.parse, review.style);
      setReview((previous) => (previous ? { ...previous, style: next.style } : next));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRevising(false);
    }
  }

  function selectChoice(next: ChooserValue) {
    setChoice(next);
    setAdapted(null);
    setImported(null);
    if (next.setup) {
      const v = next.setup;
      setName(v.name);
      setPitch(v.pitch);
      setSourceMode(Boolean(v.source));
      setSourceTitle(v.source?.title ?? "");
      setSourceWiki(v.source?.wiki ?? "en.wikipedia.org");
      setPreset(v.rules.preset ?? "standard");
      setStoryMode(v.rules.storyMode ?? "threatClock");
      setResolution(v.rules.resolution ?? "d100");
      setHardcore(v.rules.hardcore ?? false);
      setProgression(v.rules.progression ?? "classless");
    }
  }
  async function manage(action: ManageAction) {
    setBusy(true);
    setError("");
    try {
      const base =
        action.kind === "setup" ? "world-setups" : action.kind === "card" ? "character-cards" : "worlds";
      if (action.action === "delete") {
        await api(`/${base}/${action.id}`, (x) => x, undefined, "DELETE");
        if (action.id === choice.cardId) setChoice((v) => ({ ...v, cardId: null }));
        if (action.id === choice.setup?.id) setChoice((v) => ({ ...v, setup: null }));
        if (action.id === choice.worldId) setChoice((v) => ({ ...v, worldId: null }));
      } else if (action.action === "rename") {
        const fresh = await api(
          `/${base}/${action.id}`,
          (x) => x,
          { [action.kind === "card" ? "title" : "name"]: action.name },
          "PATCH",
        );
        if (action.kind === "setup" && action.id === choice.setup?.id)
          selectChoice({ ...choice, setup: WorldSetup.parse(fresh) });
      } else if (action.kind === "world") await api(`/worlds/${action.id}/duplicate`, (x) => x, {});
      else if (action.kind === "setup") {
        const old = setups.find((s) => s.id === action.id)!;
        await api("/world-setups", WorldSetup.parse, { ...old, name: `${old.name.slice(0, 75)} copy` });
      } else {
        const old = cards.find((c) => c.id === action.id)!;
        await api("/character-cards", CharacterCard.parse, {
          ...old,
          title: `${old.title.slice(0, 75)} copy`,
        });
      }
      await loadLibrary();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function applyResume(resumed: ReturnType<typeof DraftResume.parse>) {
    setWorld(resumed.preview);
    setReview(resumed.review ?? resumed.preview.review);
    setName(resumed.preview.name);
    setPitch(resumed.pitch);
    setCharacterName(resumed.characterName);
    setAncestry(resumed.preview.origins[0]!.id);
    setArchetype(resumed.preview.backgrounds[0]!.id);
    setCustomSheet(false);
    setSourceMode(Boolean(resumed.preview.source));
    setSourceTitle(resumed.preview.source?.title ?? "");
    setSourceWiki(resumed.preview.source?.wiki ?? "en.wikipedia.org");
    if (resumed.review) {
      setResolution(resumed.review.resolution);
      setHardcore(resumed.review.hardcore);
      setPreset("custom");
    }
  }
  async function startCampaign(w: GeneratedWorldPreview, r: CreationReview | undefined, quick = false) {
    await cardSave.current;
    if (!quick && (mode === "editor" || customSheet)) await creation.flush();
    const created = await api(
      "/campaigns",
      CreatedCampaign.parse,
      StartGeneratedCampaign.parse({
        draftId: w.id,
        review: r,
        ...(!quick && (mode === "editor" || customSheet)
          ? {}
          : {
              ancestry: quick ? w.origins[0]!.id : ancestry,
              archetype: quick ? w.backgrounds[0]!.id : archetype,
              characterName: quick ? "" : characterName,
            }),
        preset,
        storyMode,
        resolution: r?.resolution ?? resolution,
        hardcore: r?.hardcore ?? hardcore,
        progression,
        ...(card
          ? { card: { id: card.id, ...(adapted ? { adapted } : {}) } }
          : imported
            ? { import: imported }
            : {}),
      }),
    );
    localStorage.removeItem(DRAFT_KEY);
    onCreate(created.id);
  }
  async function continueChoice(next = choice, quick = false) {
    setChoosing(false);
    setError("");
    if (next.worldId) {
      setBusy(true);
      setBusyNote("Opening your saved world…");
      try {
        const { draftId } = await api(`/worlds/${next.worldId}/draft`, (x) => x as { draftId: string }, {});
        const resumed = await api(`/world-drafts/${draftId}`, DraftResume.parse);
        applyResume(resumed);
        if (quick) await startCampaign(resumed.preview, resumed.review, true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
        setBusyNote("");
      }
    } else if (quick) await submitCreation(true);
  }
  async function vary() {
    setBusy(true);
    setBusyNote("Finding a fresh twist…");
    setError("");
    try {
      const result = await api("/world-setups/vary", (x) => x as { pitch: string }, {
        pitch,
        ...(sourceMode ? { source: { title: sourceTitle, wiki: sourceWiki } } : {}),
      });
      setPitch(result.pitch);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setBusyNote("");
    }
  }
  async function adapt() {
    if (!world || !card) return;
    setBusy(true);
    setAdapting(true);
    setBusyNote("Adapting your character…");
    setError("");
    try {
      const result = await api(
        `/character-cards/${card.id}/adapt`,
        (x) => CampaignImport.shape.pc.parse((x as { pc: unknown }).pc),
        { draftId: world.id },
      );
      setAdapted(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdapting(false);
      setBusy(false);
      setBusyNote("");
    }
  }
  async function saveSetup() {
    setBusy(true);
    setLibraryNote("");
    setError("");
    try {
      await api("/world-setups", WorldSetup.parse, {
        name,
        pitch,
        source: sourceMode ? { title: sourceTitle, wiki: sourceWiki } : undefined,
        rules: { preset, storyMode, resolution, hardcore, progression },
        review: review ? { ...review, resolution, hardcore } : {},
      });
      setLibraryNote("World setup saved.");
      await loadLibrary();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveCard() {
    if (!world) return;
    setBusy(true);
    setLibraryNote("");
    setError("");
    try {
      const view =
        customSheet && creation.view
          ? creation.view
          : await api(`/world-drafts/${world.id}/creation`, CreationView.parse);
      const d = customSheet
        ? view.draft
        : {
            ...withArchetype(view.draft, view, archetype),
            ancestry,
            name: characterName || world.suggestedCharacterName,
          };
      const pc = adapted ??
        card?.pc ??
        imported?.pc ?? {
          name: d.name,
          level: review?.startingLevel ?? 1,
          backstory: d.backstory || pitch,
          abilities: [],
          gear: d.gear,
        };
      await api("/character-cards", CharacterCard.parse, {
        title: pc.name,
        origin: imported ? "import" : "created",
        pc,
        companions: card?.companions ?? imported?.companions ?? [],
        sheet: card?.sheet ?? {
          attributes: d.attributes,
          skills: d.skills,
          pronouns: d.pronouns,
          appearance: d.appearance,
          personality: d.personality,
        },
      });
      setLibraryNote("Character card saved.");
      await loadLibrary();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submitCreation(quick = false) {
    setBusy(true);
    setBusyNote(world ? "Preparing your campaign…" : "");
    setError("");
    setDetail("");
    try {
      if (!world) {
        setSteps(INITIAL_STEPS);
        const draft = await streamApi(
          "/world-drafts/stream",
          WorldPitch.parse({
            name,
            characterName,
            pitch,
            ...(sourceMode && sourceTitle.trim()
              ? { source: { title: sourceTitle.trim(), wiki: sourceWiki.trim() } }
              : {}),
          }),
          GeneratedWorldPreview.parse,
          (data) => {
            const next = (data as { steps?: DraftProgressStep[] }).steps;
            if (next) setSteps(next);
          },
        );
        setSteps((current) => current.map((s) => ({ ...s, status: "done" as const })));
        // Write it even if the dialog was closed mid-generation, so reopening resumes here.
        try {
          const previous = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as Record<string, unknown>;
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...previous, world: draft, draftId: draft.id }));
        } catch {
          // Storage unavailable; the in-memory copy still works for this visit.
        }
        setWorld(draft);
        const merged = draft.review
          ? CreationReview.parse({
              ...draft.review,
              ...(choice.setup
                ? {
                    subsystems:
                      presetSelection(choice.setup.rules.preset ?? "standard").subsystems ??
                      draft.review.subsystems,
                  }
                : {}),
              ...choice.setup?.review,
              ...(choice.setup?.rules.resolution ? { resolution: choice.setup.rules.resolution } : {}),
              ...(choice.setup?.rules.hardcore !== undefined
                ? { hardcore: choice.setup.rules.hardcore }
                : {}),
            })
          : undefined;
        setReview(merged);
        if (merged) {
          setResolution(merged.resolution);
          setHardcore(merged.hardcore);
          if (!choice.setup) setPreset("custom");
        }
        setAncestry(draft.origins[0]!.id);
        setArchetype(draft.backgrounds[0]!.id);
        setProgression(choice.setup?.rules.progression ?? draft.progressions[0] ?? "classless");
        if (merged) await api(`/world-drafts/${draft.id}/review`, CreationReview.parse, merged, "PUT");
        if (quick) await startCampaign(draft, merged, true);
      } else {
        await startCampaign(world, review ? { ...review, resolution, hardcore } : undefined);
      }
    } catch (e) {
      setSteps((current) =>
        current.map((s) => (s.status === "running" ? { ...s, status: "failed" as const } : s)),
      );
      setError((e as Error).message);
      setDetail((e as Error & { detail?: string }).detail ?? "");
    } finally {
      setBusy(false);
      setBusyNote("");
    }
  }

  return (
    <form
      className="creation-form"
      aria-busy={busy || revising || resuming}
      onSubmit={(e) => {
        e.preventDefault();
        void submitCreation();
      }}
    >
      {offline && (
        <p className="connection-banner creation-banner">
          Offline preview uses a fixed sci-fi example. Connect models to generate a world from your
          description.
        </p>
      )}
      {resuming ? (
        <p role="status" className="creation-busy">
          Opening your unfinished story… <Elapsed active />
        </p>
      ) : null}
      {choosing && !world && (
        <CreationChooser
          cards={cards}
          setups={setups}
          worlds={worlds}
          value={choice}
          onChange={selectChoice}
          onBegin={() => void continueChoice(choice, true)}
          onContinue={(next) => void continueChoice(next)}
          onManage={(a) => void manage(a)}
          disabled={busy}
        />
      )}
      {!choosing && !world && (
        <button type="button" disabled={busy} onClick={() => setChoosing(true)}>
          Choose character and world
        </button>
      )}
      {!world && !choosing && (
        <section className="creation-stage" aria-labelledby="pitch-heading">
          <div className="creation-stage-head">
            <span className="creation-stage-number" aria-hidden="true">
              1
            </span>
            <div>
              <h3 id="pitch-heading">The pitch</h3>
              <p className="creation-stage-note">
                Name the story and describe the world you want to step into.
              </p>
            </div>
          </div>
          <label>
            Campaign name
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy || Boolean(world)}
              required
              maxLength={100}
              placeholder="Give this story a name"
            />
          </label>
          {!editing && (
            <label>
              <span>
                Character name <span className="muted">(optional)</span>
              </span>
              <input
                name="characterName"
                value={characterName}
                onChange={(e) => {
                  setCharacterName(e.target.value);
                  if (customSheet && creation.view)
                    creation.edit({ ...creation.view.draft, name: e.target.value });
                }}
                disabled={busy}
                maxLength={80}
                placeholder="Choose now or let the world suggest one"
              />
            </label>
          )}
          {!world && (
            <fieldset className="source-choice">
              <legend>Where does this story live?</legend>
              <div className="source-options">
                <label className={sourceMode ? "" : "source-option-active"}>
                  <input
                    type="radio"
                    name="source-mode"
                    checked={!sourceMode}
                    disabled={busy}
                    onChange={() => setSourceMode(false)}
                  />
                  An original world
                  <span>Built from your pitch alone.</span>
                </label>
                <label className={sourceMode ? "source-option-active" : ""}>
                  <input
                    type="radio"
                    name="source-mode"
                    checked={sourceMode}
                    disabled={busy}
                    onChange={() => setSourceMode(true)}
                  />
                  Inside a source
                  <span>Research a novel, comic or setting into the world bible.</span>
                </label>
              </div>
              {sourceMode && (
                <div className="source-fields">
                  <label>
                    Source title
                    <input
                      value={sourceTitle}
                      maxLength={100}
                      required
                      disabled={busy}
                      onChange={(e) => setSourceTitle(e.target.value)}
                      placeholder="A novel, comic, or setting…"
                    />
                  </label>
                  <label>
                    Source wiki
                    <input
                      value={sourceWiki}
                      required
                      maxLength={200}
                      disabled={busy}
                      onChange={(e) => setSourceWiki(e.target.value)}
                      placeholder="en.wikipedia.org or dc.fandom.com"
                    />
                  </label>
                  <p className="creation-hint">
                    Lore is read through the wiki's official API at one page per second; only summaries become
                    canon.
                  </p>
                </div>
              )}
            </fieldset>
          )}
          <label>
            What kind of adventure or world do you want?
            <textarea
              name="pitch"
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              disabled={busy}
              required
              minLength={10}
              maxLength={4000}
              rows={5}
              placeholder="A hard sci-fi mystery on a failing space station, with a human crew and no magic…"
            />
          </label>
          {choice.setup && (
            <button type="button" disabled={busy} onClick={() => void vary()}>
              Vary it
            </button>
          )}
        </section>
      )}
      {world && mode === "interview" ? (
        <Interview
          draftId={world.id}
          onView={creation.setView}
          onReview={() => {
            void creation.load();
            setMode("editor");
          }}
        />
      ) : world && mode === "wizard" && creation.view ? (
        <section className="creation-stage" aria-label="Build your character step by step">
          <div className="creation-wizard-head">
            <span className="creation-stage-number" aria-hidden="true">
              {step + 1}
            </span>
            <div>
              <div className="creation-kicker">
                STEP {step + 1} OF {STEPS.length} · {STEPS[step]!.title.toUpperCase()}
              </div>
            </div>
          </div>
          {creation.view.notice && <p className="muted small">{creation.view.notice}</p>}
          <SheetEditor
            view={creation.view}
            onChange={creation.edit}
            disabled={busy}
            sections={STEPS[step]!.sections}
            onSuggest={(field) => void suggest(field)}
          />
          {creation.error && (
            <p role="alert" className="error">
              {creation.error}
            </p>
          )}
          <div className="wizard-nav">
            <button
              type="button"
              disabled={busy}
              onClick={() => (step ? setStep(step - 1) : setMode("review"))}
            >
              ← Back
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : setMode("editor"))}
            >
              {step < STEPS.length - 1 ? `Next: ${STEPS[step + 1]!.title}` : "Review the whole sheet"} →
            </button>
          </div>
        </section>
      ) : world && mode === "editor" && creation.view ? (
        <section className="creation-stage" aria-label="Build your character">
          <div className="creation-stage-head">
            <span className="creation-stage-number" aria-hidden="true">
              ✦
            </span>
            <div>
              <h3>Your character</h3>
              <p className="creation-stage-note">Every rule is checked as you change it.</p>
            </div>
          </div>
          {creation.view.notice && <p className="muted small">{creation.view.notice}</p>}
          <SheetEditor view={creation.view} onChange={creation.edit} disabled={busy} />
          {creation.error && (
            <p role="alert" className="error">
              {creation.error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (creation.view) setCharacterName(creation.view.draft.name);
              setMode("review");
            }}
          >
            ← Back to the world
          </button>
        </section>
      ) : world ? (
        <section className="world-review creation-stage" aria-label="Review your world">
          <div className="creation-stage-head">
            <span className="creation-stage-number" aria-hidden="true">
              2
            </span>
            <div>
              <div className="creation-kicker">
                {world.offline ? "Offline example" : "Your generated world"}
              </div>
              <h2>{world.worldName}</h2>
            </div>
          </div>
          <p className="creation-premise">{world.premise}</p>
          <label>
            <span>
              Character name <span className="muted">(optional)</span>
            </span>
            <input
              name="characterName"
              value={characterName}
              onChange={(e) => {
                setCharacterName(e.target.value);
                if (customSheet && creation.view)
                  creation.edit({ ...creation.view.draft, name: e.target.value });
              }}
              disabled={busy}
              maxLength={80}
              placeholder={world.suggestedCharacterName}
            />
          </label>
          {customSheet && (
            <p className="muted small">
              Your customised sheet is kept. Choose “Customise character” again to change it.
            </p>
          )}
          <div className="creation-picks">
            <label>
              {world.originLabel}
              <select
                aria-label={world.originLabel}
                value={ancestry}
                onChange={(e) => setAncestry(e.target.value)}
                disabled={busy || customSheet}
              >
                {world.origins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Background
              <select
                aria-label="Background"
                value={archetype}
                onChange={(e) => setArchetype(e.target.value)}
                disabled={busy || customSheet}
              >
                {world.backgrounds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="creation-hint">{world.origins.find((o) => o.id === ancestry)?.description}</p>
          <p className="creation-hint">
            {world.backgrounds.find((b) => b.id === archetype)?.description} Your background sets your
            starting training; it is not a permanent class.
          </p>
          {!characterName.trim() && (
            <p className="creation-hint">
              Leave the character name blank to use {world.suggestedCharacterName}.
            </p>
          )}
          {card ? (
            <CharacterArrival
              pc={adapted ?? card.pc}
              adapted={Boolean(adapted)}
              adapting={adapting}
              onChange={setAdapted}
              onAdapt={() => void adapt()}
              onReset={() => setAdapted(null)}
              disabled={busy}
            />
          ) : (
            <ImportPanel onChange={setImported} />
          )}
          <div className="keep-actions">
            <button type="button" disabled={busy} onClick={() => void saveSetup()}>
              Save as world setup
            </button>
            <button type="button" disabled={busy} onClick={() => void saveCard()}>
              Save character as card
            </button>
          </div>
          {libraryNote && <p role="status">{libraryNote}</p>}
          <fieldset className="paths">
            <legend>How would you like to make your character?</legend>
            <p className="muted small">
              Begin now with the picks above, or build your character in more detail.
            </p>
            <div className="path-buttons">
              <button type="button" disabled={busy} onClick={() => setMode("interview")}>
                <strong>Talk it through</strong>
                <span>Answer a few questions and watch your sheet fill in.</span>
              </button>
              <button type="button" disabled={busy} onClick={() => void customise("wizard")}>
                <strong>Build step by step</strong>
                <span>Choose each part yourself, with suggestions if you want them.</span>
              </button>
              <button type="button" disabled={busy} onClick={() => void customise("editor")}>
                <strong>Customise character</strong>
                <span>Go straight to the full sheet.</span>
              </button>
            </div>
          </fieldset>
          <fieldset className="rules">
            <legend>Rules of play</legend>
            <p className="muted small">
              These shape the whole campaign. Dice and character growth are fixed once the story starts.
            </p>
            <div className="creation-picks">
              <label>
                Preset
                <select
                  aria-label="Preset"
                  value={preset}
                  onChange={(e) => {
                    const next = e.target.value as CampaignPreset;
                    setPreset(next);
                    const subsystems = presetSelection(next).subsystems;
                    if (subsystems) setReview((r) => (r ? { ...r, subsystems } : r));
                  }}
                  disabled={busy}
                >
                  <option value="story">Story — light bookkeeping</option>
                  <option value="standard">Standard — the full core rules</option>
                  <option value="simulation">Simulation — every dial on</option>
                  <option value="custom">Custom — start from Standard, then tune</option>
                </select>
              </label>
              <label>
                Story mode
                <select
                  aria-label="Story mode"
                  value={storyMode}
                  onChange={(e) => setStoryMode(e.target.value as typeof storyMode)}
                  disabled={busy}
                >
                  <option value="threatClock">Threat clock — the danger closes in</option>
                  <option value="livingWorld">Living world — factions act on their own</option>
                </select>
              </label>
            </div>
            <div className="creation-picks">
              <label>
                Dice
                <select
                  aria-label="Dice"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as typeof resolution)}
                  disabled={busy}
                >
                  <option value="d100">d100 — percentile checks</option>
                  <option value="d20">d20 — the same odds, twenty-sided</option>
                </select>
              </label>
              <label>
                <span>
                  How characters grow <span className="muted">(fixed once the story starts)</span>
                </span>
                <select
                  aria-label="How characters grow"
                  value={progression}
                  onChange={(e) => setProgression(e.target.value as typeof progression)}
                  disabled={busy}
                >
                  {world.progressions.includes("classless") && (
                    <option value="classless">Spend experience freely</option>
                  )}
                  {world.progressions.includes("useBased") && (
                    <option value="useBased">Improve skills by using them</option>
                  )}
                  {world.progressions.includes("hybrid") && (
                    <option value="hybrid">Both, at half experience</option>
                  )}
                  {world.progressions.includes("classes") && (
                    <option value="classes">Classes and levels</option>
                  )}
                </select>
              </label>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={hardcore}
                onChange={(e) => setHardcore(e.target.checked)}
                disabled={busy}
              />
              Hardcore — death is permanent, and turning this on can't be undone
            </label>
          </fieldset>
          {world.reviewNotice && <p role="status">{world.reviewNotice}</p>}
          {review && (
            <CreationReviewEditor
              value={review}
              onChange={setReview}
              disabled={busy || revising}
              revising={revising}
              onRevise={() => void reviseSample()}
            />
          )}
          <h3>Your opening</h3>
          <p>{world.opening}</p>
          <div className="creation-secondary-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setWorld(undefined);
                setCustomSheet(false);
                setError("");
                setDetail("");
                setMode("review");
                setSteps([]);
              }}
            >
              Edit adventure description
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                localStorage.removeItem(DRAFT_KEY);
                setWorld(undefined);
                setName("");
                setCharacterName("");
                setPitch("");
                setAncestry("");
                setArchetype("");
                setCustomSheet(false);
                setMode("review");
                setStep(0);
                setSteps([]);
                setError("");
                setDetail("");
              }}
            >
              Start over
            </button>
          </div>
        </section>
      ) : null}
      {!world && steps.length > 0 && (
        <section className="creation-progress" aria-label="World generation progress">
          <div className="creation-progress-head">
            <span>Weaving your world</span>
            <span className="creation-progress-count">
              {doneSteps}/{steps.length} <Elapsed active={busy} />
            </span>
          </div>
          <progress value={doneSteps} max={steps.length} aria-label="World generation progress" />
          <ol className="generation-steps" aria-live="polite">
            {steps.map((s) => (
              <li key={s.key} className={s.status}>
                <span aria-hidden="true">{STEP_ICON[s.status]}</span> {s.label}
              </li>
            ))}
          </ol>
        </section>
      )}
      {busy && busyNote && (
        <p role="status" className="creation-busy">
          {busyNote} <Elapsed active={busy} />
        </p>
      )}
      {error && (
        <div role="alert" className="creation-error" ref={errorBox}>
          <div className="creation-error-head">
            <span aria-hidden="true">✗</span>
            <h3>The storyteller couldn't finish</h3>
          </div>
          <p>{error}</p>
          {detail && (
            <details>
              <summary>Technical detail</summary>
              <pre>{detail}</pre>
            </details>
          )}
          <div className="creation-error-actions">
            <button
              type="button"
              onClick={() => {
                setError("");
                setDetail("");
              }}
            >
              Dismiss
            </button>
            {onOpenSettings && (
              <button type="button" onClick={onOpenSettings}>
                Check model settings
              </button>
            )}
          </div>
        </div>
      )}
      {(mode === "review" || mode === "editor") && !resuming && !choosing && (
        <button
          type="submit"
          className="primary creation-submit"
          disabled={busy || revising || blocked || resuming}
        >
          {busy
            ? "Working…"
            : world
              ? "Begin adventure →"
              : offline
                ? "Preview example world →"
                : "Generate world →"}
        </button>
      )}
    </form>
  );
}

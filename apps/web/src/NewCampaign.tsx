import {
  type CampaignPreset,
  type CampaignSettings,
  CreatedCampaign,
  CreationView,
  GeneratedWorldPreview,
  StartGeneratedCampaign,
  type SuggestField,
  WorldPitch,
} from "@wyrd/core";
import { useState } from "react";
import { api } from "./api.ts";
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

export function NewCampaign({ onCreate, offline }: { onCreate: (id: string) => void; offline: boolean }) {
  const [name, setName] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [pitch, setPitch] = useState("");
  const [world, setWorld] = useState<GeneratedWorldPreview>();
  const [ancestry, setAncestry] = useState("");
  const [archetype, setArchetype] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("review");
  const [progression, setProgression] = useState<CampaignSettings["structural"]["progression"]>("classless");
  const [preset, setPreset] = useState<CampaignPreset>("standard");
  const [storyMode, setStoryMode] = useState<"threatClock" | "livingWorld">("threatClock");
  const [resolution, setResolution] = useState<"d100" | "d20">("d100");
  const [hardcore, setHardcore] = useState(false);
  const [step, setStep] = useState(0);
  const creation = useCreation(world?.id);
  const editing = mode !== "review";
  const blocked =
    mode === "editor" && (!creation.view || creation.view.issues.some((i) => i.severity === "error"));

  /** Opens the sheet (editor or wizard) on the saved draft, carrying over the quick picks and name. */
  async function customise(next: Mode) {
    if (!world) return;
    setBusy(true);
    try {
      const view = await api(`/world-drafts/${world.id}/creation`, CreationView.parse);
      let draft =
        view.draft.archetype === archetype ? view.draft : withArchetype(view.draft, view, archetype);
      draft = { ...draft, ancestry, name: characterName.trim() || draft.name };
      creation.setView(view);
      await creation.save(draft);
      setStep(0);
      setMode(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function suggest(field: SuggestField) {
    if (!world) return;
    setBusy(true);
    try {
      await creation.flush();
      creation.setView(await api(`/world-drafts/${world.id}/suggest`, CreationView.parse, { field }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-busy={busy}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          if (!world) {
            const draft = await api(
              "/world-drafts",
              GeneratedWorldPreview.parse,
              WorldPitch.parse({ name, characterName, pitch }),
            );
            setWorld(draft);
            setAncestry(draft.origins[0]!.id);
            setArchetype(draft.backgrounds[0]!.id);
            setProgression(draft.progressions[0] ?? "classless");
          } else if (mode === "editor") {
            await creation.flush();
            const created = await api(
              "/campaigns",
              CreatedCampaign.parse,
              StartGeneratedCampaign.parse({
                draftId: world.id,
                progression,
                preset,
                storyMode,
                resolution,
                hardcore,
              }),
            );
            onCreate(created.id);
          } else {
            const created = await api(
              "/campaigns",
              CreatedCampaign.parse,
              StartGeneratedCampaign.parse({
                draftId: world.id,
                characterName,
                ancestry,
                archetype,
                progression,
                preset,
                storyMode,
                resolution,
                hardcore,
              }),
            );
            onCreate(created.id);
          }
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {offline && (
        <p className="connection-banner">
          Offline preview uses a fixed sci-fi example. Connect models to generate a world from your
          description.
        </p>
      )}
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
          Character name <span className="muted">(optional)</span>
          <input
            name="characterName"
            value={characterName}
            onChange={(e) => setCharacterName(e.target.value)}
            disabled={busy}
            maxLength={80}
            placeholder={world ? world.suggestedCharacterName : "Choose now or let the world suggest one"}
          />
        </label>
      )}
      {!world ? (
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
      ) : mode === "interview" ? (
        <Interview
          draftId={world.id}
          onView={creation.setView}
          onReview={() => {
            void creation.load();
            setMode("editor");
          }}
        />
      ) : mode === "wizard" && creation.view ? (
        <section aria-label="Build your character step by step">
          <div className="eyebrow">
            STEP {step + 1} OF {STEPS.length} · {STEPS[step]!.title.toUpperCase()}
          </div>
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
      ) : mode === "editor" && creation.view ? (
        <section aria-label="Build your character">
          <div className="eyebrow">YOUR CHARACTER</div>
          <SheetEditor view={creation.view} onChange={creation.edit} disabled={busy} />
          {creation.error && (
            <p role="alert" className="error">
              {creation.error}
            </p>
          )}
          <button type="button" disabled={busy} onClick={() => setMode("review")}>
            ← Back to the world
          </button>
        </section>
      ) : (
        <section className="world-review" aria-label="Review your world">
          <div className="eyebrow">{world.offline ? "OFFLINE EXAMPLE" : "YOUR GENERATED WORLD"}</div>
          <h2>{world.worldName}</h2>
          <p>{world.premise}</p>
          <div className="form-row">
            <label>
              {world.originLabel}
              <select
                aria-label={world.originLabel}
                value={ancestry}
                onChange={(e) => setAncestry(e.target.value)}
                disabled={busy}
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
                disabled={busy}
              >
                {world.backgrounds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">{world.origins.find((o) => o.id === ancestry)?.description}</p>
          <p className="muted">
            {world.backgrounds.find((b) => b.id === archetype)?.description} Your background sets your
            starting training; it is not a permanent class.
          </p>
          {!characterName.trim() && (
            <p className="muted">Leave the character name blank to use {world.suggestedCharacterName}.</p>
          )}
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
            <div className="form-row">
              <label>
                Preset
                <select
                  aria-label="Preset"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as CampaignPreset)}
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
            <div className="form-row">
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
                How characters grow <span className="muted">(fixed once the story starts)</span>
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
          <h3>Your opening</h3>
          <p>{world.opening}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setWorld(undefined);
              setError("");
            }}
          >
            Edit adventure description
          </button>
        </section>
      )}
      {busy && (
        <p role="status">
          {world ? "Preparing your campaign…" : "Creating the setting, character options and opening scene…"}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {(mode === "review" || mode === "editor") && (
        <button type="submit" className="primary" disabled={busy || blocked}>
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

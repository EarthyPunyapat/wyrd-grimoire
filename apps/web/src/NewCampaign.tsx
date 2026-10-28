import { CreatedCampaign, GeneratedWorldPreview, StartGeneratedCampaign, WorldPitch } from "@wyrd/core";
import { useState } from "react";
import { api } from "./api.ts";

export function NewCampaign({ onCreate, offline }: { onCreate: (id: string) => void; offline: boolean }) {
  const [name, setName] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [pitch, setPitch] = useState("");
  const [world, setWorld] = useState<GeneratedWorldPreview>();
  const [ancestry, setAncestry] = useState("");
  const [archetype, setArchetype] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
          } else {
            const created = await api(
              "/campaigns",
              CreatedCampaign.parse,
              StartGeneratedCampaign.parse({ draftId: world.id, characterName, ancestry, archetype }),
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
      <button type="submit" className="primary" disabled={busy}>
        {busy
          ? "Working…"
          : world
            ? "Begin adventure →"
            : offline
              ? "Preview example world →"
              : "Generate world →"}
      </button>
    </form>
  );
}

import {
  type CampaignPreset,
  type CampaignSettings,
  CampaignSettingsView,
  PRESET_NAMES,
  presetOf,
  presetSelection,
  type SubsystemToggles,
} from "@wyrd/core";
import { useEffect, useState } from "react";
import { api } from "./api.ts";

type BooleanToggle = {
  [K in keyof SubsystemToggles]: SubsystemToggles[K] extends boolean ? K : never;
}[keyof SubsystemToggles];

const TOGGLES: { key: BooleanToggle; label: string }[] = [
  { key: "bleeding", label: "Bleeding" },
  { key: "infection", label: "Infection" },
  { key: "fractures", label: "Fractures" },
  { key: "permanentInjuries", label: "Permanent injuries" },
  { key: "timeDetail", label: "NPC schedules and shop hours" },
  { key: "factionReputation", label: "Faction reputation" },
  { key: "weatherEffects", label: "Weather effects" },
  { key: "lightingAndVision", label: "Lighting and vision" },
  { key: "languageBarriers", label: "Language barriers" },
  { key: "ammo", label: "Ammunition counting" },
  { key: "durability", label: "Item durability" },
  { key: "crafting", label: "Crafting" },
  { key: "survival", label: "Survival needs" },
  { key: "disease", label: "Disease" },
];

const PRESETS: CampaignPreset[] = ["story", "standard", "simulation", "custom"];

/**
 * Campaign settings (spec 12): presets, structural locks with their reasons, subsystems,
 * difficulty, content dials and narration. Saving sends one PATCH; the engine owns the rules.
 */
export function CampaignSettingsPanel({ campaignId }: { campaignId: string }) {
  const [view, setView] = useState<CampaignSettingsView>();
  const [draft, setDraft] = useState<CampaignSettings>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api(`/campaigns/${campaignId}/settings`, CampaignSettingsView.parse)
      .then((next) => {
        if (!live) return;
        setView(next);
        setDraft(next.settings);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [campaignId]);

  if (!view || !draft) {
    return (
      <div className="campaign-settings">
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : (
          <p role="status">Loading campaign settings…</p>
        )}
      </div>
    );
  }

  const lock = (path: string) => view.locks.find((entry) => entry.path === path);
  const detected = presetOf(draft);
  const setStructural = (patch: Partial<CampaignSettings["structural"]>) =>
    setDraft((d) => d && { ...d, structural: { ...d.structural, ...patch } });
  const setContent = (patch: Partial<CampaignSettings["content"]>) =>
    setDraft((d) => d && { ...d, content: { ...d.content, ...patch } });
  const setNarration = (patch: Partial<CampaignSettings["narration"]>) =>
    setDraft((d) => d && { ...d, narration: { ...d.narration, ...patch } });
  function setSub<K extends keyof SubsystemToggles>(key: K, value: SubsystemToggles[K]) {
    setDraft((d) => d && { ...d, subsystems: { ...d.subsystems, [key]: value } });
  }
  function choosePreset(id: CampaignPreset) {
    setMessage("");
    setDraft((d) => d && { ...d, ...presetSelection(id) });
  }

  const resolutionLock = lock("structural.resolution");
  const progressionLock = lock("structural.progression");
  const hardcoreLock = lock("structural.hardcore");
  const companionDeathLock = lock("companionDeath");

  return (
    <form
      className="campaign-settings"
      aria-busy={busy}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setMessage("");
        try {
          const next = await api(
            `/campaigns/${campaignId}/settings`,
            CampaignSettingsView.parse,
            draft,
            "PATCH",
          );
          setView(next);
          setDraft(next.settings);
          setMessage("Settings saved.");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="connection-banner">
          {message}
        </p>
      )}

      <fieldset>
        <legend>Preset</legend>
        <p className="muted small">
          A preset sets the subsystem toggles. Changing any toggle makes the campaign custom, while keeping
          the preset it came from.
        </p>
        <fieldset className="preset-buttons">
          <legend className="sr-only">Campaign preset</legend>
          {PRESETS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={detected.id === id}
              disabled={busy}
              onClick={() => choosePreset(id)}
            >
              {id === "custom" ? "Custom" : PRESET_NAMES[id]}
            </button>
          ))}
        </fieldset>
        <p className="muted small">
          Current: <strong>{detected.label}</strong>
        </p>
      </fieldset>

      <fieldset>
        <legend>Structure</legend>
        <p className="muted small">These are fixed once the story starts.</p>
        <div className="form-row">
          <label className={resolutionLock ? "locked-field" : undefined}>
            Dice
            <select
              aria-label="Dice"
              value={draft.structural.resolution}
              disabled={busy || Boolean(resolutionLock)}
              aria-describedby={resolutionLock ? "lock-resolution" : undefined}
              onChange={(e) => setStructural({ resolution: e.target.value as "d100" | "d20" })}
            >
              <option value="d100">d100 — percentile checks</option>
              <option value="d20">d20 — the same odds, twenty-sided</option>
            </select>
            {resolutionLock && (
              <span className="lock-reason" id="lock-resolution">
                {resolutionLock.reason}
              </span>
            )}
          </label>
          <label className={progressionLock ? "locked-field" : undefined}>
            Character growth
            <select
              aria-label="Character growth"
              value={draft.structural.progression}
              disabled={busy || Boolean(progressionLock)}
              aria-describedby={progressionLock ? "lock-progression" : undefined}
              onChange={(e) =>
                setStructural({
                  progression: e.target.value as CampaignSettings["structural"]["progression"],
                })
              }
            >
              <option value="classless">Spend experience freely</option>
              <option value="useBased">Improve skills by using them</option>
              <option value="hybrid">Both, at half experience</option>
              <option value="classes">Classes and levels</option>
            </select>
            {progressionLock && (
              <span className="lock-reason" id="lock-progression">
                {progressionLock.reason}
              </span>
            )}
          </label>
        </div>
        <label className={hardcoreLock ? "locked-field checkbox" : "checkbox"}>
          <input
            type="checkbox"
            checked={draft.structural.hardcore}
            disabled={busy || Boolean(hardcoreLock)}
            aria-describedby={hardcoreLock ? "lock-hardcore" : undefined}
            onChange={(e) => setStructural({ hardcore: e.target.checked })}
          />
          Hardcore
          {hardcoreLock && (
            <span className="lock-reason" id="lock-hardcore">
              {hardcoreLock.reason}
            </span>
          )}
        </label>
        {draft.structural.hardcore && (
          <p className="muted small">
            Turning hardcore off later is permanent and marks this campaign softcore.
          </p>
        )}
        <label className={companionDeathLock ? "locked-field checkbox" : "checkbox"}>
          <input
            type="checkbox"
            checked={draft.companionDeath}
            disabled={busy || Boolean(companionDeathLock)}
            aria-describedby={companionDeathLock ? "lock-companion-death" : undefined}
            onChange={(e) => setDraft((d) => d && { ...d, companionDeath: e.target.checked })}
          />
          Companions can die
          {companionDeathLock && (
            <span className="lock-reason" id="lock-companion-death">
              {companionDeathLock.reason}
            </span>
          )}
        </label>
      </fieldset>

      <fieldset>
        <legend>Story and challenge</legend>
        <div className="form-row">
          <label>
            Story mode
            <select
              aria-label="Story mode"
              value={draft.story.mode}
              disabled={busy}
              onChange={(e) =>
                setDraft(
                  (d) => d && { ...d, story: { mode: e.target.value as "threatClock" | "livingWorld" } },
                )
              }
            >
              <option value="threatClock">Threat clock</option>
              <option value="livingWorld">Living world</option>
            </select>
          </label>
          <label>
            Difficulty
            <select
              aria-label="Difficulty"
              value={draft.difficulty}
              disabled={busy}
              onChange={(e) =>
                setDraft((d) => d && { ...d, difficulty: e.target.value as CampaignSettings["difficulty"] })
              }
            >
              <option value="story">Story — kinder odds</option>
              <option value="standard">Standard</option>
              <option value="hard">Hard — harsher odds</option>
            </select>
          </label>
        </div>
        <label>
          Lethality
          <select
            aria-label="Lethality"
            value={draft.lethality}
            disabled={busy}
            onChange={(e) =>
              setDraft((d) => d && { ...d, lethality: e.target.value as CampaignSettings["lethality"] })
            }
          >
            <option value="gritty">Gritty — Luck 3</option>
            <option value="brutal">Brutal — Luck 1</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Subsystems</legend>
        <p className="muted small">
          Turning one off stops the engine enforcing it and prompts mentioning it; its state is kept.
        </p>
        <div className="form-row">
          <label>
            Inventory
            <select
              aria-label="Inventory"
              value={draft.subsystems.inventory}
              disabled={busy}
              onChange={(e) => setSub("inventory", e.target.value as SubsystemToggles["inventory"])}
            >
              <option value="abstract">Abstract — notable items only</option>
              <option value="weight">Weight and encumbrance</option>
              <option value="slots">Slots and quick access</option>
            </select>
          </label>
          <label>
            Money
            <select
              aria-label="Money"
              value={draft.subsystems.money}
              disabled={busy}
              onChange={(e) => setSub("money", e.target.value as SubsystemToggles["money"])}
            >
              <option value="wealthLevels">Wealth levels</option>
              <option value="coins">Coins and shops</option>
              <option value="haggling">Haggling and price drift</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Injuries
            <select
              aria-label="Injuries"
              value={draft.subsystems.injuries}
              disabled={busy}
              onChange={(e) => setSub("injuries", e.target.value as SubsystemToggles["injuries"])}
            >
              <option value="simple">Simple</option>
              <option value="realistic">Realistic</option>
            </select>
          </label>
          <label>
            Travel encounters
            <select
              aria-label="Travel encounters"
              value={draft.subsystems.travelEncounters}
              disabled={busy}
              onChange={(e) =>
                setSub("travelEncounters", e.target.value as SubsystemToggles["travelEncounters"])
              }
            >
              <option value="reduced">Reduced</option>
              <option value="on">On</option>
            </select>
          </label>
        </div>
        <div className="toggle-grid">
          {TOGGLES.map(({ key, label }) => (
            <label className="checkbox" key={key}>
              <input
                type="checkbox"
                checked={draft.subsystems[key]}
                disabled={busy}
                onChange={(e) => setSub(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Content</legend>
        <div className="form-row">
          <label>
            Violence
            <select
              aria-label="Violence"
              value={draft.content.violence}
              disabled={busy}
              onChange={(e) =>
                setContent({ violence: e.target.value as CampaignSettings["content"]["violence"] })
              }
            >
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="intense">Intense</option>
            </select>
          </label>
          <label>
            Horror
            <select
              aria-label="Horror"
              value={draft.content.horror}
              disabled={busy}
              onChange={(e) =>
                setContent({ horror: e.target.value as CampaignSettings["content"]["horror"] })
              }
            >
              <option value="off">Off</option>
              <option value="light">Light</option>
              <option value="moderate">Moderate</option>
              <option value="intense">Intense</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Romance
            <select
              aria-label="Romance"
              value={draft.content.romance}
              disabled={busy}
              onChange={(e) =>
                setContent({ romance: e.target.value as CampaignSettings["content"]["romance"] })
              }
            >
              <option value="off">Off</option>
              <option value="fadeToBlack">Fade to black</option>
            </select>
          </label>
          <label>
            Language
            <select
              aria-label="Language"
              value={draft.content.language}
              disabled={busy}
              onChange={(e) =>
                setContent({ language: e.target.value as CampaignSettings["content"]["language"] })
              }
            >
              <option value="clean">Clean</option>
              <option value="moderate">Moderate</option>
              <option value="strong">Strong</option>
            </select>
          </label>
        </div>
        <label>
          Lines <span className="muted">(never appears, one per line)</span>
          <textarea
            aria-label="Lines"
            rows={2}
            value={draft.content.lines.join("\n")}
            disabled={busy}
            onChange={(e) => setContent({ lines: linesOf(e.target.value) })}
          />
        </label>
        <label>
          Veils <span className="muted">(happens off-screen only, one per line)</span>
          <textarea
            aria-label="Veils"
            rows={2}
            value={draft.content.veils.join("\n")}
            disabled={busy}
            onChange={(e) => setContent({ veils: linesOf(e.target.value) })}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Narration</legend>
        <div className="form-row">
          <label>
            Language
            <input
              aria-label="Narration language"
              value={draft.narration.language}
              disabled={busy}
              onChange={(e) => setNarration({ language: e.target.value })}
            />
          </label>
          <label>
            Person
            <select
              aria-label="Narration person"
              value={draft.narration.person}
              disabled={busy}
              onChange={(e) =>
                setNarration({ person: e.target.value as CampaignSettings["narration"]["person"] })
              }
            >
              <option value="second">Second person — you</option>
              <option value="third">Third person — they</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Length
            <select
              aria-label="Narration length"
              value={draft.narration.length}
              disabled={busy}
              onChange={(e) =>
                setNarration({ length: e.target.value as CampaignSettings["narration"]["length"] })
              }
            >
              <option value="short">Short</option>
              <option value="normal">Normal</option>
              <option value="long">Long</option>
            </select>
          </label>
          <label>
            Banter
            <select
              aria-label="Banter"
              value={draft.narration.banter}
              disabled={busy}
              onChange={(e) =>
                setNarration({ banter: e.target.value as CampaignSettings["narration"]["banter"] })
              }
            >
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
            </select>
          </label>
        </div>
        <label>
          Canon check
          <select
            aria-label="Canon check"
            value={draft.narration.canonCheck}
            disabled={busy}
            onChange={(e) =>
              setNarration({
                canonCheck: e.target.value as CampaignSettings["narration"]["canonCheck"],
              })
            }
          >
            <option value="beforeShowing">Before showing the narration</option>
            <option value="afterShowing">After showing the narration</option>
          </select>
        </label>
        <div className="toggle-grid">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.narration.showMath}
              disabled={busy}
              onChange={(e) => setNarration({ showMath: e.target.checked })}
            />
            Show the math by default
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.narration.fastCombat}
              disabled={busy}
              onChange={(e) => setNarration({ fastCombat: e.target.checked })}
            />
            Fast combat narration
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.narration.suggestions}
              disabled={busy}
              onChange={(e) => setNarration({ suggestions: e.target.checked })}
            />
            Suggestion chips
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.xp.modelSuggestedXp}
              disabled={busy}
              onChange={(e) => setDraft((d) => d && { ...d, xp: { modelSuggestedXp: e.target.checked } })}
            />
            Let the narrator suggest XP
          </label>
        </div>
      </fieldset>

      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}

function linesOf(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

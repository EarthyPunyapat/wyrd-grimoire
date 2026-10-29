import {
  type CampaignSettings,
  CampaignSettingsView,
  presetToggles,
  type SettingsLock,
  type SUBSYSTEM_PRESETS,
  type SubsystemToggles,
} from "@wyrd/core";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import { api } from "./api.ts";

const parse = (d: unknown) => CampaignSettingsView.parse(d);

const TOGGLES: Array<{ key: keyof SubsystemToggles; label: string; hint: string }> = [
  {
    key: "timeDetail",
    label: "Time detail",
    hint: "NPC schedules, shop hours and lighting follow the clock.",
  },
  {
    key: "factionReputation",
    label: "Faction reputation",
    hint: "Your standing moves prices, access and reactions.",
  },
  {
    key: "weatherEffects",
    label: "Weather effects",
    hint: "Rain, wind, snow and heat change checks and travel.",
  },
  {
    key: "lightingAndVision",
    label: "Lighting and vision",
    hint: "Dim and dark places penalise sight; torches matter.",
  },
  {
    key: "languageBarriers",
    label: "Language barriers",
    hint: "People speak their own languages; find a shared tongue.",
  },
  { key: "ammo", label: "Ammunition", hint: "Count arrows and bolts; recover some after a fight." },
  { key: "durability", label: "Durability", hint: "Weapons and armour wear, degrade and can break." },
  { key: "crafting", label: "Crafting", hint: "Recipes turn materials into gear, with quality by degree." },
  { key: "survival", label: "Survival", hint: "Food, water, sleep and exposure become needs." },
  { key: "disease", label: "Disease", hint: "Illnesses have vectors, onsets, stages and cures." },
  { key: "infection", label: "Wound infection", hint: "Untreated wounds can fester." },
  { key: "fractures", label: "Fractures", hint: "Blunt wounds can break bones." },
  { key: "permanentInjuries", label: "Permanent injuries", hint: "Some wounds leave lasting marks." },
  { key: "bleeding", label: "Bleeding", hint: "Cut wounds bleed until treated." },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const control =
    isValidElement(children) && children.type !== undefined
      ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, "aria-label": label })
      : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

function Locked({ lock }: { lock: SettingsLock }) {
  return (
    <label className="locked-setting" title={lock.reason}>
      <span>{lock.label}</span>
      <input type="text" value={lock.reason} readOnly disabled />
      <span className="muted small">Locked: {lock.reason}</span>
    </label>
  );
}

/** Campaign settings (spec 12): presets, every subsystem toggle, content dials and locks. */
export function CampaignSettingsPanel({
  campaignId,
  initial,
  onSaved,
}: {
  campaignId: string;
  initial: CampaignSettings;
  onSaved: (view: CampaignSettingsView) => void;
}) {
  const [view, setView] = useState<CampaignSettingsView>({
    settings: initial,
    locks: [],
    presets: ["story", "standard", "simulation", "custom"],
    classesSupported: false,
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [lines, setLines] = useState("");
  const [veils, setVeils] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      const next = await api(`/campaigns/${campaignId}/settings`, parse);
      setView(next);
      setLines(next.settings.content.lines.join("\n"));
      setVeils(next.settings.content.veils.join("\n"));
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    // The campaign is fixed for the life of this panel.
  }, [campaignId]);

  const lock = (path: string) => view.locks.find((l) => l.path === path);
  const update = (patch: Partial<CampaignSettings> | ((s: CampaignSettings) => CampaignSettings)) => {
    setDirty(true);
    setView((v) => ({
      ...v,
      settings: typeof patch === "function" ? patch(v.settings) : { ...v.settings, ...patch },
    }));
  };
  const toggle = (key: keyof SubsystemToggles, value: boolean) =>
    update((s) => ({ ...s, preset: "custom", subsystems: { ...s.subsystems, [key]: value } }));
  const choosePreset = (preset: string) => {
    if (preset === "custom") {
      update((s) => ({ ...s, preset: "custom" }));
      return;
    }
    const toggles = presetToggles(preset as keyof typeof SUBSYSTEM_PRESETS);
    update((s) => ({ ...s, preset: preset as CampaignSettings["preset"], subsystems: toggles }));
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const settings = {
        ...view.settings,
        content: {
          ...view.settings.content,
          lines: lines
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
          veils: veils
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
        },
      };
      const next = await api(`/campaigns/${campaignId}/settings`, parse, { settings }, "PUT");
      setView(next);
      setDirty(false);
      onSaved(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded)
    return (
      <div className="settings-panel">
        <p className="muted">Loading campaign settings…</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="button" className="primary" onClick={() => void load()} disabled={busy}>
          {busy ? "Opening…" : "Open settings"}
        </button>
      </div>
    );

  const s = view.settings;
  const hardcoreLock = lock("structural.hardcore");
  return (
    <div className="settings-panel">
      <div className="form-row">
        <Field label="Preset" hint="A preset sets every subsystem below; changing one makes it custom.">
          <select value={s.preset} onChange={(e) => choosePreset(e.target.value)} disabled={busy}>
            <option value="story">Story</option>
            <option value="standard">Standard</option>
            <option value="simulation">Simulation</option>
            <option value="custom">Custom</option>
          </select>
        </Field>
        <Field label="Story mode">
          <select
            value={s.story.mode}
            onChange={(e) =>
              update((x) => ({
                ...x,
                story: { ...x.story, mode: e.target.value as CampaignSettings["story"]["mode"] },
              }))
            }
            disabled={busy}
          >
            <option value="threatClock">Threat Clock</option>
            <option value="livingWorld">Living World</option>
          </select>
        </Field>
      </div>

      <div className="form-row">
        <Field label="Difficulty">
          <select
            value={s.difficulty}
            onChange={(e) =>
              update((x) => ({ ...x, difficulty: e.target.value as CampaignSettings["difficulty"] }))
            }
            disabled={busy}
          >
            <option value="story">Story (+10)</option>
            <option value="standard">Standard</option>
            <option value="hard">Hard (−10)</option>
          </select>
        </Field>
        <Field label="Lethality">
          <select
            value={s.lethality}
            onChange={(e) =>
              update((x) => ({ ...x, lethality: e.target.value as CampaignSettings["lethality"] }))
            }
            disabled={busy}
          >
            <option value="gritty">Gritty (Luck 3)</option>
            <option value="brutal">Brutal (Luck 1)</option>
          </select>
        </Field>
      </div>

      <fieldset className="settings-locks">
        <legend>Locked at creation</legend>
        {view.locks
          .filter((l) => l.path === "structural.resolution" || l.path === "structural.progression")
          .map((l) => (
            <Locked key={l.path} lock={l} />
          ))}
        <Field label="Dice" hint={lock("structural.resolution")?.reason}>
          <input value={s.structural.resolution === "d20" ? "d20" : "d100"} readOnly disabled />
        </Field>
        <Field label="Progression" hint={lock("structural.progression")?.reason}>
          <input value={s.structural.progression} readOnly disabled />
        </Field>
        <label className={hardcoreLock ? "locked-setting" : undefined} title={hardcoreLock?.reason}>
          <span>Hardcore</span>
          <input
            type="checkbox"
            checked={s.structural.hardcore}
            disabled={busy || Boolean(hardcoreLock)}
            onChange={(e) =>
              update((x) => {
                const on = e.target.checked;
                const next = { ...x, structural: { ...x.structural, hardcore: on } };
                return on ? { ...next, companionDeath: true } : next;
              })
            }
          />
          {hardcoreLock && <span className="muted small">{hardcoreLock.reason}</span>}
          {s.flags.softcore && <span className="muted small">This campaign was once hardcore.</span>}
        </label>
      </fieldset>

      <fieldset>
        <legend>Subsystems</legend>
        <div className="form-row">
          <Field label="Inventory">
            <select
              value={s.subsystems.inventory}
              onChange={(e) =>
                update((x) => ({
                  ...x,
                  preset: "custom",
                  subsystems: { ...x.subsystems, inventory: e.target.value as SubsystemToggles["inventory"] },
                }))
              }
              disabled={busy}
            >
              <option value="abstract">Abstract</option>
              <option value="weight">Weight</option>
              <option value="slots">Weight + slots</option>
            </select>
          </Field>
          <Field label="Money">
            <select
              value={s.subsystems.money}
              onChange={(e) =>
                update((x) => ({
                  ...x,
                  preset: "custom",
                  subsystems: { ...x.subsystems, money: e.target.value as SubsystemToggles["money"] },
                }))
              }
              disabled={busy}
            >
              <option value="wealthLevels">Wealth levels</option>
              <option value="coins">Coins</option>
              <option value="haggling">Coins + haggling</option>
            </select>
          </Field>
          <Field label="Injuries">
            <select
              value={s.subsystems.injuries}
              onChange={(e) =>
                update((x) => ({
                  ...x,
                  preset: "custom",
                  subsystems: { ...x.subsystems, injuries: e.target.value as SubsystemToggles["injuries"] },
                }))
              }
              disabled={busy}
            >
              <option value="simple">Simple</option>
              <option value="realistic">Realistic</option>
            </select>
          </Field>
          <Field label="Travel encounters">
            <select
              value={s.subsystems.travelEncounters}
              onChange={(e) =>
                update((x) => ({
                  ...x,
                  preset: "custom",
                  subsystems: {
                    ...x.subsystems,
                    travelEncounters: e.target.value as SubsystemToggles["travelEncounters"],
                  },
                }))
              }
              disabled={busy}
            >
              <option value="reduced">Reduced</option>
              <option value="on">On</option>
            </select>
          </Field>
        </div>
        <div className="toggle-grid">
          {TOGGLES.map((t) => (
            <label key={t.key} className="toggle">
              <input
                type="checkbox"
                checked={Boolean(s.subsystems[t.key])}
                onChange={(e) => toggle(t.key, e.target.checked)}
                disabled={
                  busy ||
                  (t.key !== "bleeding" &&
                  t.key !== "infection" &&
                  t.key !== "fractures" &&
                  t.key !== "permanentInjuries"
                    ? false
                    : s.subsystems.injuries === "simple")
                }
              />
              <span>
                {t.label} <span className="muted small">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Content</legend>
        <div className="form-row">
          <Field label="Violence">
            <select
              value={s.content.violence}
              onChange={(e) =>
                update((x) => ({ ...x, content: { ...x.content, violence: e.target.value as never } }))
              }
            >
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="intense">Intense</option>
            </select>
          </Field>
          <Field label="Horror">
            <select
              value={s.content.horror}
              onChange={(e) =>
                update((x) => ({ ...x, content: { ...x.content, horror: e.target.value as never } }))
              }
            >
              <option value="off">Off</option>
              <option value="light">Light</option>
              <option value="moderate">Moderate</option>
              <option value="intense">Intense</option>
            </select>
          </Field>
          <Field label="Romance">
            <select
              value={s.content.romance}
              onChange={(e) =>
                update((x) => ({ ...x, content: { ...x.content, romance: e.target.value as never } }))
              }
            >
              <option value="off">Off</option>
              <option value="fadeToBlack">Fade to black</option>
            </select>
          </Field>
          <Field label="Language">
            <select
              value={s.content.language}
              onChange={(e) =>
                update((x) => ({ ...x, content: { ...x.content, language: e.target.value as never } }))
              }
            >
              <option value="clean">Clean</option>
              <option value="moderate">Moderate</option>
              <option value="strong">Strong</option>
            </select>
          </Field>
        </div>
        <Field label="Lines (never appears)" hint="One topic per line.">
          <textarea
            rows={2}
            value={lines}
            onChange={(e) => {
              setLines(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <Field label="Veils (off-screen only)" hint="One topic per line.">
          <textarea
            rows={2}
            value={veils}
            onChange={(e) => {
              setVeils(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Narration</legend>
        <div className="form-row">
          <Field label="Person">
            <select
              value={s.narration.person}
              onChange={(e) =>
                update((x) => ({ ...x, narration: { ...x.narration, person: e.target.value as never } }))
              }
            >
              <option value="second">Second person</option>
              <option value="third">Third person</option>
            </select>
          </Field>
          <Field label="Length">
            <select
              value={s.narration.length}
              onChange={(e) =>
                update((x) => ({ ...x, narration: { ...x.narration, length: e.target.value as never } }))
              }
            >
              <option value="short">Short</option>
              <option value="normal">Normal</option>
              <option value="long">Long</option>
            </select>
          </Field>
          <Field label="Banter">
            <select
              value={s.narration.banter}
              onChange={(e) =>
                update((x) => ({ ...x, narration: { ...x.narration, banter: e.target.value as never } }))
              }
            >
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
            </select>
          </Field>
        </div>
        <div className="toggle-grid">
          {(
            [
              ["showMath", "Show the math"],
              ["fastCombat", "Fast combat"],
              ["suggestions", "Suggestions"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="toggle">
              <input
                type="checkbox"
                checked={s.narration[key]}
                onChange={(e) =>
                  update((x) => ({ ...x, narration: { ...x.narration, [key]: e.target.checked } }))
                }
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="toggle">
            <input
              type="checkbox"
              checked={s.xp.modelSuggestedXp}
              onChange={(e) => update((x) => ({ ...x, xp: { modelSuggestedXp: e.target.checked } }))}
            />
            <span>Model-suggested XP</span>
          </label>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="settings-actions">
        <button type="button" className="primary" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save campaign settings"}
        </button>
        {dirty && <span className="muted small">Unsaved changes</span>}
      </div>
    </div>
  );
}

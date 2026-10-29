import {
  COLUMN_OPTIONS,
  DENSITY_OPTIONS,
  MOTION_OPTIONS,
  type PlayPreferences,
  PRESET_OPTIONS,
  TEXT_SIZE_OPTIONS,
} from "./presets.ts";

/**
 * The Play screen section of Settings (D150, spec §12): three layouts plus the four dials.
 * Changes apply at once and are remembered on this device; there is no Save button to forget.
 */
export function PlayPreferencesPanel({
  value,
  onChange,
}: {
  value: PlayPreferences;
  onChange: (next: PlayPreferences) => void;
}) {
  const current = PRESET_OPTIONS.find((option) => option.id === value.preset);
  return (
    <div className="campaign-settings play-preferences">
      <fieldset>
        <legend>Play screen</legend>
        <p className="muted small">
          The layouts share the same story, dice, cards and menus. Switch at any time; this device remembers.
        </p>
        <fieldset className="preset-buttons">
          <legend className="sr-only">Play screen preset</legend>
          {PRESET_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.hint}
              aria-pressed={value.preset === option.id}
              onClick={() => onChange({ ...value, preset: option.id })}
            >
              {option.label}
            </button>
          ))}
          <button type="button" disabled title="Arrives with the media pipeline (M8).">
            Visual Novel
          </button>
        </fieldset>
        {current && <p className="muted small">{current.hint}</p>}
        <div className="form-row">
          <label>
            Text size
            <select
              aria-label="Text size"
              value={value.textSize}
              onChange={(e) =>
                onChange({ ...value, textSize: e.target.value as PlayPreferences["textSize"] })
              }
            >
              {TEXT_SIZE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Column width
            <select
              aria-label="Column width"
              value={value.column}
              onChange={(e) => onChange({ ...value, column: e.target.value as PlayPreferences["column"] })}
            >
              {COLUMN_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Density
            <select
              aria-label="Density"
              value={value.density}
              onChange={(e) => onChange({ ...value, density: e.target.value as PlayPreferences["density"] })}
            >
              {DENSITY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Motion
            <select
              aria-label="Motion"
              value={value.motion}
              onChange={(e) => onChange({ ...value, motion: e.target.value as PlayPreferences["motion"] })}
            >
              {MOTION_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
    </div>
  );
}

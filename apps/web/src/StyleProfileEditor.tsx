import type { StyleProfile, ThemeSpec } from "@wyrd/core";
import { ThemeSpec as ThemeSchema } from "@wyrd/core";
import { useEffect, useState } from "react";

export function StyleProfileEditor({
  value,
  onChange,
  disabled,
}: {
  value: StyleProfile;
  onChange: (value: StyleProfile) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>Story style</legend>
      <label>
        Source style <span className="muted">(blank uses the house style)</span>
        <textarea
          value={value.source}
          maxLength={12000}
          rows={3}
          onChange={(e) => onChange({ ...value, source: e.target.value })}
        />
      </label>
      <label>
        Your own words — More like…
        <textarea
          value={value.playerWords}
          maxLength={4000}
          rows={3}
          onChange={(e) => onChange({ ...value, playerWords: e.target.value })}
          placeholder="More like a tense thriller, with shorter dialogue…"
        />
      </label>
      <label>
        Sample paragraph
        <textarea
          value={value.sample}
          maxLength={6000}
          rows={5}
          onChange={(e) => onChange({ ...value, sample: e.target.value })}
          placeholder="A model-written voice sample appears here when models are connected. You can also write your own."
        />
      </label>
    </fieldset>
  );
}

/** The full palette is editable now; U5 can replace this functional editor with visual swatches. */
export function CampaignThemeEditor({
  value,
  onChange,
  disabled,
}: {
  value: ThemeSpec | null;
  onChange: (value: ThemeSpec | null) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  return (
    <label>
      Theme palette <span className="muted">(JSON with light/dark colours; null uses the house theme)</span>
      <textarea
        disabled={disabled}
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = ThemeSchema.nullable().parse(JSON.parse(e.target.value));
            e.target.setCustomValidity("");
            onChange(parsed);
          } catch {
            e.target.setCustomValidity(
              "Enter a complete light/dark theme palette, or null for the house theme.",
            );
          }
        }}
      />
    </label>
  );
}

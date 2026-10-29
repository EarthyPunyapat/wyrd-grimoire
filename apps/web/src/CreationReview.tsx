import type { CreationReview as Review, SubsystemToggles } from "@wyrd/core";
import { useEffect, useState } from "react";
import { CampaignThemeEditor, StyleProfileEditor } from "./StyleProfileEditor.tsx";

const labels: Partial<Record<keyof SubsystemToggles, string>> = {
  survival: "Survival — hunger and thirst",
  weatherEffects: "Exposure and weather",
  inventory: "Encumbrance",
  lightingAndVision: "Light and vision",
  disease: "Disease",
};
const choices: Record<string, string[]> = {
  inventory: ["abstract", "weight", "slots"],
  money: ["wealthLevels", "coins", "haggling"],
  injuries: ["simple", "realistic"],
  travelEncounters: ["reduced", "on"],
};

export function CreationReviewEditor({
  value,
  onChange,
  disabled,
  revising,
  onRevise,
}: {
  value: Review;
  onChange: (review: Review) => void;
  disabled: boolean;
  revising: boolean;
  onRevise: () => void;
}) {
  const [levelText, setLevelText] = useState(String(value.startingLevel));
  useEffect(() => setLevelText(String(value.startingLevel)), [value.startingLevel]);
  return (
    <fieldset className="creation-review" disabled={disabled}>
      <legend>GM's proposed settings — change any choice</legend>
      <p className="creation-hint">
        These come from the world and pitch. Nothing is locked until the story begins.
      </p>
      <div className="creation-picks">
        <label>
          Starting Level
          <input
            value={levelText}
            required
            pattern="[1-9][0-9]*|∞|infinite"
            onChange={(e) => {
              setLevelText(e.target.value);
              if (/^(∞|infinite)$/.test(e.target.value)) onChange({ ...value, startingLevel: "infinite" });
              else if (/^[1-9][0-9]*$/.test(e.target.value))
                onChange({ ...value, startingLevel: Number(e.target.value) });
            }}
          />
        </label>
        <label>
          Death consequences
          <select
            value={value.lethality}
            onChange={(e) => onChange({ ...value, lethality: e.target.value as Review["lethality"] })}
          >
            <option value="gritty">Gritty</option>
            <option value="brutal">Brutal</option>
          </select>
        </label>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value.companionDeath}
          onChange={(e) => onChange({ ...value, companionDeath: e.target.checked })}
        />
        Companion death (always on in Hardcore)
      </label>
      <details>
        <summary>Subsystem toggles</summary>
        {Object.entries(value.subsystems).map(([key, val]) => (
          <label
            htmlFor={`creation-sub-${key}`}
            key={key}
            className={typeof val === "boolean" ? "checkbox" : undefined}
          >
            {typeof val === "boolean" ? (
              <>
                <input
                  id={`creation-sub-${key}`}
                  type="checkbox"
                  checked={val}
                  onChange={(e) =>
                    onChange({ ...value, subsystems: { ...value.subsystems, [key]: e.target.checked } })
                  }
                />
                {labels[key as keyof SubsystemToggles] ?? key.replace(/([A-Z])/g, " $1")}
              </>
            ) : (
              <>
                {labels[key as keyof SubsystemToggles] ?? key}
                <select
                  id={`creation-sub-${key}`}
                  value={val}
                  onChange={(e) =>
                    onChange({ ...value, subsystems: { ...value.subsystems, [key]: e.target.value } })
                  }
                >
                  {choices[key]!.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </>
            )}
          </label>
        ))}
      </details>
      <CampaignThemeEditor
        value={value.theme}
        onChange={(theme) => onChange({ ...value, theme })}
        disabled={disabled}
      />
      <StyleProfileEditor
        value={value.style}
        onChange={(style) => onChange({ ...value, style })}
        disabled={disabled}
      />
      <div className="creation-style-actions">
        <button type="button" disabled={disabled} onClick={onRevise}>
          {revising ? "Revising the sample…" : "More like… Revise sample"}
        </button>
        {revising && (
          <span role="status" className="creation-style-status">
            Reading your words and rewriting the sample…
          </span>
        )}
      </div>
    </fieldset>
  );
}

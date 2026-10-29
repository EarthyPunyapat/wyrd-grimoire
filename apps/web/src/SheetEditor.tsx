import {
  ATTRIBUTE_NAMES,
  type AttributeId,
  type BackstoryHook,
  type CreationView,
  type DraftSheet,
  HookKind,
} from "@wyrd/core";
import { useId, useState } from "react";

const PHYSICAL: AttributeId[] = ["str", "agi", "end"];
const MENTAL: AttributeId[] = ["int", "awa", "wil", "pre"];
const HOOK_LABELS: Record<BackstoryHook["kind"], string> = {
  rival: "Rival or enemy",
  missing: "Someone missing",
  bond: "Someone who matters",
  debt: "A debt",
  secret: "A secret",
};
const list = (text: string) =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const pretty = (id: string) => (id.split(":")[1] ?? id).replace(/-/g, " ");

/** Resets the numbers to a background's suggested training, keeping the person (spec 04). */
export function withArchetype(draft: DraftSheet, view: CreationView, archetypeId: string): DraftSheet {
  const a = view.options.archetypes.find((x) => x.id === archetypeId);
  if (!a) return draft;
  const free = draft.talents.filter((t) => !view.options.archetypes.some((x) => x.talent === t));
  return {
    ...draft,
    archetype: a.id,
    attributes: { ...a.suggestedAttributes } as DraftSheet["attributes"],
    skills: { ...a.skills },
    talents: [a.talent, ...free].slice(
      0,
      view.options.budget.archetypeTalents + view.options.budget.freeTalents,
    ),
    background: a.description,
  };
}

/**
 * The sheet editor (spec 04): the full sheet with live validation. Every creation path lands here,
 * and only the server's validator decides whether the character can start.
 */
export function SheetEditor({
  view,
  onChange,
  disabled,
}: {
  view: CreationView;
  onChange: (draft: DraftSheet) => void;
  disabled?: boolean;
}) {
  const { draft, options, preview, issues } = view;
  const b = options.budget;
  const id = useId();
  const [newSkill, setNewSkill] = useState("");
  const [field, setField] = useState("");
  const set = (patch: Partial<DraftSheet>) => onChange({ ...draft, ...patch });
  const ancestry = options.ancestries.find((a) => a.id === draft.ancestry);
  const archetype = options.archetypes.find((a) => a.id === draft.archetype);
  const attrSpent = Object.values(draft.attributes).reduce((s, v) => s + v - b.attributeStart, 0);
  const skillSpent = Object.values(draft.skills).reduce((s, v) => s + v, 0);
  const skillPool = b.corePoints + b.interestPoints;
  const perSkill = b.coreMaxPerSkill + b.interestMaxPerSkill;
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const skillName = (sk: string) => {
    const [base, f] = sk.split("/");
    const def = options.skills.find((s) => s.id === base);
    return f ? `${def?.name ?? base} (${f})` : (def?.name ?? sk);
  };
  const freeTalent = draft.talents.find((t) => t !== archetype?.talent) ?? "";
  const selected = options.skills.find((s) => s.id === newSkill);

  const attrRow = (ids: AttributeId[]) => (
    <div className="attr-row">
      {ids.map((a) => {
        const max = ancestry?.attributeMaxBonus.includes(a) ? b.attributeMaxWithTrait : b.attributeMax;
        const v = draft.attributes[a];
        return (
          <div key={a} className="attr-stepper">
            <span title={ATTRIBUTE_NAMES[a]}>{a.toUpperCase()}</span>
            <button
              type="button"
              aria-label={`Lower ${ATTRIBUTE_NAMES[a]}`}
              disabled={disabled || v <= b.attributeStart}
              onClick={() => set({ attributes: { ...draft.attributes, [a]: v - 1 } })}
            >
              −
            </button>
            <output aria-label={ATTRIBUTE_NAMES[a]}>{v}</output>
            <button
              type="button"
              aria-label={`Raise ${ATTRIBUTE_NAMES[a]}`}
              disabled={disabled || v >= max}
              onClick={() => set({ attributes: { ...draft.attributes, [a]: v + 1 } })}
            >
              +
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="sheet-editor">
      <div className="editor-status" aria-live="polite">
        {errors.length ? (
          <ul className="error" aria-label="Rules to fix">
            {errors.map((i) => (
              <li key={`${i.code}-${i.path}`}>{i.message}</li>
            ))}
          </ul>
        ) : (
          <p className="ok">This character is ready.</p>
        )}
        {warnings.length > 0 && (
          <ul className="muted warnings">
            {warnings.map((i) => (
              <li key={`${i.code}-${i.path}`}>{i.message}</li>
            ))}
          </ul>
        )}
      </div>

      <fieldset disabled={disabled}>
        <legend>Who they are</legend>
        <div className="form-row">
          <label>
            Name
            <input value={draft.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            Pronouns <span className="muted">(optional)</span>
            <input
              value={draft.pronouns}
              maxLength={40}
              onChange={(e) => set({ pronouns: e.target.value })}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            {options.originLabel}
            <select value={draft.ancestry} onChange={(e) => set({ ancestry: e.target.value })}>
              {options.ancestries.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Background
            <select
              value={draft.archetype}
              onChange={(e) => onChange(withArchetype(draft, view, e.target.value))}
            >
              {options.archetypes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">
          Changing background resets attributes and skills to its suggested training.
        </p>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>
          Attributes{" "}
          <span className="budget">
            {b.attributePoints - attrSpent} of {b.attributePoints} points left
          </span>
        </legend>
        {attrRow(PHYSICAL)}
        {attrRow(MENTAL)}
        <p className="derived muted small">
          Vitality {preview.derived.hpMax} · Wound threshold {preview.derived.wt} · Carry{" "}
          {preview.derived.carryKg} kg · Initiative {preview.derived.initiative} · Luck {preview.status.luck}
        </p>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>
          Skills{" "}
          <span className="budget">
            {skillPool - skillSpent} of {skillPool} points left · at most +{perSkill} each
          </span>
        </legend>
        <ul className="skill-edit">
          {Object.entries(draft.skills).map(([sk, trained]) => (
            <li key={sk}>
              <label htmlFor={`${id}-${sk}`}>{skillName(sk)}</label>
              <input
                id={`${id}-${sk}`}
                type="number"
                min={1}
                max={100}
                value={trained}
                onChange={(e) =>
                  set({
                    skills: {
                      ...draft.skills,
                      [sk]: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                    },
                  })
                }
              />
              <span className="skill-value">{view.skillValues[sk] ?? "—"}%</span>
              <button
                type="button"
                aria-label={`Remove ${skillName(sk)}`}
                onClick={() =>
                  set({ skills: Object.fromEntries(Object.entries(draft.skills).filter(([k]) => k !== sk)) })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="add-skill">
          <label>
            Add a skill
            <select value={newSkill} onChange={(e) => setNewSkill(e.target.value)}>
              <option value="">Choose…</option>
              {options.skills
                .filter((s) => s.field || !(s.id in draft.skills))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.field ? " (specialised)" : ""}
                  </option>
                ))}
            </select>
          </label>
          {selected?.field && (
            <label>
              Specialisation
              <input
                value={field}
                maxLength={30}
                placeholder="e.g. history"
                onChange={(e) => setField(e.target.value)}
              />
            </label>
          )}
          <button
            type="button"
            disabled={!selected || (selected.field && !field.trim())}
            onClick={() => {
              const key = selected!.field
                ? `${selected!.id}/${field
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")}`
                : selected!.id;
              set({ skills: { ...draft.skills, [key]: 10 } });
              setNewSkill("");
              setField("");
            }}
          >
            Add
          </button>
        </div>
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>Talents</legend>
        {archetype && (
          <p>
            <strong>
              {options.talents.find((t) => t.id === archetype.talent)?.name ?? pretty(archetype.talent)}
            </strong>{" "}
            <span className="muted">from your background</span>
          </p>
        )}
        {b.freeTalents > 0 && (
          <label>
            Free pick
            <select
              value={freeTalent}
              onChange={(e) =>
                set({
                  talents: [
                    ...(archetype ? [archetype.talent] : []),
                    ...(e.target.value ? [e.target.value] : []),
                  ],
                })
              }
            >
              <option value="">None yet</option>
              {options.talents
                .filter(
                  (t) => t.id !== archetype?.talent && !options.archetypes.some((a) => a.talent === t.id),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (tier {t.tier}){t.requires.length ? ` · needs ${t.requires.join(", ")}` : ""}
                  </option>
                ))}
            </select>
          </label>
        )}
        {freeTalent && (
          <p className="muted small">{options.talents.find((t) => t.id === freeTalent)?.description}</p>
        )}
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>Looks and personality</legend>
        <div className="form-row">
          {(["build", "hair", "eyes", "skin"] as const).map((k) => (
            <label key={k}>
              {k[0]!.toUpperCase() + k.slice(1)}
              <input
                value={draft.appearance[k] ?? ""}
                maxLength={80}
                onChange={(e) =>
                  set({ appearance: { ...draft.appearance, [k]: e.target.value || undefined } })
                }
              />
            </label>
          ))}
        </div>
        <label>
          Distinguishing marks <span className="muted">(comma-separated)</span>
          <input
            key={draft.appearance.marks.join("|")}
            defaultValue={draft.appearance.marks.join(", ")}
            onBlur={(e) => set({ appearance: { ...draft.appearance, marks: list(e.target.value) } })}
          />
        </label>
        <label>
          Clothing style
          <input
            value={draft.appearance.clothingStyle ?? ""}
            maxLength={120}
            onChange={(e) =>
              set({ appearance: { ...draft.appearance, clothingStyle: e.target.value || undefined } })
            }
          />
        </label>
        <label>
          Personality <span className="muted">(a few comma-separated traits)</span>
          <input
            key={draft.personality.join("|")}
            defaultValue={draft.personality.join(", ")}
            onBlur={(e) => set({ personality: list(e.target.value).slice(0, 6) })}
          />
        </label>
        <label>
          Backstory
          <textarea
            rows={4}
            maxLength={4000}
            value={draft.backstory}
            onChange={(e) => set({ backstory: e.target.value })}
          />
        </label>
        {archetype && archetype.backstoryPrompts.length > 0 && (
          <ul className="prompts muted small">
            {archetype.backstoryPrompts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset disabled={disabled}>
        <legend>Hooks</legend>
        <p className="muted small">
          People and threads from your past. The world will find a place for each of them.
        </p>
        {draft.hooks.map((h, i) => (
          <div key={`hook-${i}`} className="hook-edit">
            <select
              aria-label="Hook kind"
              value={h.kind}
              onChange={(e) =>
                set({
                  hooks: draft.hooks.map((x, j) =>
                    j === i ? { ...x, kind: e.target.value as BackstoryHook["kind"] } : x,
                  ),
                })
              }
            >
              {HookKind.options.map((k) => (
                <option key={k} value={k}>
                  {HOOK_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              aria-label="Hook name"
              value={h.name}
              maxLength={80}
              placeholder="Name"
              onChange={(e) =>
                set({ hooks: draft.hooks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
              }
            />
            <input
              aria-label="Hook description"
              value={h.description}
              maxLength={400}
              placeholder="What happened"
              onChange={(e) =>
                set({
                  hooks: draft.hooks.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                })
              }
            />
            <button
              type="button"
              aria-label={`Remove ${h.name || "hook"}`}
              onClick={() => set({ hooks: draft.hooks.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </div>
        ))}
        {draft.hooks.length < 6 && (
          <button
            type="button"
            onClick={() =>
              set({ hooks: [...draft.hooks, { kind: "rival", name: "Unnamed", description: "" }] })
            }
          >
            Add a hook
          </button>
        )}
      </fieldset>

      {preview.equipment.carried.length > 0 && (
        <section className="editor-gear">
          <h3>Starting gear</h3>
          <p className="muted small">
            {preview.equipment.carried
              .map((c) => `${pretty(c.item)}${c.qty > 1 ? ` ×${c.qty}` : ""}`)
              .join(" · ")}
          </p>
        </section>
      )}
    </div>
  );
}

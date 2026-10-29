import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES, defaultTuning, type GameView } from "@wyrd/core";
import { DiceBadge, skillDisplay } from "./Dice.tsx";

export function Sheet({ view }: { view: GameView }) {
  const { pc } = view;
  const spells = view.spells ?? [];
  const survival = view.survival ?? {
    food: 0,
    water: 0,
    sleep: 0,
    exposure: 0,
    exposureKind: "none",
    notices: [],
  };
  return (
    <div className="sheet-content">
      <div className="eyebrow">YOUR CHARACTER</div>
      <div className="character-heading">
        <div className="portrait" aria-hidden="true">
          {pc.identity.name.slice(0, 1)}
        </div>
        <div>
          <h2>{pc.identity.name}</h2>
          <p>
            {view.originName}
            {view.backgroundName && ` · ${view.backgroundName}`}
          </p>
        </div>
      </div>
      <section className="sheet-section" aria-label="Levels and abilities">
        <h3>{`Level ${pc.level === "infinite" ? "∞" : (pc.level ?? defaultTuning.levels.start)}`}</h3>
        <p>Power rating: {view.powerRating ?? "—"}</p>
        {pc.effectiveLevel !== undefined && (
          <p>Effective level: {pc.effectiveLevel === "infinite" ? "∞" : pc.effectiveLevel}</p>
        )}
        <h3>Abilities</h3>
        {(pc.abilities ?? []).length ? (
          <ul className="plain">
            {pc.abilities.map((a) => (
              <li key={a.id}>
                <strong>{a.name}</strong> · {`Rank ${a.rank}`} · Level{" "}
                {a.level === "infinite" ? "∞" : a.level}
                <p>{a.description}</p>
                <p className="muted small">{a.cost}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No abilities yet.</p>
        )}
      </section>
      <div className="stat-label">
        <span>Vitality</span>
        <strong>
          {pc.status.hp} / {pc.derived.hpMax}
        </strong>
      </div>
      <progress aria-label="Hit points" value={pc.status.hp} max={pc.derived.hpMax} />
      <div className="stat-label">
        <span>Luck</span>
        <span className="luck" role="img" aria-label={`${pc.status.luck} Luck`}>
          {Array.from({ length: pc.status.luck }, (_, i) => (
            <span key={`luck-${i}`} aria-hidden="true">
              ◆{" "}
            </span>
          ))}
        </span>
      </div>
      <div className="sheet-section">
        <h3>Attributes</h3>
        <dl className="attributes">
          {ATTRIBUTE_IDS.map((name) => (
            <div key={name}>
              <dt title={ATTRIBUTE_NAMES[name]}>{name.toUpperCase()}</dt>
              <dd>{pc.attributes[name]}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="sheet-section">
        <h3>
          Trained skills <DiceBadge resolution={view.resolution} />
        </h3>
        <dl className="skills">
          {view.skills.map((skill) => (
            <div key={skill.id}>
              <dt>{skill.name}</dt>
              <dd>{skillDisplay(skill)}</dd>
            </div>
          ))}
        </dl>
        {view.resolution === "d20" && (
          <p className="muted small">Add each modifier to a d20 and beat the check's DC.</p>
        )}
      </div>
      {spells.length > 0 && (
        <div className="sheet-section">
          <h3>Spells</h3>
          <ul className="spells">
            {spells.map((spell) => (
              <li key={spell.id}>
                <strong>{spell.name}</strong>{" "}
                <span className="muted small">
                  {spell.school} {spell.tier} · {spell.apCost} AP · {spell.range} · {spell.strain} strain
                </span>
                {spell.description && <p className="muted small">{spell.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="sheet-section">
        <h3>Needs</h3>
        <ul className="plain small">
          <li>Food: {survival.food ? `${survival.food} day(s) without` : "fed"}</li>
          <li>Water: {survival.water ? `${survival.water} day(s) short` : "watered"}</li>
          <li>Sleep: {Math.round(survival.sleep)} h awake</li>
          <li>Exposure: {survival.exposureKind === "none" ? "comfortable" : survival.exposureKind}</li>
        </ul>
        {survival.notices.length > 0 && (
          <ul className="plain small">
            {survival.notices.map((n) => (
              <li key={n.id}>{n.text}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="sheet-section">
        <h3>Wounds & conditions</h3>
        {!pc.status.conditions.length && !pc.status.wounds.length ? (
          <p className="muted">Unharmed. For now.</p>
        ) : (
          <ul>
            {pc.status.conditions.map((c) => (
              <li key={c.id}>
                {c.id.split(":")[1]} {c.note}
              </li>
            ))}
            {pc.status.wounds.map((w) => (
              <li key={w.id}>
                {w.severity} · {w.location}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="sheet-section">
        <h3>In your company</h3>
        {view.scene?.present.length ? (
          <ul className="present">
            {view.scene.present.map((p) => (
              <li key={p.id}>
                <span aria-hidden="true">○</span> {p.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No one nearby.</p>
        )}
      </div>
      <p className="sheet-footnote">Fate keeps its own counsel.</p>
    </div>
  );
}

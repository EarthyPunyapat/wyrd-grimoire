import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES, type GameView } from "@wyrd/core";

export function Sheet({ view }: { view: GameView }) {
  const { pc } = view;
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
            {pc.identity.ancestry.split(":")[1]} · {pc.archetypeId?.split(":")[1]}
          </p>
        </div>
      </div>
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
        <h3>Trained skills</h3>
        <dl className="skills">
          {view.skills.map((skill) => (
            <div key={skill.id}>
              <dt>{skill.name}</dt>
              <dd>{skill.value}%</dd>
            </div>
          ))}
        </dl>
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

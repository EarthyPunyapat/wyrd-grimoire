import type { CampaignImport } from "@wyrd/core";
import { useEffect, useState } from "react";
export function CharacterArrival({
  pc,
  adapted,
  adapting,
  onChange,
  onAdapt,
  onReset,
  disabled,
}: {
  pc: CampaignImport["pc"];
  adapted: boolean;
  adapting: boolean;
  onChange: (pc: CampaignImport["pc"]) => void;
  onAdapt: () => void;
  onReset: () => void;
  disabled: boolean;
}) {
  const [levelText, setLevelText] = useState(String(pc.level));
  useEffect(() => setLevelText(String(pc.level)), [pc.level]);
  return (
    <fieldset className="card-arrival" disabled={disabled}>
      <legend>{pc.name}'s arrival</legend>
      <label className="checkbox">
        <input type="radio" name="arrival" checked={!adapted && !adapting} onChange={onReset} />
        Arrive as-is
      </label>
      <label className="checkbox">
        <input type="radio" name="arrival" checked={adapted || adapting} onChange={onAdapt} />
        Let the GM adapt
      </label>
      {!adapted ? (
        <p>Level {pc.level === "infinite" ? "∞" : pc.level}. Your card and companions arrive unchanged.</p>
      ) : (
        <>
          <p>Edit this proposal before Begin. Your saved card stays unchanged.</p>
          <label>
            Arrival Level
            <input
              value={levelText}
              required
              pattern="[1-9][0-9]*|∞|infinite"
              onChange={(e) => {
                const s = e.target.value;
                setLevelText(s);
                if (/^(∞|infinite)$/.test(s)) onChange({ ...pc, level: "infinite" });
                else if (/^[1-9][0-9]*$/.test(s)) onChange({ ...pc, level: Number(s) });
              }}
            />
          </label>
          <label>
            Arrival backstory
            <textarea
              value={pc.backstory}
              minLength={1}
              maxLength={4000}
              required
              onChange={(e) => onChange({ ...pc, backstory: e.target.value })}
            />
          </label>
          {pc.abilities.map((a, i) => (
            <div className="arrival-ability" key={i}>
              <label>
                Ability {i + 1} name
                <input
                  value={a.name}
                  required
                  maxLength={80}
                  onChange={(e) =>
                    onChange({
                      ...pc,
                      abilities: pc.abilities.map((v, n) => (n === i ? { ...v, name: e.target.value } : v)),
                    })
                  }
                />
              </label>
              <label>
                Ability {i + 1} description
                <textarea
                  value={a.description}
                  required
                  maxLength={400}
                  onChange={(e) =>
                    onChange({
                      ...pc,
                      abilities: pc.abilities.map((v, n) =>
                        n === i ? { ...v, description: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Ability {i + 1} rank
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={a.rank}
                  onChange={(e) =>
                    onChange({
                      ...pc,
                      abilities: pc.abilities.map((v, n) =>
                        n === i ? { ...v, rank: Number(e.target.value) } : v,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() => onChange({ ...pc, abilities: pc.abilities.filter((_, n) => n !== i) })}
              >
                Remove ability {i + 1}
              </button>
            </div>
          ))}
          {pc.gear.map((g, i) => (
            <div key={i}>
              <label>
                Gear {i + 1} name
                <input
                  value={g.name}
                  required
                  maxLength={80}
                  onChange={(e) =>
                    onChange({
                      ...pc,
                      gear: pc.gear.map((v, n) => (n === i ? { ...v, name: e.target.value } : v)),
                    })
                  }
                />
              </label>
              <label>
                Gear {i + 1} description
                <textarea
                  value={g.description}
                  maxLength={400}
                  onChange={(e) =>
                    onChange({
                      ...pc,
                      gear: pc.gear.map((v, n) => (n === i ? { ...v, description: e.target.value } : v)),
                    })
                  }
                />
              </label>
            </div>
          ))}
        </>
      )}
    </fieldset>
  );
}

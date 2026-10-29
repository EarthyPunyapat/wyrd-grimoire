import type { CombatView } from "@wyrd/core";
import { useState } from "react";
import { DiceBadge, type Resolution } from "./Dice.tsx";

type Combatant = CombatView["combatants"][number];

const SEVERITY_CLASS: Record<string, string> = {
  minor: "minor",
  serious: "serious",
  critical: "critical",
  lethal: "critical",
};

/** Zone boxes on a grid, sized to the diagram; positions come from the order zones are listed in. */
function layout(zones: CombatView["zones"]) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(zones.length)));
  const rows = Math.ceil(zones.length / cols);
  const w = 330;
  const gap = 14;
  const bw = (w - gap * (cols + 1)) / cols;
  const bh = 72;
  return {
    width: w,
    height: rows * bh + gap * (rows + 1),
    boxes: new Map(
      zones.map((z, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        return [z.id, { x: gap + c * (bw + gap), y: gap + r * (bh + gap), w: bw, h: bh }];
      }),
    ),
  };
}

const initial = (name: string) => name.replace(/^the /i, "").charAt(0).toUpperCase();
const pct = (n: number) => `${Math.round(n * 100)}%`;

function HealthBar({ value, label }: { value: number; label: string }) {
  return (
    <span className="hp-bar" role="img" aria-label={label}>
      <b style={{ width: pct(value) }} />
    </span>
  );
}

/** A tiny body silhouette with wounded locations shaded (spec 13 target card). */
function Silhouette({ wounds }: { wounds: Combatant["wounds"] }) {
  const at = (...locs: string[]) => {
    const w = wounds.filter((x) => locs.some((loc) => x.location.includes(loc)));
    return w.length ? `fig ${SEVERITY_CLASS[w.at(-1)!.severity] ?? ""}` : "fig";
  };
  return (
    <svg viewBox="0 0 40 80" className="silhouette" aria-hidden="true">
      <circle cx="20" cy="9" r="7" className={at("head")} />
      <rect x="12" y="17" width="16" height="26" rx="4" className={at("torso", "body")} />
      <rect x="4" y="18" width="7" height="24" rx="3" className={at("right-arm", "right-foreleg")} />
      <rect x="29" y="18" width="7" height="24" rx="3" className={at("left-arm", "left-foreleg")} />
      <rect x="12" y="44" width="7" height="32" rx="3" className={at("right-leg", "right-hindleg")} />
      <rect x="21" y="44" width="7" height="32" rx="3" className={at("left-leg", "left-hindleg")} />
    </svg>
  );
}

export function CombatPanel({
  combat,
  busy,
  onFill,
  resolution = "d100",
}: {
  combat: CombatView;
  busy: boolean;
  onFill: (text: string) => void;
  resolution?: Resolution;
}) {
  const enemies = combat.combatants.filter((c) => c.side === "enemy");
  const [targetId, setTargetId] = useState<string | null>(null);
  const target =
    combat.combatants.find((c) => c.id === targetId) ??
    enemies.find((c) => c.status === "active") ??
    enemies[0];
  const current = combat.combatants.find((c) => c.id === combat.currentActorId);
  const map = layout(combat.zones);
  const centre = (zoneId: string) => {
    const b = map.boxes.get(zoneId);
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: 0, y: 0 };
  };
  const tokens = new Map<string, { x: number; y: number }>();
  for (const z of combat.zones) {
    const here = combat.combatants.filter((c) => c.zoneId === z.id && c.status !== "fled");
    const b = map.boxes.get(z.id)!;
    here.forEach((c, i) => {
      tokens.set(c.id, { x: b.x + 18 + i * 27, y: b.y + b.h - 18 });
    });
  }
  const engagements = combat.combatants.flatMap((c) =>
    c.engagedWith.filter((o) => o > c.id).map((o) => [c.id, o] as const),
  );
  return (
    <section className="combat-panel" aria-label="Combat">
      <div className="combat-head">
        <span className="label">
          Round {combat.round} · initiative <DiceBadge resolution={resolution} />
        </span>
        <span className="small">
          {combat.yourTurn ? "Your turn" : `${current?.name ?? "Someone"}'s turn`}
        </span>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the strip scrolls sideways and must be reachable by keyboard */}
      <ol className="init" aria-label="Initiative order" tabIndex={0}>
        {combat.combatants.map((c) => (
          <li
            key={c.id}
            className={`combatant ${c.side}${c.id === combat.currentActorId ? " current" : ""}${c.status !== "active" ? " out" : ""}`}
          >
            <span className="mono" aria-hidden="true">
              {initial(c.name)}
            </span>
            <span className="name">
              {c.name}
              {c.status === "fleeing" ? " · fleeing" : ""}
            </span>
            <HealthBar value={c.health} label={`${c.name}: ${c.condition}`} />
          </li>
        ))}
      </ol>
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG can't be a <fieldset>; it groups the map's controls */}
      <svg
        className="zones"
        viewBox={`0 0 ${map.width} ${map.height}`}
        role="group"
        aria-label={`Battlefield: ${combat.zones
          .map(
            (z) =>
              `${z.name} (${
                combat.combatants
                  .filter((c) => c.zoneId === z.id)
                  .map((c) => c.name)
                  .join(", ") || "empty"
              })`,
          )
          .join("; ")}`}
      >
        {combat.edges.map((e) => {
          const a = centre(e.a);
          const b = centre(e.b);
          return <line key={`${e.a}-${e.b}`} className="zedge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
        {combat.zones.map((z) => {
          const b = map.boxes.get(z.id)!;
          const mine = combat.combatants.find((c) => c.side === "pc")?.zoneId === z.id;
          return (
            <g key={z.id} className={`zone${mine ? " here" : ""}`}>
              {/* biome-ignore lint/a11y/useSemanticElements: SVG shapes can't be <button> elements */}
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx="10"
                role="button"
                tabIndex={mine ? -1 : 0}
                aria-label={mine ? `${z.name} (you are here)` : `Move to ${z.name}`}
                onClick={() => !busy && !mine && onFill(`I move to ${z.name}`)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !busy && !mine) {
                    e.preventDefault();
                    onFill(`I move to ${z.name}`);
                  }
                }}
              />
              <text x={b.x + 10} y={b.y + 18} className="zname">
                {z.name}
              </text>
              {z.tags.length > 0 && (
                <text x={b.x + 10} y={b.y + 32} className="ztag">
                  {z.tags.join(" · ")}
                </text>
              )}
            </g>
          );
        })}
        {engagements.map(([a, b]) => {
          const p = tokens.get(a);
          const q = tokens.get(b);
          return p && q ? (
            <line key={`${a}-${b}`} className="engage" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
          ) : null;
        })}
        {combat.combatants.map((c) => {
          const p = tokens.get(c.id);
          if (!p) return null;
          return (
            // biome-ignore lint/a11y/useSemanticElements: SVG groups can't be <button> elements
            <g
              key={c.id}
              className={`token ${c.side}${c.id === target?.id ? " selected" : ""}${c.status !== "active" ? " out" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`Select ${c.name} (${c.condition})`}
              onClick={() => setTargetId(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setTargetId(c.id);
                }
              }}
            >
              <circle cx={p.x} cy={p.y} r="12" />
              <text x={p.x} y={p.y + 4} textAnchor="middle">
                {initial(c.name)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="ap-row">
        <span className="label">Action points</span>
        <span className="pips" role="img" aria-label={`${combat.ap.current} of ${combat.ap.max} AP`}>
          {Array.from({ length: combat.ap.max }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: pips are positional
            <i key={i} className={i < combat.ap.current ? "on" : ""} />
          ))}
        </span>
      </div>
      <fieldset className="actions">
        <legend className="sr-only">Legal actions</legend>
        {combat.actions.map((a) => (
          <button
            type="button"
            key={a.label}
            className={`act${a.legal ? "" : " dim"}`}
            aria-disabled={!a.legal || busy}
            title={a.reason}
            onClick={() => a.legal && !busy && onFill(a.fill)}
          >
            {a.label}
            <span className="cost">{a.ap} AP</span>
          </button>
        ))}
      </fieldset>
      {target && (
        <div className="target" aria-live="polite">
          <div>
            <h4>{target.name}</h4>
            <p className="small">
              {target.condition}
              {target.engagedWith.length
                ? ` · engaged with ${target.engagedWith.map((id) => combat.combatants.find((c) => c.id === id)?.name ?? id).join(", ")}`
                : ""}
            </p>
            <p className="small">
              {target.wounds.length
                ? target.wounds.map((w) => `${w.severity} ${w.location.replace(/-/g, " ")}`).join(", ")
                : "no visible wounds"}
              {target.conditions.length ? ` · ${target.conditions.join(", ")}` : ""}
            </p>
            {target.side === "enemy" && target.status === "active" && (
              <button
                type="button"
                className="act"
                disabled={busy}
                onClick={() => onFill(`I attack ${target.name}`)}
              >
                Attack {target.name}
              </button>
            )}
          </div>
          <Silhouette wounds={target.wounds} />
        </div>
      )}
    </section>
  );
}

/** Phone: the initiative strip above the composer (spec 13). */
export function CombatStrip({ combat }: { combat: CombatView }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the strip scrolls sideways and must be reachable by keyboard
    <ol className="combat-strip" aria-label="Initiative order" tabIndex={0}>
      {combat.combatants.map((c) => (
        <li
          key={c.id}
          className={`combatant ${c.side}${c.id === combat.currentActorId ? " current" : ""}${c.status !== "active" ? " out" : ""}`}
        >
          <span className="mono" aria-hidden="true">
            {initial(c.name)}
          </span>
          <span className="name">{c.name}</span>
        </li>
      ))}
    </ol>
  );
}

import { defaultTuning, type GameView } from "@wyrd/core";

export type Menu = "sheet" | "inventory" | "party" | "journal" | "codex" | "map" | "timeline";

/** Menus in strip order; a key is a hint beside the name, never the accessible name (DESIGN.md Status Strip). */
const MENUS: { id: Menu; name: string; key?: string }[] = [
  { id: "sheet", name: "Sheet", key: "C" },
  { id: "inventory", name: "Inventory", key: "I" },
  { id: "journal", name: "Journal", key: "J" },
  { id: "map", name: "Map", key: "M" },
  { id: "party", name: "Party" },
  { id: "codex", name: "Codex" },
  { id: "timeline", name: "Timeline" },
];

const clock = (minutes: number) =>
  `${Math.floor((minutes % 1440) / 60)
    .toString()
    .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;

export function StatusStrip({
  view,
  active,
  onMenu,
  onSettings,
  onHome,
  onAppSettings,
  offline,
}: {
  view: GameView;
  active?: Menu | null;
  onMenu: (menu: Menu) => void;
  onSettings: () => void;
  /** The app bar's home and settings live in the strip while playing: Reader has one band of chrome. */
  onHome?: () => void;
  onAppSettings?: () => void;
  offline?: boolean;
}) {
  const day = Math.floor(view.gameTime / 1440) + 1;
  return (
    <header className="status-strip location-bar" data-component="status-strip">
      {onHome && (
        <button type="button" className="strip-wordmark" onClick={onHome} aria-label="Wyrd Grimoire home">
          Wyrd
        </button>
      )}
      <span className="strip-place">
        {view.scene?.location ?? "Between chapters"}
        {view.scene?.zone ? ` · ${view.scene.zone}` : ""}
      </span>
      <span className="strip-name">{view.pc.identity.name}</span>
      <span className="strip-meta">{`Level ${view.pc.level === "infinite" ? "∞" : (view.pc.level ?? defaultTuning.levels.start)}`}</span>
      <span className="strip-meta">
        HP {view.pc.status.hp}/{view.pc.derived.hpMax}
      </span>
      <span className="strip-meta">
        Day {day} · {clock(view.gameTime)}
        {view.scene?.weather ? ` · ${view.scene.weather}` : ""}
      </span>
      <span className="strip-spacer" />
      <nav className="strip-menus" aria-label="Menus">
        {MENUS.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-current={active === m.id ? "true" : undefined}
            onClick={() => onMenu(m.id)}
          >
            {m.key && (
              <span className="key" aria-hidden="true">
                {m.key}
              </span>
            )}
            {m.name}
          </button>
        ))}
        <button type="button" onClick={onSettings} aria-label="Campaign settings" title="Campaign settings">
          <span aria-hidden="true">⚙</span>
        </button>
        {offline && <span className="strip-offline">Offline</span>}
        {onAppSettings && (
          <button type="button" onClick={onAppSettings}>
            Settings
          </button>
        )}
      </nav>
    </header>
  );
}

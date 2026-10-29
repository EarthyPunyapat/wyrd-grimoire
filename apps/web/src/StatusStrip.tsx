import { defaultTuning, type GameView } from "@wyrd/core";
import { GameIcon, type GameIconName } from "./icons.tsx";
import type { MenuTab } from "./Menus.tsx";

export type Menu = MenuTab;

/** Menus in strip order; a key is a hint beside the name, never the accessible name (DESIGN.md Status Strip). */
const MENUS: { id: Menu; name: string; key?: string; icon: GameIconName }[] = [
  { id: "character", name: "Character", key: "C", icon: "person" },
  { id: "inventory", name: "Inventory", key: "I", icon: "bag" },
  { id: "quests", name: "Quests", key: "Q", icon: "scroll" },
  { id: "journal", name: "Journal", key: "J", icon: "book" },
  { id: "codex", name: "Codex", icon: "gems" },
  { id: "map", name: "Map", key: "M", icon: "map" },
  { id: "timeline", name: "Timeline", icon: "hourglass" },
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
            <GameIcon name={m.icon} size={14} />
            {m.key && (
              <span className="key" aria-hidden="true">
                {m.key}
              </span>
            )}
            <span className="menu-name">{m.name}</span>
          </button>
        ))}
        <button type="button" onClick={onSettings} aria-label="Campaign settings" title="Campaign settings">
          <GameIcon name="gears" size={14} />
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

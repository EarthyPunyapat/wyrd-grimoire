import { defaultTuning, type GameView } from "@wyrd/core";
import { ChromeIcon, type ChromeIconName } from "./icons.tsx";
import type { MenuTab } from "./Menus.tsx";

export type Menu = MenuTab;

/** Menus in strip order; a key is a hint beside the name, never the accessible name (DESIGN.md Status Strip). */
const MENUS: { id: Menu; name: string; key?: string; icon: ChromeIconName }[] = [
  { id: "character", name: "Character", key: "C", icon: "person" },
  { id: "inventory", name: "Inventory", key: "I", icon: "backpack" },
  { id: "market", name: "Market", icon: "coins" },
  { id: "quests", name: "Quests", key: "Q", icon: "quest" },
  { id: "journal", name: "Journal", key: "J", icon: "book" },
  { id: "codex", name: "Codex", icon: "gem" },
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
  offline,
}: {
  view: GameView;
  active?: Menu | null;
  onMenu: (menu: Menu) => void;
  onSettings: () => void;
  /** The app bar's home lives in the strip while playing: Reader has one band of chrome. */
  onHome?: () => void;
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
        {/* Market appears only while a merchant is where the PC stands. */}
        {MENUS.filter((m) => m.id !== "market" || view.shop).map((m) => (
          <button
            key={m.id}
            type="button"
            aria-current={active === m.id ? "true" : undefined}
            onClick={() => onMenu(m.id)}
          >
            <ChromeIcon name={m.icon} size={15} />
            {m.key && (
              <span className="key" aria-hidden="true">
                {m.key}
              </span>
            )}
            <span className="menu-name">{m.name}</span>
          </button>
        ))}
        {/* One Settings screen: the campaign's rules and this device's display and models (D163). */}
        <button type="button" aria-current={active === "settings" ? "true" : undefined} onClick={onSettings}>
          <ChromeIcon name="gear" size={15} />
          <span className="menu-name">Settings</span>
        </button>
        {offline && <span className="strip-offline">Offline</span>}
      </nav>
    </header>
  );
}

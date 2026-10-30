import type { GameView } from "@wyrd/core";
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { CampaignSettingsPanel } from "./CampaignSettings.tsx";
import { Inventory } from "./Inventory.tsx";
import { ChromeIcon, type ChromeIconName } from "./icons.tsx";
import { KeepCampaign } from "./KeepCampaign.tsx";
import { Party } from "./Party.tsx";
import { Sheet } from "./Sheet.tsx";
import { Timeline } from "./Timeline.tsx";
import { Codex, Journal, Quests, WorldMap } from "./World.tsx";

/** The full-screen status screen's tabs (spec §12, U4). Key hints are hints, never names. */
export const MENU_TABS = [
  { id: "character", label: "Character", key: "C", icon: "person" },
  { id: "inventory", label: "Inventory", key: "I", icon: "backpack" },
  { id: "quests", label: "Quests", key: "Q", icon: "quest" },
  { id: "journal", label: "Journal", key: "J", icon: "book" },
  { id: "codex", label: "Codex", key: null, icon: "gem" },
  { id: "map", label: "Map", key: "M", icon: "map" },
  { id: "timeline", label: "Timeline", key: null, icon: "hourglass" },
  { id: "settings", label: "Settings", key: null, icon: "gear" },
] as const satisfies readonly {
  id: string;
  label: string;
  key: string | null;
  icon: ChromeIconName;
}[];

export type MenuTab = (typeof MENU_TABS)[number]["id"];

export const MENU_LABEL: Record<MenuTab, string> = Object.fromEntries(
  MENU_TABS.map((tab) => [tab.id, tab.label]),
) as Record<MenuTab, string>;

const isMenuTab = (value: string): value is MenuTab => MENU_TABS.some((tab) => tab.id === value);

/**
 * The status screen (U4): one full-screen tabbed surface over the story. The panel is the ARIA
 * tabpanel; the tablist owns arrow-key movement, and Escape is Radix Dialog's close.
 */
export function Menus({
  view,
  tab,
  onTab,
  onRefresh,
  onSend,
  onTravel,
  onOpenCodex,
  onOpenCampaign,
  onClose,
  codexFocus,
  appSettings,
}: {
  view: GameView;
  tab: MenuTab;
  onTab: (tab: MenuTab) => void;
  onRefresh: () => void | Promise<void>;
  onSend: (text: string) => void;
  onTravel: (text: string) => void;
  onOpenCodex: (id: string) => void;
  onOpenCampaign?: (id: string) => void | Promise<void>;
  onClose: () => void;
  codexFocus?: string | null;
  /** Device, display and model settings: the one Settings screen holds them with the campaign's rules. */
  appSettings?: ReactNode;
}) {
  const tablist = useRef<HTMLDivElement>(null);
  const stamp = view.turns.length;
  useEffect(() => {
    tablist.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [tab]);
  const tabs = MENU_TABS;
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((entry) => entry.id === tab);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next]!;
    onTab(target.id);
    requestAnimationFrame(() =>
      tablist.current?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus(),
    );
  };
  return (
    <div className="status-screen">
      <header className="status-head">
        <p className="status-context">
          {view.pc.identity.name} · {view.scene?.location ?? view.name}
        </p>
      </header>
      <div ref={tablist} className="status-tabs" role="tablist" aria-label="Status screen" onKeyDown={move}>
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`menu-tab-${entry.id}`}
            data-tab={entry.id}
            aria-selected={tab === entry.id}
            aria-controls="menu-panel"
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => onTab(entry.id)}
          >
            <ChromeIcon name={entry.icon} size={18} />
            {entry.key && (
              <span className="key" aria-hidden="true">
                {entry.key}
              </span>
            )}
            <span className="tab-label">{entry.label}</span>
          </button>
        ))}
      </div>
      <section
        id="menu-panel"
        className={`status-panel panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`menu-tab-${tab}`}
      >
        <div className="status-inner">
          <button type="button" className="status-back" onClick={onClose}>
            <span aria-hidden="true">←</span> Back to the story <kbd>Esc</kbd>
          </button>
          {tab === "character" && (
            <div className="status-character">
              <section className="status-section" aria-label="Character">
                <Sheet view={view} />
              </section>
              <section className="status-section status-party" aria-label="Party">
                <Party campaignId={view.id} stamp={stamp} onChanged={onRefresh} />
              </section>
            </div>
          )}
          {tab === "inventory" && <Inventory view={view} onChanged={onRefresh} onSend={onSend} />}
          {tab === "quests" && <Quests campaignId={view.id} stamp={stamp} />}
          {tab === "journal" && (
            <Journal
              campaignId={view.id}
              stamp={stamp}
              skills={view.skills}
              present={view.scene?.present ?? []}
            />
          )}
          {tab === "codex" && (
            <Codex
              campaignId={view.id}
              stamp={stamp}
              focus={codexFocus ?? null}
              watched={view.watched.map((e) => e.id)}
              onChanged={onRefresh}
            />
          )}
          {tab === "map" && (
            <WorldMap
              campaignId={view.id}
              stamp={stamp}
              onTravel={onTravel}
              onCodex={onOpenCodex}
              place={view.scene ? { location: view.scene.location, zone: view.scene.zone } : null}
            />
          )}
          {tab === "timeline" && (
            <Timeline
              campaignId={view.id}
              stamp={stamp}
              onChanged={onRefresh}
              {...(onOpenCampaign ? { onOpenCampaign } : {})}
            />
          )}
          {tab === "settings" && (
            <div className="settings-screen">
              {appSettings && (
                <nav className="settings-jump" aria-label="Settings sections">
                  {[
                    ["settings-campaign", "This campaign"],
                    ["settings-app", "Display, device and models"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className="small-link"
                      onClick={() => document.getElementById(id!)?.scrollIntoView({ block: "start" })}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
              )}
              <section className="status-section" aria-labelledby="settings-campaign">
                <h3 id="settings-campaign">This campaign</h3>
                <p className="status-lede">The rules of {view.name}.</p>
                <CampaignSettingsPanel campaignId={view.id} />
                <KeepCampaign campaignId={view.id} />
              </section>
              {appSettings && (
                <section className="status-section" aria-labelledby="settings-app">
                  <h3 id="settings-app">This device and your models</h3>
                  {appSettings}
                </section>
              )}
            </div>
          )}
        </div>
      </section>
      <footer className="status-foot">
        <span>
          <kbd>←</kbd> <kbd>→</kbd> change tab
        </span>
        <span>
          <kbd>C</kbd> character <kbd>I</kbd> inventory <kbd>Q</kbd> quests <kbd>J</kbd> journal <kbd>M</kbd>{" "}
          map
        </span>
        <span>
          <kbd>Esc</kbd> story
        </span>
      </footer>
    </div>
  );
}

export { isMenuTab };

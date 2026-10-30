import type { Ability, GameView, Level } from "@wyrd/core";
import { useEffect, useId, useRef, useState } from "react";
import { ChromeIcon, type ChromeIconName } from "./icons.tsx";

/**
 * The ability hotbar (DESIGN.md Hotbar, spec §12). The GM actions every character has sit beside one
 * Abilities button: a character's own powers grow without limit, so they live in its list, not the bar.
 */
export type HotbarAction = { name: string; key: string; icon: ChromeIconName; fill?: string; send?: string };

export const HOTBAR_ACTIONS: HotbarAction[] = [
  { name: "Observe", key: "O", icon: "eye", fill: "Observe " },
  { name: "Time skip", key: "T", icon: "clock", fill: "Time skip: " },
  { name: "Choices", key: "G", icon: "list", send: "Give me choices" },
  { name: "GM mode", key: "/", icon: "wand", fill: "/gm " },
];

/** D134: only a Level-∞ sovereign seals their power or sends a finite avatar into the world. */
const SOVEREIGN_ACTIONS: HotbarAction[] = [
  { name: "Seal", key: "S", icon: "lock", fill: "Seal my power at Level " },
  { name: "Send avatar", key: "A", icon: "avatar", fill: "Send an avatar at Level " },
];

/** The key that opens the Abilities list (spec §12 keyboard map). */
export const ABILITIES_KEY = "K";

export function Hotbar({
  abilities = [],
  companions = [],
  level,
  busy,
  inCombat,
  onFill,
  onSend,
  onCombat,
  abilitiesOpen,
  onAbilitiesOpen,
}: {
  abilities?: Ability[];
  companions?: GameView["companions"];
  level?: Level;
  busy: boolean;
  inCombat: boolean;
  onFill: (text: string) => void;
  onSend: (text: string) => void;
  onCombat: () => void;
  /** Controlled by the play screen so the K key can toggle it; uncontrolled when omitted. */
  abilitiesOpen?: boolean;
  onAbilitiesOpen?: (open: boolean) => void;
}) {
  const loyal =
    companions.find((c) => c.loyal && c.name.toLowerCase() === "ari") ?? companions.find((c) => c.loyal);
  const actions = level === "infinite" ? [...SOVEREIGN_ACTIONS, ...HOTBAR_ACTIONS] : HOTBAR_ACTIONS;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = abilitiesOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onAbilitiesOpen?.(next);
  };
  const [filter, setFilter] = useState("");
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const shown = abilities.filter((a) =>
    `${a.name} ${a.description}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOwnOpen(false);
        onAbilitiesOpen?.(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onAbilitiesOpen]);
  const use = (ability: Ability) => {
    setOpen(false);
    setFilter("");
    onFill(`Use ${ability.name}: `);
  };
  return (
    <>
      <div
        ref={panel}
        id={panelId}
        className="abilities-panel"
        role="dialog"
        aria-label="Abilities"
        hidden={!open}
      >
        <header>
          <h2>Abilities</h2>
          <button
            type="button"
            className="abilities-close"
            aria-label="Close abilities"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>
        {abilities.length > 6 && (
          <input
            type="search"
            aria-label="Find an ability"
            placeholder="Find an ability…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        {abilities.length ? (
          <ul className="abilities-list">
            {shown.map((a) => (
              <li key={a.id}>
                <button type="button" disabled={busy} onClick={() => use(a)}>
                  <span className="ability-head">
                    <ChromeIcon name="sparkle" size={16} />
                    <strong>{a.name}</strong>
                    <span className="ability-meta">
                      Rank {a.rank} · Level {a.level === "infinite" ? "∞" : a.level}
                    </span>
                  </span>
                  {a.description && <span className="ability-desc">{a.description}</span>}
                  {a.cost && <span className="ability-cost">{a.cost}</span>}
                </button>
              </li>
            ))}
            {!shown.length && <li className="muted small">No ability matches “{filter}”.</li>}
          </ul>
        ) : (
          <p className="muted small">No abilities yet. The GM grants them as your character grows.</p>
        )}
      </div>
      <nav className="hotbar" data-component="hotbar" aria-label="Actions">
        {inCombat && (
          <button type="button" className="hotbar-danger" onClick={onCombat}>
            <ChromeIcon name="swords" size={16} />
            <span className="key" aria-hidden="true">
              X
            </span>
            Combat
          </button>
        )}
        {loyal && (
          <button type="button" disabled={busy} onClick={() => onFill(`Delegate to ${loyal.name}: `)}>
            <ChromeIcon name="users" size={16} />
            Delegate to {loyal.name}
          </button>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          className={open ? "hotbar-open" : undefined}
          onClick={() => setOpen(!open)}
        >
          <ChromeIcon name="sparkle" size={16} />
          <span className="key" aria-hidden="true">
            {ABILITIES_KEY}
          </span>
          Abilities
          {abilities.length > 0 && <span className="hotbar-count">{abilities.length}</span>}
        </button>
        {actions.map((a) => (
          <button
            key={a.name}
            type="button"
            disabled={busy && Boolean(a.send)}
            onClick={() => (a.send ? onSend(a.send) : onFill(a.fill ?? ""))}
          >
            <ChromeIcon name={a.icon} size={16} />
            <span className="key" aria-hidden="true">
              {a.key}
            </span>
            {a.name}
          </button>
        ))}
      </nav>
    </>
  );
}

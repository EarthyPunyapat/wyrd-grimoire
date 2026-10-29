import type { Ability, GameView, Level } from "@wyrd/core";
/**
 * The ability hotbar (DESIGN.md Hotbar, spec §12). Until Levels, avatars and delegation land, it holds
 * the GM actions every character has; step 3 adds the character's own powers.
 */
export type HotbarAction = { name: string; key: string; fill?: string; send?: string };

export const HOTBAR_ACTIONS: HotbarAction[] = [
  { name: "Observe", key: "O", fill: "Observe " },
  { name: "Time skip", key: "T", fill: "Time skip: " },
  { name: "Choices", key: "G", send: "Give me choices" },
  { name: "GM mode", key: "/", fill: "/gm " },
];

/** D134: only a Level-∞ sovereign seals their power or sends a finite avatar into the world. */
const SOVEREIGN_ACTIONS: HotbarAction[] = [
  { name: "Seal", key: "S", fill: "Seal my power at Level " },
  { name: "Send avatar", key: "A", fill: "Send an avatar at Level " },
];

export function Hotbar({
  abilities = [],
  companions = [],
  level,
  busy,
  inCombat,
  onFill,
  onSend,
  onCombat,
}: {
  abilities?: Ability[];
  companions?: GameView["companions"];
  level?: Level;
  busy: boolean;
  inCombat: boolean;
  onFill: (text: string) => void;
  onSend: (text: string) => void;
  onCombat: () => void;
}) {
  const loyal =
    companions.find((c) => c.loyal && c.name.toLowerCase() === "ari") ?? companions.find((c) => c.loyal);
  const actions = level === "infinite" ? [...SOVEREIGN_ACTIONS, ...HOTBAR_ACTIONS] : HOTBAR_ACTIONS;
  return (
    <nav className="hotbar" data-component="hotbar" aria-label="Actions">
      {inCombat && (
        <button type="button" className="hotbar-danger" onClick={onCombat}>
          <span className="key" aria-hidden="true">
            X
          </span>
          Combat
        </button>
      )}
      {loyal && (
        <button type="button" disabled={busy} onClick={() => onFill(`Delegate to ${loyal.name}: `)}>
          Delegate to {loyal.name}
        </button>
      )}
      {abilities.map((a) => (
        <button
          type="button"
          key={a.id}
          disabled={busy}
          title={`${a.description} · ${a.cost}`}
          onClick={() => onFill(`Use ${a.name}: `)}
        >
          {a.name}
        </button>
      ))}
      {actions.map((a) => (
        <button
          key={a.name}
          type="button"
          disabled={busy && Boolean(a.send)}
          onClick={() => (a.send ? onSend(a.send) : onFill(a.fill ?? ""))}
        >
          <span className="key" aria-hidden="true">
            {a.key}
          </span>
          {a.name}
        </button>
      ))}
    </nav>
  );
}

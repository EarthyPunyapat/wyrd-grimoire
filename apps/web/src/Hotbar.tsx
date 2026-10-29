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

export function Hotbar({
  busy,
  inCombat,
  onFill,
  onSend,
  onCombat,
}: {
  busy: boolean;
  inCombat: boolean;
  onFill: (text: string) => void;
  onSend: (text: string) => void;
  onCombat: () => void;
}) {
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
      {HOTBAR_ACTIONS.map((a) => (
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

import type { CardProps } from "./types.ts";

export function RetconCard({ card, retcon, onUndo }: CardProps<"retcon">) {
  return (
    <section className="gm-card retcon-card">
      <p className="eyebrow">Retcon</p>
      <h3>The story changed</h3>
      {retcon && retcon.retconId === card.retconId ? (
        <>
          <p className="small">{retcon.summary}</p>
          {retcon.undone ? (
            <p className="muted small">Undone.</p>
          ) : (
            retcon.undoable &&
            onUndo && (
              <button type="button" onClick={() => onUndo(retcon.retconId)}>
                Undo
              </button>
            )
          )}
        </>
      ) : (
        <p className="muted small">A change to what came before.</p>
      )}
    </section>
  );
}

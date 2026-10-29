import type { CardProps } from "./types.ts";

export function LevelUpCard({ card, view, onAcceptLevel }: CardProps<"levelUp">) {
  const proposal = view.levelProposals?.find((p) => p.id === card.proposalId);
  if (!proposal) return null;
  return (
    <section className="gm-card level-up-card" aria-label="Level-up proposal">
      <h3>{`Level ${proposal.level === "infinite" ? "∞" : proposal.level}`}</h3>
      <p>{proposal.reason}</p>
      {proposal.status === "pending" ? (
        <button type="button" disabled={!onAcceptLevel} onClick={() => onAcceptLevel?.(proposal.id)}>
          Accept level-up
        </button>
      ) : (
        <p>{proposal.status === "accepted" ? "Accepted" : "Superseded"}</p>
      )}
    </section>
  );
}

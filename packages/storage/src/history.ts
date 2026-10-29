import { BranchesView, type HistoryBranch, type HistoryTurn, SavesView, TimelineView } from "@wyrd/core";
import { type CampaignStore, StorageError } from "./campaign-store.ts";

type State = { campaign: { gameTime: number } };

/** Every turn visible on a branch, oldest first, with the narration as it last stood. */
export function turnsOf<S extends State>(
  store: CampaignStore<S>,
  branchId = store.activeBranchId,
): HistoryTurn[] {
  const turns = new Map<string, HistoryTurn>();
  for (const event of store.events(branchId)) {
    if (!event.turnId) continue;
    if (event.type === "TurnStarted") {
      turns.set(event.turnId, {
        id: event.turnId,
        branchId: event.branchId,
        seq: event.seq,
        input: event.payload.input,
        narration: null,
        status: null,
        gameTime: event.gameTime,
        createdAt: event.createdAt,
      });
      continue;
    }
    const turn = turns.get(event.turnId);
    if (!turn) continue;
    if (event.type === "NarrationCommitted" || event.type === "NarrationRerolled")
      turn.narration = event.payload.text;
    else if (event.type === "TurnCompleted") turn.status = event.payload.status;
  }
  return [...turns.values()].sort((a, b) => a.seq - b.seq);
}

export function branchViews<S extends State>(
  store: CampaignStore<S>,
  activeBranchId = store.activeBranchId,
): HistoryBranch[] {
  return store.branches().map((branch) => ({
    id: branch.id,
    parentBranchId: branch.parentBranchId,
    forkSeq: branch.forkSeq,
    label: branch.label,
    head: branch.head,
    active: branch.id === activeBranchId,
  }));
}

export function timelineView<S extends State>(store: CampaignStore<S>, branchId?: string): TimelineView {
  const activeBranchId = store.activeBranchId;
  const viewing = branchId ?? activeBranchId;
  store.branch(viewing); // validates the branch before the response claims it exists
  return TimelineView.parse({
    campaignId: store.campaignId,
    activeBranchId,
    branchId: viewing,
    hardcore: store.settings(viewing).structural.hardcore,
    branches: branchViews(store, activeBranchId),
    turns: turnsOf(store, viewing),
  });
}

export function branchesView<S extends State>(store: CampaignStore<S>): BranchesView {
  const activeBranchId = store.activeBranchId;
  return BranchesView.parse({
    campaignId: store.campaignId,
    activeBranchId,
    hardcore: store.settings(activeBranchId).structural.hardcore,
    branches: branchViews(store, activeBranchId),
  });
}

export function savesView<S extends State>(store: CampaignStore<S>): SavesView {
  return SavesView.parse({ saves: store.saves() });
}

/**
 * Rewinds to just before a turn's `TurnStarted`: the fork point is the sequence immediately
 * before it, so the turn (and everything after it) leaves the new active timeline. The old
 * branch remains available. Hardcore refusal comes from `CampaignStore.rewind`.
 */
export function rewindToTurn<S extends State>(
  store: CampaignStore<S>,
  turnId: string,
  label?: string,
): HistoryBranch {
  let started: { seq: number; input: string } | undefined;
  for (const event of store.events()) {
    if (event.type === "TurnStarted" && event.turnId === turnId) {
      started = { seq: event.seq, input: event.payload.input };
      break;
    }
  }
  if (!started) throw new StorageError("not_found", "That turn is not on the active timeline");
  if (started.seq <= 1)
    throw new StorageError("invalid_seq", "There is nothing before this turn to return to");
  const input = started.input.trim().replace(/\s+/g, " ").slice(0, 60);
  const fork = store.rewind(started.seq - 1, label ?? (input ? `Before “${input}”` : undefined));
  return {
    id: fork.id,
    parentBranchId: fork.parentBranchId,
    forkSeq: fork.forkSeq,
    label: fork.label,
    head: fork.head,
    active: true,
  };
}

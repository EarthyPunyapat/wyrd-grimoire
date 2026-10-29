import type { GameView } from "@wyrd/core";

export type Resolution = GameView["resolution"];

const HINT: Record<Resolution, string> = {
  d100: "d100 roll-under",
  d20: "d20 + modifier vs DC",
};

/** A small label where the campaign's dice system changes how a number should be read (spec 02, 12). */
export function DiceBadge({ resolution }: { resolution: Resolution }) {
  return (
    <span className="dice-badge" title={HINT[resolution]}>
      {resolution}
    </span>
  );
}

/** The server's notation, with the old percentage as a fallback for views cached before M7. */
export function skillDisplay(skill: { value: number; display?: string }): string {
  return skill.display || `${skill.value}%`;
}

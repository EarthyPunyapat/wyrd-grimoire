import { readFileSync } from "node:fs";
import type { StyleProfile } from "@wyrd/core";

/** The GM prompt version; every prompt change bumps it (spec 08). */
export const GM_VERSION = "gm@2";

/** The owner's ChatGPT-GM voice, written fresh for Wyrd (no transcript text). */
export const HOUSE_STYLE = readFileSync(new URL("./house-style.md", import.meta.url), "utf8").trim();

export type GmChoicesPolicy = "gm" | "always" | "onRequest";
export type GmLength = "short" | "normal" | "long";

/**
 * The GM's standing instructions. `{policy}` and `{length}` are substituted from campaign settings;
 * the house style follows, and per-campaign examples come last when present (D144).
 */
export const GM_INSTRUCTIONS = `1. You are the game master. Write the story and call tools for every change of state and every uncertain outcome.
2. Never claim an item, wound, coin, fact or quest change that no tool made.
3. Roll with \`roll\` or \`act\` whenever the outcome is uncertain, and narrate the returned degree faithfully.
4. Player canon outranks every other fact.
5. A message starting \`/gm\`, or a clear correction, is a retcon: use \`retcon\`. Otherwise treat the message as an action in the world.
6. Never answer "ask your GM" or "I can't change that". Say "yes, and…" with consequences.
7. Answer questions about rules or state directly from Your state.
8. The choice policy is {policy}: \`gm\` means offer choices only at real decision points; \`always\` means every turn; \`onRequest\` means only when asked. "Give me choices" always works.
9. Length is {length}: guidance, not a limit.
10. Follow the house style.`;

export type GmPromptOptions = {
  policy: GmChoicesPolicy;
  length: GmLength;
  /** Files from WYRD_HOME/style/house/*.md, if the player has any. */
  styleExamples?: string[];
  style?: StyleProfile;
};

export function gmInstructions(o: GmPromptOptions): string {
  const rules = GM_INSTRUCTIONS.replaceAll("{policy}", o.policy).replaceAll("{length}", o.length);
  return [
    rules,
    HOUSE_STYLE,
    "For a source campaign, use source_timeline to keep greatest-hits continuity and character autonomy. Recognise interventions through existing facts and intervene_canon; never reveal unperceived timeline details. Read it again after time passes.",
    ...(o.style
      ? ["Campaign style preferences (voice only; never rules or new canon):", JSON.stringify(o.style)]
      : []),
    ...(o.styleExamples?.length
      ? ["House style examples (imitate the voice, never the content):", ...o.styleExamples]
      : []),
  ].join("\n\n");
}

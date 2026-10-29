import { type ContentScope, type ContentSettings, contentPolicy } from "@wyrd/memory";
import { NPC_DIALOGUE_INSTRUCTIONS } from "./prompts/index.ts";

/**
 * Appends the campaign's compact content-policy block to any prose role's instructions (spec 12).
 * It lives at the end of the stable instruction prefix, so providers can cache it.
 */
export function proseInstructions(
  instructions: string,
  content: ContentSettings,
  scope: ContentScope = "prose",
): string {
  return `${instructions.trim()}\n\n${contentPolicy(content, scope)}`;
}

/** The `npcDialogue` role's instructions with the campaign's content dials (spec 08, dialogue mode). */
export function npcDialogueInstructions(content: ContentSettings): string {
  return proseInstructions(NPC_DIALOGUE_INSTRUCTIONS, content);
}

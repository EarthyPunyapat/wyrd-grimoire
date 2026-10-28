import {
  CampaignSettings,
  type CampaignSettingsInput,
  type CharacterSheet,
  draft,
  type EventDraft,
  seedRng,
} from "@wyrd/core";
import { fail, ok, type Result } from "./result.ts";
import type { ActorRole, GameState } from "./state.ts";

export type NewCampaign = {
  name: string;
  packIds: string[];
  packHash?: string;
  settings?: CampaignSettingsInput;
  /** Seeds the campaign's dice. Callers pick it (e.g. from crypto) so the engine stays pure. */
  seed: number | string;
};

/** The first event of every campaign. Hardcore campaigns always have companion death on. */
export function createCampaign(input: NewCampaign): Result<EventDraft<"CampaignCreated">> {
  const parsed = CampaignSettings.safeParse(input.settings ?? {});
  if (!parsed.success) return fail("SETTINGS_INVALID", parsed.error.message);
  let settings = parsed.data;
  if (settings.structural.hardcore) settings = { ...settings, companionDeath: true };
  return ok(
    draft(
      "CampaignCreated",
      {
        name: input.name,
        settings,
        packIds: input.packIds,
        ...(input.packHash ? { packHash: input.packHash } : {}),
        rngState: [...seedRng(input.seed)],
        gameTime: 0,
      },
      "system",
    ),
  );
}

/** Adds an actor with a validated sheet. There is at most one PC. */
export function createActor(state: GameState, sheet: CharacterSheet, role: ActorRole): Result<EventDraft[]> {
  if (state.actors[sheet.id]) return fail("ACTOR_EXISTS", `Actor ${sheet.id} already exists`);
  if (role === "pc" && state.party.pcId)
    return fail("PC_EXISTS", "The campaign already has a player character");
  return ok([draft("ActorCreated", { role, sheet }, "engine")]);
}

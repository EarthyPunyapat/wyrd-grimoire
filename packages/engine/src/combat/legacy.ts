import { type ActorId, type CharacterSheet, draft, type EventDraft, SceneState } from "@wyrd/core";
import { createActor } from "../campaign.ts";
import { fail, ok, type Result } from "../result.ts";
import type { GameState } from "../state.ts";

const day = (minutes: number) => Math.floor(minutes / 1440) + 1;

/** A short obituary from canon (spec 03, "Hardcore death"): who they were, how and where they died. */
export function obituary(
  state: GameState,
  pcId: ActorId,
  cause: string,
  place: string,
  nameOf: (id: string) => string,
): string {
  const sheet = state.actors[pcId]?.sheet;
  if (!sheet) return "";
  const background = sheet.identity.background
    ? `, ${sheet.identity.background.replace(/\.$/, "").toLowerCase()}`
    : "";
  const gear = sheet.equipment.held.main ?? sheet.equipment.carried[0]?.item;
  const wounds = sheet.status.wounds.length;
  return [
    `${sheet.identity.name}${background}, ${cause} at ${place} on the ${ordinal(day(state.campaign.gameTime))} day.`,
    wounds ? `They carried ${wounds === 1 ? "one wound" : `${wounds} wounds`} into their last fight.` : "",
    gear ? `${nameOf(gear)} lies where they fell.` : "",
    "The world goes on, and remembers.",
  ]
    .filter(Boolean)
    .join(" ");
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * Legacy (spec 03): a new character in the same world. The dead PC becomes canon history (a grave
 * and their unfinished business) and the new one enters the current scene.
 */
export function legacyEvents(state: GameState, sheet: CharacterSheet, epitaph: string): Result<EventDraft[]> {
  const dead = state.party.pcId;
  if (!dead || !state.actors[dead]?.dead) return fail("PC_ALIVE", "Legacy is for a character who has died");
  if (state.actors[sheet.id]) return fail("ACTOR_EXISTS", `${sheet.id} already exists`);
  if (!state.scene) return fail("NO_SCENE", "There's no scene to enter");
  const drafts: EventDraft[] = [
    draft(
      "EntityCreated",
      {
        entity: {
          id: `npc:fallen-${dead}`,
          kind: "npc",
          name: state.actors[dead]!.sheet.identity.name,
          aliases: [],
          detail: "sketch",
          summary: epitaph,
          data: { actorId: dead, legacy: true },
          status: "dead",
          importance: 4,
        },
      },
      "engine",
    ),
    draft(
      "FactAsserted",
      {
        fact: {
          id: `fact:grave-${dead}`,
          entityId: `npc:fallen-${dead}`,
          predicate: "note",
          value: `Buried near ${state.scene.zones.find((z) => z.id === state.scene!.positions[dead])?.name ?? "where they fell"}. ${epitaph}`,
          source: "engine",
          visibility: "public",
          importance: 4,
        },
      },
      "engine",
    ),
  ];
  const created = createActor(state, sheet, "pc");
  if (!created.ok) return created;
  drafts.push(...created.value);
  const zone = state.scene.positions[dead] ?? state.scene.zones[0]!.id;
  drafts.push(
    draft(
      "SceneOpened",
      {
        scene: SceneState.parse({
          ...state.scene,
          positions: { ...state.scene.positions, [sheet.id]: zone },
        }),
      },
      "engine",
    ),
  );
  return ok(drafts);
}

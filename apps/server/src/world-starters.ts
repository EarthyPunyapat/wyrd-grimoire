import { presetSubsystems, WorldSetup } from "@wyrd/core";

/** Fresh pitches; source starters identify the setting without copying its prose or characters. */
export const WORLD_STARTERS: WorldSetup[] = [
  {
    id: "dc-superhero",
    name: "Superhero, inside DC",
    source: { title: "DC Comics", wiki: "dc.fandom.com" },
    blurb: "You answer a distress call above a city that never sleeps. Decide what your power is for.",
    pitch:
      "You have just become a hero in the world of DC Comics. A midnight distress call draws you above a rain-soaked city; decide who you protect, what you stand for, and what your power will cost.",
    rules: { preset: "standard", resolution: "d20", storyMode: "livingWorld" },
  },
  {
    id: "reverend-insanity",
    name: "Cultivation, inside Reverend Insanity",
    source: { title: "Reverend Insanity", wiki: "reverend-insanity.fandom.com" },
    blurb: "You enter a merciless cultivation world with one small advantage. Every alliance has a price.",
    pitch:
      "You enter the world of Reverend Insanity with a fragile foothold and an ambition nobody else knows. Resources are scarce, promises are dangerous, and you must decide which risks are worth your next breakthrough.",
    rules: { preset: "standard", resolution: "d20", storyMode: "livingWorld" },
    review: { lethality: "brutal" },
  },
  {
    id: "cosmic-god-game",
    name: "Cosmic god-game",
    blurb: "You awaken beyond the stars. Shape a universe, or seal your power and walk among its people.",
    pitch:
      "You awaken with limitless power above a newborn universe. You may shape its laws, create an avatar to live among its people, or seal your strength to discover what their choices mean.",
    rules: { preset: "story", resolution: "d20", storyMode: "livingWorld" },
    review: { startingLevel: "infinite" },
  },
  {
    id: "grimdark",
    name: "Grimdark fantasy",
    blurb: "You carry the last lantern into a kingdom of ash. Food, trust and daylight are running out.",
    pitch:
      "You arrive at a starving border town carrying a lantern that burns against an unnatural winter. The rulers have vanished and the roads are unsafe; you must weigh every ration, wound and promise against the journey ahead.",
    rules: { preset: "simulation", resolution: "d100", hardcore: true },
    review: { lethality: "brutal", subsystems: presetSubsystems("simulation") },
  },
  {
    id: "classic-fantasy",
    name: "Classic fantasy adventure",
    blurb:
      "You find a map tucked into an unpaid tavern bill. Beyond the valley, an old bell has begun to ring.",
    pitch:
      "You find a hand-drawn map tucked into an unpaid tavern bill. An abandoned bell tower is ringing across the valley, and you gather the courage and company to discover who has returned.",
    rules: { preset: "standard", resolution: "d100" },
  },
  {
    id: "space-opera",
    name: "Space opera",
    blurb: "You inherit a battered ship and a forbidden signal. The next jump could change the frontier.",
    pitch:
      "You inherit a battered starship just as a forbidden signal reaches the frontier. Rival fleets want its source, but you have the first coordinates and a crew willing to risk the next jump.",
    rules: { preset: "standard", resolution: "d20" },
  },
  {
    id: "cyberpunk-noir",
    name: "Cyberpunk noir",
    blurb:
      "You take a missing-person case in a city of rented memories. Someone has already erased your first lead.",
    pitch:
      "You take a missing-person case beneath the neon of a city that rents memories by the hour. Your first lead has been erased from every public record, and you must choose who to trust before your own past becomes evidence.",
    rules: { preset: "standard", resolution: "d100" },
  },
  {
    id: "zombie-survival",
    name: "Zombie survival",
    blurb: "You hear a living voice on the emergency radio. Reaching it means leaving your last safe room.",
    pitch:
      "You hear a living voice on an emergency radio after weeks of silence. Your supplies are dwindling, the dead gather at dusk, and you must decide who and what to take when you leave the last safe room.",
    rules: { preset: "simulation", resolution: "d100" },
    review: { subsystems: presetSubsystems("simulation") },
  },
].map((s) => WorldSetup.parse({ ...s, builtin: true, art: `/starters/${s.id}.webp` }));

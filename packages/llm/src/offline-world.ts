import type { Elaboration, Entity, LocationProposal, WorldBible } from "@wyrd/core";

/**
 * Offline stand-ins for the worldGen calls (no model): small, fixed, genre-neutral content so
 * previews and tests can travel between sites. Clearly not AI generation.
 */
export function offlineBible(input: { worldName: string; openingSite: string; threat: boolean }): WorldBible {
  const s = input.openingSite;
  return {
    regions: [
      {
        name: "the Near Reach",
        climate: "temperate",
        culture: "Busy, wary, proud of making do.",
        description: "The settled heart of the world, where most people live and trade.",
        sites: [
          { name: s, kind: "settlement", description: "Where the story begins." },
          {
            name: "Greywater Market",
            kind: "settlement",
            description: "A crowded market town on the old crossing.",
          },
        ],
      },
      {
        name: "the Far Reach",
        climate: "cold",
        culture: "Sparse, hardy, suspicious of strangers.",
        description: "Thinly settled country at the edge of the map.",
        sites: [
          {
            name: "Hollow Watch",
            kind: "ruin",
            description: "An abandoned watch post nobody admits to visiting.",
          },
          {
            name: "Cinder Steading",
            kind: "settlement",
            description: "A stubborn outpost that never quite closes its doors.",
          },
        ],
      },
    ],
    routes: [
      { from: s, to: "Greywater Market", days: 0.5, terrain: "road", danger: 1 },
      { from: "Greywater Market", to: "Hollow Watch", days: 1.5, terrain: "wild track", danger: 3 },
      { from: "Hollow Watch", to: "Cinder Steading", days: 1, terrain: "frozen trail", danger: 2 },
      { from: s, to: "Cinder Steading", days: 3, terrain: "long road", danger: 2 },
    ],
    factions: [
      {
        name: "the Ledger House",
        description: "Merchants who hold most of the Near Reach's debts.",
        goals: ["Buy up the market charter"],
        methods: "Loans, favours and quiet pressure.",
        resources: { wealth: 4, military: 1, influence: 3 },
        homeRegion: "the Near Reach",
        leader: { name: "Odile Marsh", role: "Head of the Ledger House" },
        secret: "The House is nearly bankrupt and hiding it.",
      },
      {
        name: "the Watch Remnant",
        description: "What's left of the old watch, keeping order where nobody else will.",
        goals: ["Reopen Hollow Watch"],
        methods: "Patrols, oaths and stubbornness.",
        resources: { wealth: 1, military: 3, influence: 2 },
        homeRegion: "the Far Reach",
        leader: { name: "Captain Brannoch", role: "Last captain of the watch" },
        secret: "They abandoned Hollow Watch after something there killed half of them.",
      },
    ],
    relations: [{ a: "the Ledger House", b: "the Watch Remnant", value: -30 }],
    threat: input.threat
      ? {
          name: "The Hollow Hunger",
          nature: "Something stirring under Hollow Watch, spreading sickness and fear.",
          agentFaction: null,
          motive: "To be fed.",
          paths: [
            {
              name: "Seal the watch",
              description: "Find what the old watch knew and finish what it started.",
            },
            { name: "Starve it", description: "Cut off whoever has been feeding it." },
          ],
        }
      : null,
    npcs: [
      {
        name: "Pell Ashdown",
        role: "Market warden",
        faction: "the Ledger House",
        site: "Greywater Market",
        want: "To keep his post.",
        secret: "He takes bribes from both sides.",
      },
      {
        name: "Wynn Tarrow",
        role: "Watch sergeant",
        faction: "the Watch Remnant",
        site: "Cinder Steading",
        want: "To see the watch respected again.",
        secret: null,
      },
      {
        name: "Sel Corran",
        role: "Trader in odd goods",
        faction: null,
        site: s,
        want: "One last big score.",
        secret: "She has been to Hollow Watch, recently.",
      },
      {
        name: "Dorran Vey",
        role: "Steading elder",
        faction: null,
        site: "Cinder Steading",
        want: "Peace for his people.",
        secret: null,
      },
    ],
    hooks: [
      {
        title: "The Warden's Ledger",
        summary: "Someone is paying the market warden to look away. Who, and from what?",
        site: "Greywater Market",
        npc: "Pell Ashdown",
      },
      {
        title: "Lights at Hollow Watch",
        summary: "Travellers swear they've seen lights in the abandoned watch post.",
        site: "Hollow Watch",
        npc: "Sel Corran",
      },
    ],
    startSite: s,
    address: "traveller",
  };
}

export function offlineLocation(site: { name: string; kind: string }): LocationProposal {
  const settled = site.kind === "settlement";
  return {
    name: settled ? `${site.name} Crossroads` : `${site.name} Approach`,
    description: settled
      ? `The busy heart of ${site.name}.`
      : `The way into ${site.name}, quiet and watchful.`,
    arrival: settled
      ? `You come into ${site.name} where the roads meet. People look up, then away.`
      : `You reach ${site.name}. Nothing moves, but it doesn't feel empty.`,
    weather: "overcast",
    light: settled ? "bright" : "dim",
    zones: [
      { name: settled ? "the crossroads" : "the approach", description: "Where you arrive.", tags: [] },
      {
        name: settled ? "the inn yard" : "the inner ground",
        description: "Further in.",
        tags: settled ? [] : ["dim"],
      },
    ],
    people: [
      {
        name: `${site.name.split(" ")[0]} Gatekeeper`,
        description: settled
          ? "A tired local who watches who comes and goes."
          : "A lone figure keeping watch.",
        zone: 0,
        secret: null,
      },
    ],
  };
}

export function offlineElaboration(entity: Entity): Elaboration {
  return {
    summary: `${entity.name}: ${entity.summary || "someone with more to them than first appears"}`,
    facts: [{ predicate: "manner", value: "Measured and watchful.", secret: false }],
  };
}

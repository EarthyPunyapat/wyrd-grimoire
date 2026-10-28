import { WorldProposal } from "@wyrd/core";

/** A fixed example, explicitly labelled in offline preview. This is not AI generation. */
export const EXAMPLE_WORLD = WorldProposal.parse({
  worldName: "The Silent Relay",
  premise:
    "A remote orbital relay has stopped answering traffic control. Its small civilian crew must discover why before the next supply ship arrives.",
  tone: "Grounded science-fiction mystery, human-scale stakes, no magic. Describe only resolved actions and what the character can perceive.",
  suggestedCharacterName: "Alex Chen",
  originLabel: "Origin",
  origins: [
    {
      name: "Station-born",
      description: "Human. You grew up among maintenance corridors and docking schedules.",
    },
    { name: "Earthside", description: "Human. You came from Earth to make a new life off-world." },
  ],
  backgrounds: [
    {
      name: "Systems technician",
      description: "You trace faults, repair machinery and keep people alive when equipment fails.",
      attributePriority: ["int", "awa", "agi", "wil", "end", "pre", "str"],
      skills: [
        "core:mechanics",
        "core:investigation",
        "core:perception",
        "core:medicine",
        "core:navigation",
        "core:insight",
      ],
    },
    {
      name: "Freight courier",
      description: "You know routes, people and the value of getting a delivery through.",
      attributePriority: ["agi", "awa", "pre", "end", "int", "wil", "str"],
      skills: [
        "core:navigation",
        "core:athletics",
        "core:persuasion",
        "core:streetwise",
        "core:perception",
        "core:dodge",
      ],
    },
    {
      name: "Crisis mediator",
      description: "You listen carefully, spot inconsistencies and help frightened crews make decisions.",
      attributePriority: ["pre", "awa", "wil", "int", "end", "agi", "str"],
      skills: [
        "core:persuasion",
        "core:insight",
        "core:investigation",
        "core:medicine",
        "core:deception",
        "core:perception",
      ],
    },
  ],
  location: {
    name: "Relay Nine",
    description: "A civilian orbital communications station with a small crew and aging equipment.",
    weather: "Climate controlled",
    opening:
      "The arrival lounge hums with emergency ventilation. A silent departures board hangs over the inspection desk. Duty officer Mina Vale waits beside a sealed maintenance hatch. She asks you to help find out why the relay went silent before the approaching supply ship loses its navigation signal.",
    zones: [
      {
        name: "Arrival lounge",
        description: "Emergency lights illuminate an inspection desk and a sealed maintenance hatch.",
      },
      { name: "Service corridor", description: "Cable trunks run beside a row of equipment lockers." },
      {
        name: "Relay control",
        description: "Signal consoles face a wide window overlooking the antenna array.",
      },
    ],
    people: [
      {
        name: "Mina Vale",
        description: "The station's tired duty officer stands beside the inspection desk.",
        zone: 0,
        secret: "She approved an unlogged maintenance visit yesterday.",
      },
      {
        name: "Jules Park",
        description: "A communications engineer carrying a diagnostic tablet.",
        zone: 2,
        secret: null,
      },
    ],
  },
});

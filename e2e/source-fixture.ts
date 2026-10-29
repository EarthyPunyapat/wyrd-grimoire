import { EXAMPLE_WORLD } from "../apps/server/src/example-world.ts";
import { CreationReview, type SourceCreation } from "../packages/core/src/index.ts";
import { offlineBible } from "../packages/llm/src/index.ts";

export const SOURCE_FIXTURE: SourceCreation = {
  proposal: EXAMPLE_WORLD,
  bible: offlineBible({ worldName: "Marshlight", openingSite: EXAMPLE_WORLD.location.name, threat: false }),
  abilities: [
    {
      id: "marshlight",
      name: "Marshlight",
      description: "Shape a small guiding light",
      level: 9,
      cost: "Concentration",
      rank: 1,
    },
  ],
  characters: [
    { name: "Mina Vale", motivation: "Protect the station", action: "Inspects the relay", paceDays: 1 },
  ],
  canonEvents: [
    {
      name: "The relay opens",
      days: 2,
      subject: "Mina Vale",
      predicate: "relay",
      value: "open",
      interventionPredicate: "relayStopped",
    },
  ],
};
export const SOURCE_REVIEW = CreationReview.parse({
  subsystems: {
    survival: false,
    inventory: "abstract",
    weatherEffects: false,
    disease: false,
    lightingAndVision: false,
  },
  theme: null,
  resolution: "d20",
  hardcore: false,
  companionDeath: false,
  lethality: "gritty",
  startingLevel: 9,
  style: { source: "Vivid cosmic adventure", playerWords: "", sample: "A green light wakes in your palm." },
});

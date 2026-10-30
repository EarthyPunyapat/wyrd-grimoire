import { expect, test } from "bun:test";
import { CharacterCard, StartGeneratedCampaign, WorldSetup } from "../src/index.ts";

test("setups accept infinite starting levels", () => {
  expect(
    WorldSetup.parse({
      id: "god",
      name: "God game",
      pitch: "Shape a newborn universe",
      rules: {},
      review: { startingLevel: "infinite" },
    }).review.startingLevel,
  ).toBe("infinite");
});
test("cards preserve infinite levels, abilities and companion voices", () => {
  const card = CharacterCard.parse({
    id: "ethan",
    title: "Ethan",
    origin: "created",
    pc: {
      name: "Ethan",
      level: "infinite",
      backstory: "A wandering sovereign",
      abilities: [
        { name: "Light", description: "Shapes light", rank: 10 },
        { name: "Flight", description: "Crosses the sky", rank: 2 },
      ],
    },
    companions: [{ name: "Ari", summary: "A loyal friend", voice: "Warm and precise", level: 20 }],
  });
  expect(card.pc.level).toBe("infinite");
  expect(card.pc.abilities).toHaveLength(2);
  expect(card.companions[0]!.voice).toBe("Warm and precise");
  const result = StartGeneratedCampaign.safeParse({
    draftId: crypto.randomUUID(),
    card: { id: card.id },
    import: { pc: card.pc },
  });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.some((i) => i.path[0] === "card")).toBe(true);
});

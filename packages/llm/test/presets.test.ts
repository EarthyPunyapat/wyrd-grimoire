import { expect, test } from "bun:test";
import { CampaignImport } from "@wyrd/core";
import { FakeProvider } from "../src/fake.ts";
import { adaptCharacter, varyPitch } from "../src/presets.ts";
import { RoleRouter } from "../src/router.ts";

function router(tool: string, args: unknown) {
  return new RoleRouter({
    providers: { fake: new FakeProvider([{ role: "worldGen", reply: { toolCall: { name: tool, args } } }]) },
    routing: { worldGen: { provider: "fake", model: "test", fallbacks: [] } },
  });
}
test("vary pitch validates the structured proposal", async () => {
  expect(
    await varyPitch(router("propose_pitch", { pitch: "You find a starship buried beneath the sea." }), {
      pitch: "You inherit a battered starship.",
    }),
  ).toBe("You find a starship buried beneath the sea.");
  await expect(
    varyPitch(router("propose_pitch", { pitch: "bad" }), { pitch: "You inherit a battered starship." }),
  ).rejects.toThrow(/10|pitch/);
});
test("adaptation keeps the card's name and returns a proposal", async () => {
  const pc = CampaignImport.shape.pc.parse({
    name: "Ethan",
    level: "infinite",
    backstory: "A wandering sovereign",
  });
  const result = await adaptCharacter(router("propose_adaptation", { ...pc, name: "Wrong", level: 5 }), {
    pc,
    world: { name: "Stars", premise: "A far frontier", tone: "Hopeful" },
  });
  expect(result.name).toBe("Ethan");
  expect(result.level).toBe(5);
  expect(pc.level).toBe("infinite");
});

import { expect, test } from "bun:test";
import { FakeProvider } from "../src/fake.ts";
import { extractCampaignImport } from "../src/import/extract.ts";
import { RoleRouter } from "../src/router.ts";

const drafted = {
  pc: {
    name: "Ethan Hunt",
    level: "infinite",
    backstory: "An engineer from Coast City who became the Absolute Sovereign.",
    abilities: [{ name: "Hard-light constructs", description: "Shapes will into matter", rank: 10 }],
    gear: [{ name: "AXIOM PRIME", description: "A self-forged Source ring" }],
  },
  companions: [
    {
      name: "Ari",
      summary: "The ring AI, now his right hand",
      voice: "Formal, warm, calls him Master",
      level: 20,
    },
  ],
  history: [{ subject: "Vale", fact: "Ethan's successor, training alone on Oa" }],
};

test("extraction drafts the character, companions and history and honours the exclusions", async () => {
  const fake = new FakeProvider([
    { role: "worldGen", reply: { toolCall: { name: "propose_import", args: drafted } } },
  ]);
  const router = new RoleRouter({
    providers: { fake },
    routing: { worldGen: { provider: "fake", model: "test", fallbacks: [] } },
  });
  const chats = [
    {
      title: "First Light",
      turns: [{ role: "user" as const, text: `Continue. ${"Ari watches. ".repeat(20)}` }],
    },
  ];
  const result = await extractCampaignImport(router, chats, { exclude: ["Reverend Insanity", "Fang Yuan"] });
  expect(result.pc.level).toBe("infinite");
  expect(result.companions[0]?.name).toBe("Ari");
  const req = fake.calls("worldGen")[0]!;
  expect(req.instructions).toContain("Reverend Insanity");
  expect(req.instructions).toContain("Fang Yuan");
  expect(req.messages[0]!.content).toContain("Ari watches.");
});

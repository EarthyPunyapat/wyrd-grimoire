import { expect, test } from "bun:test";
import { CharacterCard } from "@wyrd/core";
import { renderToStaticMarkup } from "react-dom/server";
import { WORLD_STARTERS } from "../../server/src/world-starters.ts";
import { CreationChooser } from "../src/CreationChooser.tsx";

test("chooser shows eight illustrated starters, infinite cards and safe management", () => {
  const card = CharacterCard.parse({
    id: "c",
    title: "Ethan",
    origin: "campaign",
    pc: { name: "Ethan", level: "infinite", backstory: "A wandering sovereign" },
    companions: [{ name: "Ari", summary: "Right hand", voice: "Warm", level: 20 }],
  });
  const html = renderToStaticMarkup(
    <CreationChooser
      cards={[card]}
      setups={WORLD_STARTERS}
      worlds={[]}
      value={{ cardId: null, setup: null, worldId: null }}
      onChange={() => {}}
      onBegin={() => {}}
      onContinue={() => {}}
      onManage={() => {}}
    />,
  );
  expect(html).toContain("Level ∞");
  expect(html).toContain("Ari");
  expect(html.match(/<img /g) ?? []).toHaveLength(8);
  expect(html.match(/>Create new</g) ?? []).toHaveLength(2);
  expect(html).toContain("Duplicate");
  expect(html.slice(html.indexOf('aria-label="Superhero, inside DC"'))).not.toContain(">Delete<");
});

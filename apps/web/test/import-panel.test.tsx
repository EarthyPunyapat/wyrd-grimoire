import { expect, test } from "bun:test";
import { CampaignImport } from "@wyrd/core";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportReview, selectImport } from "../src/ImportPanel.tsx";

const draft = CampaignImport.parse({
  pc: {
    name: "Ethan Hunt",
    level: "infinite",
    backstory: "The Absolute Sovereign.",
    abilities: [
      { name: "Hard-light constructs", description: "Will into matter", rank: 10 },
      { name: "Ring flight", description: "Flies", rank: 8 },
    ],
    gear: [{ name: "AXIOM PRIME", description: "Source ring" }],
  },
  companions: [{ name: "Ari", summary: "Right hand", voice: "Formal", level: 20 }],
  history: [
    { subject: "Vale", fact: "Successor on Oa" },
    { subject: "Fang Yuan", fact: "Gu Immortal" },
  ],
});

test("only the ticked pieces are imported", () => {
  const kept = selectImport(draft, {
    abilities: new Set([0]),
    gear: new Set([0]),
    companions: new Set([0]),
    history: new Set([0]),
  });
  expect(kept.pc.abilities.map((a) => a.name)).toEqual(["Hard-light constructs"]);
  expect(kept.history.map((h) => h.subject)).toEqual(["Vale"]);
  expect(kept.companions.map((c) => c.name)).toEqual(["Ari"]);
});

test("the review lists every piece with a checkbox and shows the level", () => {
  const all = {
    abilities: new Set([0, 1]),
    gear: new Set([0]),
    companions: new Set([0]),
    history: new Set([0, 1]),
  };
  const html = renderToStaticMarkup(<ImportReview draft={draft} keep={all} onToggle={() => {}} />);
  expect(html).toContain("Ethan Hunt");
  expect(html).toContain("Level ∞");
  for (const name of ["Hard-light constructs", "Ring flight", "AXIOM PRIME", "Ari", "Vale", "Fang Yuan"])
    expect(html).toContain(name);
  expect((html.match(/type="checkbox"/g) ?? []).length).toBe(6);
});

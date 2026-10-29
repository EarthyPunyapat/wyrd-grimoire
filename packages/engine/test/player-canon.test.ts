import { expect, test } from "bun:test";
import { defaultCampaignSettings, defaultTuning } from "@wyrd/core";
import { buildSheet } from "../src/creation.ts";
import { playerCanonEvents } from "../src/player-canon.ts";

const sheet = (over: { backstory?: string; background?: string } = {}) =>
  buildSheet(
    {
      id: "pc",
      identity: {
        name: "Wren",
        ancestry: "fantasy-core:halfling",
        appearance: { marks: [] },
        background: over.background ?? "",
        personality: [],
        backstory: over.backstory ?? "",
      },
      attributes: { str: 4, agi: 7, end: 5, int: 5, awa: 7, wil: 4, pre: 7 },
      skills: { "core:stealth": { trained: 60 } },
    },
    defaultCampaignSettings(),
    defaultTuning,
  );

let n = 0;
const newId = () => `fact-${++n}`;

test("emits pinned player facts", () => {
  n = 0;
  const events = playerCanonEvents({
    pcId: "pc",
    sheet: sheet({ backstory: "Raised on the river.", background: "Ferry hand" }),
    gear: [{ name: "Yellow lantern ring", description: "Glows with fear." }],
    newId,
  });
  const asserted = events.filter((e) => e.type === "FactAsserted");
  expect(asserted.length).toBeGreaterThanOrEqual(3);
  for (const event of asserted) {
    if (event.type !== "FactAsserted") throw new Error("filtered");
    expect(event.payload.fact.source).toBe("player");
    expect(event.payload.fact.importance).toBe(5);
    const index = events.indexOf(event);
    const pinned = events[index + 1]!;
    expect(pinned.type).toBe("FactPinned");
    if (pinned.type === "FactPinned") expect(pinned.payload.factId).toBe(event.payload.fact.id);
  }
  expect(asserted.map((e) => (e.type === "FactAsserted" ? e.payload.fact.predicate : ""))).toEqual(
    expect.arrayContaining(["carries", "background", "backstory"]),
  );
});

test("skips empty values", () => {
  const events = playerCanonEvents({ pcId: "pc", sheet: sheet(), gear: [], newId });
  expect(events).toEqual([]);
});

import { expect, test } from "bun:test";
import type { GameView } from "@wyrd/core";
import { renderToStaticMarkup } from "react-dom/server";
import { WatchList } from "../src/Passage.tsx";

test("Cockpit displays watched entities outside the scene instead of the current occupants", () => {
  const view = {
    pc: { id: "pc", identity: { name: "Wren" } },
    scene: { present: [{ id: "npc:wenna", name: "Wenna" }] },
    watched: [
      { id: "npc:ghost", name: "The Drowned Man", kind: "npc", report: "No notable changes observed." },
    ],
  } as unknown as GameView;
  const html = renderToStaticMarkup(<WatchList view={view} />);
  expect(html).toContain("The Drowned Man");
  expect(html).toContain("No notable changes observed.");
  expect(html).not.toContain("Wenna");
  expect(html).not.toContain("Wren");
  expect(renderToStaticMarkup(<WatchList view={{ ...view, watched: [] }} />)).toContain("Nothing watched");
});

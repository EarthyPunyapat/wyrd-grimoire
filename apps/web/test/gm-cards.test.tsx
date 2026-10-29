import { expect, test } from "bun:test";
import type { GameView, MechanicsLine, WebTurn } from "@wyrd/core";
import { renderToStaticMarkup } from "react-dom/server";
import { Cards } from "../src/Cards.tsx";
import { Passage } from "../src/Passage.tsx";

const line: MechanicsLine = {
  text: "Stealth 65% · rolled 38 · Success",
  degree: "success",
  roll: { die: "d100", sides: 100, natural: 38, target: 65 },
};

const view = {
  id: "c1",
  resolution: "d100",
  worldName: "The Ford",
  scene: null,
  speakers: {},
  pc: {
    id: "pc",
    identity: { name: "Wren" },
    status: { hp: 7, luck: 2, conditions: [{ id: "core:exhausted", name: "Exhausted" }], wounds: [] },
    derived: { hpMax: 12 },
    attributes: { str: 5, agi: 6, end: 5, int: 5, awa: 5, wil: 5, pre: 5 },
  },
  inventory: {
    capacityKg: 10,
    weightKg: 2,
    band: "unencumbered",
    coins: 3,
    items: [{ id: "campaign:yellow-lantern-ring", name: "Yellow lantern ring", qty: 1, location: "carried" }],
  },
  known: [{ id: "npc:wenna", name: "Wenna", kind: "npc" }],
  shop: null,
  turns: [],
} as unknown as GameView;

test("cards are bound to the view by id", () => {
  const html = renderToStaticMarkup(
    <Cards
      view={view}
      mechanics={[line]}
      retcon={{ retconId: "r1", summary: "The ring was always yours.", undone: false, undoable: true }}
      onUndo={() => {}}
      cards={[
        { type: "chapter", title: "The Ford", subtitle: "Evening" },
        { type: "item", itemId: "campaign:yellow-lantern-ring" },
        { type: "character", entityId: "npc:wenna" },
        { type: "status", actorId: "pc" },
        { type: "roll", lineIndex: 0 },
        { type: "report", title: "Ledger", body: "One ferry, one debt." },
        { type: "retcon", retconId: "r1" },
      ]}
    />,
  );
  expect(html).toContain("The Ford");
  expect(html).toContain("Yellow lantern ring");
  expect(html).toContain("Wenna");
  expect(html).toContain("Wren");
  expect(html).toContain("7/12");
  expect(html).toContain("Stealth 65%");
  expect(html).toContain("Ledger");
  expect(html).toContain("Retcon");
  expect(html).toContain("The ring was always yours.");
  expect(html).toContain("Undo");
});

const turn: WebTurn = {
  id: "t1",
  input: "I take the ring.",
  status: "resolved",
  narration: "You pocket the ring.",
  mechanics: [],
  cards: [{ type: "chapter", title: "The Ford", subtitle: "" }],
  choices: [
    { label: "Cross the ford", description: "" },
    { label: "Ask Wenna", description: "" },
  ],
  backup: true,
  checkFlags: [{ quote: "You pocket the ring.", claim: "The ring was never recorded." }],
  retcon: { retconId: "r1", summary: "The ring was always yours.", undone: false, undoable: true },
};

test("a passage shows cards, choices, the backup badge, check flags and Undo", () => {
  const html = renderToStaticMarkup(
    <Passage
      turn={turn}
      view={view}
      busy={false}
      math={false}
      onReroll={() => {}}
      onChoice={() => {}}
      onFix={() => {}}
      onUndo={() => {}}
    />,
  );
  expect(html).toContain("The Ford");
  expect(html).toContain("Cross the ford");
  expect(html).toContain("backup model");
  expect(html).toContain("Possible unrecorded change");
  expect(html).toContain("The ring was never recorded.");
  expect(html).toContain("Fix");
  expect(html).toContain("Dismiss");
  expect(html).toContain("Retcon");
  expect(html).toContain("Undo");
  // The narration is shown exactly as committed; the check never rewrites it.
  expect(html).toContain("You pocket the ring.");
});

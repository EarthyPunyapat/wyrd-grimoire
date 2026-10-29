import { expect, test } from "bun:test";
import type { GameView, MechanicsLine } from "@wyrd/core";
import { renderToStaticMarkup } from "react-dom/server";
import { Mechanics } from "../src/Passage.tsx";
import { Sheet } from "../src/Sheet.tsx";

const d20Line: MechanicsLine = {
  text: "Stealth +3 vs DC 11 (Normal) · rolled 14 + 3 = 17 · Success",
  degree: "success",
  roll: { die: "d20", sides: 20, natural: 14, modifier: 3, total: 17, dc: 11 },
};
const d100Line: MechanicsLine = {
  text: "Stealth 65% · rolled 38 · Success",
  degree: "success",
  roll: { die: "d100", sides: 100, natural: 38, target: 65 },
};

const view = (resolution: GameView["resolution"], display: string) =>
  ({
    resolution,
    originName: "Human",
    backgroundName: "Cutpurse",
    skills: [{ id: "core:stealth", name: "Stealth", value: 65, display }],
    scene: null,
    pc: {
      identity: { name: "Wren" },
      status: { hp: 12, luck: 2, conditions: [], wounds: [] },
      derived: { hpMax: 12 },
      attributes: { str: 5, agi: 6, end: 5, int: 5, awa: 5, wil: 5, pre: 5 },
    },
  }) as unknown as GameView;

test("a d20 mechanics log labels the dice mode and drops a stray d100 line", () => {
  const html = renderToStaticMarkup(<Mechanics lines={[d20Line, d100Line]} resolution="d20" />);
  expect(html).toContain("Stealth +3 vs DC 11");
  expect(html).toContain("d20");
  expect(html).toContain("(1)");
  expect(html).not.toContain("65%");
});

test("a d100 mechanics log is unchanged and keeps both lines", () => {
  const html = renderToStaticMarkup(<Mechanics lines={[d20Line, d100Line]} resolution="d100" />);
  expect(html).toContain("Stealth 65%");
  expect(html).toContain("(2)");
  expect(html).toContain("d100");
});

test("the sheet shows a d20 modifier instead of a percentage, with a d20 badge", () => {
  const html = renderToStaticMarkup(<Sheet view={view("d20", "+3")} />);
  expect(html).toContain("+3");
  expect(html).toContain("d20");
  expect(html).toContain("beat the check&#x27;s DC");
  expect(html).not.toContain("65%");
});

test("the sheet still shows percentages in a d100 campaign", () => {
  const html = renderToStaticMarkup(<Sheet view={view("d100", "65%")} />);
  expect(html).toContain("65%");
  expect(html).toContain("d100");
});

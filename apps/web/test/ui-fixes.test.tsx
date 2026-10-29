import { expect, test } from "bun:test";
import type { GameView, WebTurn } from "@wyrd/core";
import { renderToStaticMarkup } from "react-dom/server";
import { Advance } from "../src/Party.tsx";
import { Passage } from "../src/Passage.tsx";
import { StatusStrip } from "../src/StatusStrip.tsx";

const noop = () => {};
const member = (available: number) =>
  ({
    actorId: "pc",
    name: "Wren",
    xp: { available, earned: 3 },
    pending: { attributes: 0, talents: 0 },
    marks: [],
    attributes: [{ id: "str", name: "Strength", value: 4, cost: available ? 4 : null, why: "Not enough XP" }],
    skills: [],
    fieldSkills: [],
    talents: [],
  }) as never;

// The Character tab showed the sheet twice: the spend lists repeated every attribute with an empty "—".
test("with no XP to spend, the spend lists are folded away", () => {
  const html = renderToStaticMarkup(<Advance m={member(0)} busy={false} buy={noop} resolution="d100" />);
  expect(html).toContain('<details class="advance-plan">');
  expect(html).not.toContain('<details class="advance-plan" open');
  expect(html).toContain("What XP will buy");
});

test("with XP to spend, the spend lists are open", () => {
  const html = renderToStaticMarkup(<Advance m={member(5)} busy={false} buy={noop} resolution="d100" />);
  expect(html).toContain('<details class="advance-plan" open="">');
});

const view = {
  id: "c1",
  name: "Ford",
  resolution: "d20",
  worldName: "The Ford",
  gameTime: 600,
  scene: null,
  speakers: {},
  known: [],
  pc: { id: "pc", identity: { name: "Wren" }, status: { hp: 7, conditions: [] }, derived: { hpMax: 12 } },
  inventory: { capacityKg: 10, weightKg: 0, band: "none", coins: 0, items: [] },
  shop: null,
} as unknown as GameView;

test("menu names sit in their own span so tight strips can fold them to icon and key", () => {
  const html = renderToStaticMarkup(<StatusStrip view={view} onMenu={noop} onSettings={noop} />);
  expect(html).toContain('class="menu-name">Journal</span>');
});

const turn = (id: string, mechanics: { text: string; degree?: string }[]) =>
  ({
    id,
    input: "x",
    status: "resolved",
    narration: "y",
    mechanics,
    cards: [],
    choices: [],
    backup: false,
    checkFlags: [],
  }) as unknown as WebTurn;

// Cockpit's log was an empty heading: it only ever showed the newest passage's own rolls.
test("the newest passage carries a running log of recent rolls across turns", () => {
  const turns = [
    turn("t1", [{ text: "Stealth d20 12 +3 = 15 vs DC 12 · Success", degree: "success" }]),
    turn("t2", []),
    turn("t3", [{ text: "Athletics d20 4 +1 = 5 vs DC 12 · Failure", degree: "failure" }]),
  ];
  const v = { ...view, turns } as unknown as GameView;
  const html = renderToStaticMarkup(<Passage turn={turns[2]!} view={v} busy={false} math onReroll={noop} />);
  const log = html.slice(html.indexOf('class="cockpit-log"'));
  expect(log).toContain("Stealth d20 12 +3 = 15");
  expect(log).toContain("Athletics d20 4 +1 = 5");
  const older = renderToStaticMarkup(<Passage turn={turns[0]!} view={v} busy={false} math onReroll={noop} />);
  expect(older).not.toContain('class="cockpit-log"');
});

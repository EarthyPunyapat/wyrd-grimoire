import { expect, test } from "bun:test";
import type { GameView, WebTurn } from "@wyrd/core";
import { renderToStaticMarkup } from "react-dom/server";
import { Cards } from "../src/Cards.tsx";
import { Hotbar } from "../src/Hotbar.tsx";
import { Passage } from "../src/Passage.tsx";
import { StatusStrip } from "../src/StatusStrip.tsx";

const view = {
  id: "c1",
  name: "Ford",
  resolution: "d20",
  worldName: "The Ford",
  gameTime: 412 * 1440 + 19 * 60 + 6,
  scene: { location: "Watchtower", zone: "the long window", weather: "clear" },
  speakers: {},
  known: [],
  pc: { id: "pc", identity: { name: "Ethan Hunt" }, status: { hp: 7 }, derived: { hpMax: 12 } },
} as unknown as GameView;

const noop = () => {};

test("status strip names the character, place and time", () => {
  const html = renderToStaticMarkup(<StatusStrip view={view} onMenu={noop} onSettings={noop} />);
  expect(html).toContain('data-component="status-strip"');
  expect(html).toContain("Ethan Hunt");
  expect(html).toContain("Watchtower");
  expect(html).toContain("19:06");
  // One Settings button: campaign rules and device settings share one screen (D163).
  expect(html.match(/>Settings</g)).toHaveLength(1);
  // Market is offered only while a merchant is here.
  expect(html).not.toContain(">Market<");
  const shop = { ...view, shop: { id: "s", name: "Stall", attitude: 0, items: [] } } as GameView;
  expect(renderToStaticMarkup(<StatusStrip view={shop} onMenu={noop} onSettings={noop} />)).toContain(
    ">Market<",
  );
});

test("status strip menu keys are hints, never the accessible name", () => {
  const html = renderToStaticMarkup(<StatusStrip view={view} onMenu={noop} onSettings={noop} />);
  for (const [key, name] of [
    ["C", "Character"],
    ["I", "Inventory"],
    ["J", "Journal"],
    ["M", "Map"],
  ]) {
    expect(html).toContain(`<span class="key" aria-hidden="true">${key}</span>`);
    expect(html).toContain(name);
  }
  expect(html).toContain("Codex");
  expect(html).toContain("Timeline");
});

test("hotbar offers the GM actions with key hints", () => {
  const html = renderToStaticMarkup(
    <Hotbar busy={false} inCombat={false} onFill={noop} onSend={noop} onCombat={noop} />,
  );
  expect(html).toContain('data-component="hotbar"');
  for (const name of ["Observe", "Time skip", "Choices", "GM mode"]) expect(html).toContain(name);
  expect(html).not.toContain("Combat");
});

test("hotbar shows combat only in a fight", () => {
  const html = renderToStaticMarkup(
    <Hotbar busy={false} inCombat onFill={noop} onSend={noop} onCombat={noop} />,
  );
  expect(html).toContain("Combat");
});

test("passage puts rolls in the margin rail and prose in the column", () => {
  const turn = {
    id: "t1",
    input: "I ask Hal about the rings.",
    status: "resolved",
    narration: "Hal frowns at his ring.",
    mechanics: [{ text: "Insight d20 14 +6 = 20 vs 18 · Success", degree: "success" }],
    cards: [],
    choices: [{ label: "Tell Hal the truth", description: "He'll want the link cut." }],
    backup: false,
    checkFlags: [],
  } as unknown as WebTurn;
  const html = renderToStaticMarkup(
    <Passage turn={turn} view={view} busy={false} math onReroll={noop} onChoice={noop} />,
  );
  const main = html.slice(html.indexOf('class="passage-main"'), html.indexOf('class="margin-notes"'));
  const rail = html.slice(html.indexOf('class="margin-notes"'));
  expect(main).toContain("Hal frowns at his ring.");
  expect(main).toContain("Tell Hal the truth");
  expect(rail).toContain("Insight d20 14 +6 = 20 vs 18");
  expect(main).not.toContain("Insight d20");
});

const baseTurn = {
  id: "t2",
  input: "I open my eyes.",
  status: "resolved",
  narration: "The station hums.",
  cards: [],
  choices: [],
  backup: false,
  checkFlags: [],
};

test("a roll shows as a margin note with the big result and the die line", () => {
  const turn = {
    ...baseTurn,
    mechanics: [
      {
        text: "Willpower d20 14 +6 = 20 vs DC 18 · Success",
        degree: "success",
        roll: { die: "d20", sides: 20, natural: 14, modifier: 6, total: 20, dc: 18 },
      },
    ],
  } as unknown as WebTurn;
  const html = renderToStaticMarkup(<Passage turn={turn} view={view} busy={false} math onReroll={noop} />);
  const rail = html.slice(html.indexOf('class="margin-notes"'));
  expect(rail).toContain('class="roll-total">20<');
  expect(rail).toContain("d20 14 +6 vs DC 18");
  expect(rail).toContain("Willpower");
  expect(rail).toContain("Success");
});

test("a GM chapter card becomes the chapter heading in the column, not a margin note", () => {
  const turn = {
    ...baseTurn,
    mechanics: [],
    cards: [{ type: "chapter", title: "The Ring Project", subtitle: "Watchtower · night" }],
  } as unknown as WebTurn;
  const v = { ...view, turns: [turn] } as unknown as GameView;
  const html = renderToStaticMarkup(<Passage turn={turn} view={v} busy={false} math onReroll={noop} />);
  const main = html.slice(html.indexOf('class="passage-main"'), html.indexOf('class="margin-notes"'));
  expect(main).toContain('class="chapter-numeral"');
  expect(main).toContain("II");
  expect(main).toContain("The Ring Project");
  expect(main).toContain("Watchtower · night");
  expect(html.slice(html.indexOf('class="margin-notes"'))).not.toContain("The Ring Project");
});

test("the status strip carries the home wordmark and app settings when given", () => {
  const html = renderToStaticMarkup(
    <StatusStrip view={view} onMenu={noop} onSettings={noop} onHome={noop} onAppSettings={noop} />,
  );
  expect(html).toContain('aria-label="Wyrd Grimoire home"');
  expect(html).toContain(">Settings<");
});

test("a roll note says what the roll was for", () => {
  const turn = {
    ...baseTurn,
    mechanics: [
      {
        text: "Willpower d20 14 +6 = 20 vs DC 18 · Success",
        degree: "success",
        purpose: "read whether Ethan is hiding something",
        roll: { die: "d20", sides: 20, natural: 14, modifier: 6, total: 20, dc: 18 },
      },
    ],
  } as unknown as WebTurn;
  const html = renderToStaticMarkup(<Passage turn={turn} view={view} busy={false} math onReroll={noop} />);
  expect(html).toContain("Success: read whether Ethan is hiding something");
});

test("an item card shows the icon, the gold name, the type line and the description", () => {
  const v = {
    ...view,
    inventory: {
      capacityKg: 10,
      weightKg: 1,
      band: "none",
      coins: 0,
      items: [
        {
          id: "campaign:axiom-prime",
          name: "AXIOM PRIME",
          qty: 1,
          location: "worn",
          condition: "good",
          kind: "gear",
          description: "Self-forged Source ring.",
        },
      ],
    },
    shop: null,
  } as unknown as GameView;
  const html = renderToStaticMarkup(
    <Cards cards={[{ type: "item", itemId: "campaign:axiom-prime" }]} view={v} mechanics={[]} />,
  );
  expect(html).toContain("item-icon");
  expect(html).toContain("AXIOM PRIME");
  expect(html).toContain("Gear · worn");
  expect(html).toContain("Self-forged Source ring.");
});

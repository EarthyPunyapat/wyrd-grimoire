import { expect, test } from "bun:test";
import { CharacterSheet, type GameView } from "@wyrd/core";
import { renderToStaticMarkup } from "react-dom/server";
import { Cards } from "../src/Cards.tsx";
import { Hotbar } from "../src/Hotbar.tsx";
import { Sheet } from "../src/Sheet.tsx";
import { StatusStrip } from "../src/StatusStrip.tsx";

const noop = () => {};
const pc = CharacterSheet.parse({
  id: "pc",
  identity: { name: "Wren", ancestry: "core:human" },
  attributes: { str: 5, agi: 5, end: 5, int: 5, awa: 5, wil: 5, pre: 5 },
  derived: { hpMax: 10, wt: 5, carryKg: 10, initiative: 5 },
  status: { hp: 10, luck: 3 },
  level: 3,
  abilities: [
    {
      id: "light",
      name: "Marshfire",
      description: "A pale guiding flame.",
      level: 2,
      rank: 5,
      cost: "Once per scene",
    },
  ],
});
const view = {
  id: "c",
  pc,
  powerRating: 28,
  gameTime: 0,
  skills: [],
  scene: null,
  resolution: "d20",
  levelProposals: [{ id: "p", actorId: "pc", from: 3, level: 4, reason: "First journey", status: "pending" }],
} as unknown as GameView;

test("status strip displays finite and infinite Levels", () => {
  expect(renderToStaticMarkup(<StatusStrip view={view} onMenu={noop} onSettings={noop} />)).toContain(
    "Level 3",
  );
  expect(
    renderToStaticMarkup(
      <StatusStrip view={{ ...view, pc: { ...pc, level: "infinite" } }} onMenu={noop} onSettings={noop} />,
    ),
  ).toContain("Level ∞");
});

test("sheet shows cosmetic power, ranked abilities, level and cost", () => {
  const html = renderToStaticMarkup(<Sheet view={view} />);
  for (const text of [
    "Level 3",
    "Power rating",
    "28",
    "Abilities",
    "Marshfire",
    "Rank 5",
    "Once per scene",
    "A pale guiding flame.",
  ])
    expect(html).toContain(text);
});

test("abilities become hotbar actions and level-up cards bind to pending proposals", () => {
  const html = renderToStaticMarkup(
    <Hotbar
      abilities={pc.abilities}
      busy={false}
      inCombat={false}
      onFill={noop}
      onSend={noop}
      onCombat={noop}
    />,
  );
  expect(html).toContain("Marshfire");
  const card = renderToStaticMarkup(
    <Cards cards={[{ type: "levelUp", proposalId: "p" }]} view={view} onAcceptLevel={noop} />,
  );
  expect(card).toContain("Level 4");
  expect(card).toContain("Accept level-up");
  expect(card).toContain("First journey");
  const accepted = renderToStaticMarkup(
    <Cards
      cards={[{ type: "levelUp", proposalId: "p" }]}
      view={{ ...view, levelProposals: [{ ...view.levelProposals[0]!, status: "accepted" }] }}
      onAcceptLevel={noop}
    />,
  );
  expect(accepted).not.toContain("Accept level-up");
});

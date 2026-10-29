import { expect, test } from "bun:test";
import type { GameView, ProgressionMember } from "@wyrd/core";
import { renderToStaticMarkup } from "react-dom/server";
import { Cards } from "../src/Cards.tsx";
import { Hotbar } from "../src/Hotbar.tsx";
import { CompanionCard } from "../src/Party.tsx";

const noop = () => {};

test("a loyal Ari adds a delegation hotbar action; absent or nonloyal companions do not", () => {
  const render = (companions: GameView["companions"]) =>
    renderToStaticMarkup(
      <Hotbar
        companions={companions}
        busy={false}
        inCombat={false}
        onFill={noop}
        onSend={noop}
        onCombat={noop}
      />,
    );
  expect(render([{ id: "ari", name: "Ari", loyal: true }])).toContain("Delegate to Ari");
  expect(render([])).not.toContain("Delegate to");
  expect(render([{ id: "ari", name: "Ari", loyal: false }])).not.toContain("Delegate to");
});

test("loyal companions have no approval meter or numeric approval in the Party card", () => {
  const m = {
    actorId: "ari",
    name: "Ari",
    companion: {
      loyal: true,
      approval: null,
      mood: "Loyal",
      control: "ai",
      directive: "follow",
      values: [],
      likes: [],
      dislikes: [],
      voiceProfile: "Warm and candid.",
    },
  } as unknown as ProgressionMember;
  const html = renderToStaticMarkup(<CompanionCard m={m} busy={false} onControl={noop} />);
  expect(html).toContain("Loyal");
  expect(html).not.toContain("<meter");
  expect(html).not.toContain("Approval:");
  expect(html).toContain("Warm and candid.");
});

test("task reports use the existing report card", () => {
  const html = renderToStaticMarkup(
    <Cards
      cards={[{ type: "report", title: "Delegation report", body: "Ari: Inspect the beacon — Completed." }]}
      view={{} as GameView}
    />,
  );
  expect(html).toContain("Delegation report");
  expect(html).toContain("Completed.");
});

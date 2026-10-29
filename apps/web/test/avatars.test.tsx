import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Hotbar } from "../src/Hotbar.tsx";

const noop = () => {};
const hotbar = (level: "infinite" | number) =>
  renderToStaticMarkup(
    <Hotbar level={level} busy={false} inCombat={false} onFill={noop} onSend={noop} onCombat={noop} />,
  );

test("an infinite character can seal their power and send an avatar from the hotbar", () => {
  const html = hotbar("infinite");
  expect(html).toContain("Seal");
  expect(html).toContain("Send avatar");
});

test("finite characters do not see the sovereign-only hotbar actions", () => {
  const html = hotbar(7);
  expect(html).not.toContain("Send avatar");
  expect(html).not.toContain("Seal");
});

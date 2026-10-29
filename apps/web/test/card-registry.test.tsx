import { expect, test } from "bun:test";
import { Card } from "@wyrd/core";
import { CARD_VIEWS } from "../src/cards/index.ts";

// W2 spine (D153): one renderer file per card type, looked up from a map, never a shared switch.
test("every card type in the schema has a renderer", () => {
  const types = Card.options.map((o) => o.shape.type.value).sort();
  expect(Object.keys(CARD_VIEWS).sort()).toEqual(types);
});

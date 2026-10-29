import { expect, test } from "bun:test";
import { parseToolArgs } from "../src/adapters/tool-json.ts";

test("parses ordinary tool arguments", () => {
  expect(parseToolArgs('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
});

// A real deepseek-flash world call returned a complete object followed by an extra "}".
test("ignores junk after a complete JSON object", () => {
  expect(parseToolArgs('{"a":{"b":"x}y"}}}\n')).toEqual({ a: { b: "x}y" } });
  expect(parseToolArgs('{"a":1} trailing words')).toEqual({ a: 1 });
});

test("still rejects JSON that was cut off", () => {
  expect(() => parseToolArgs('{"a":{"b":1')).toThrow();
});

test("treats empty arguments as an empty object", () => {
  expect(parseToolArgs("")).toEqual({});
});

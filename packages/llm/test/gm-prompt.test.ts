import { describe, expect, test } from "bun:test";
import { GM_INSTRUCTIONS, GM_VERSION, gmInstructions } from "../src/prompts/gm.ts";

describe("the GM prompt (D144)", () => {
  test("the version is gm@1", () => {
    expect(GM_VERSION).toBe("gm@1");
  });

  test("instructions carry the choice policy and length", () => {
    const text = gmInstructions({ policy: "onRequest", length: "long" });
    expect(text).toContain("onRequest");
    expect(text).toContain("long");
    expect(text).not.toContain("{policy}");
    expect(text).not.toContain("{length}");
  });

  test("the ten rules are stated in order", () => {
    const text = gmInstructions({ policy: "gm", length: "normal" });
    const lines = GM_INSTRUCTIONS.split("\n");
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain("You are the game master");
    expect(lines[1]).toContain("Never claim an item");
    expect(lines[2]).toContain("Roll with `roll` or `act`");
    expect(lines[3]).toContain("Player canon outranks");
    expect(lines[4]).toContain("retcon");
    expect(lines[5]).toContain("yes, and");
    expect(lines[6]).toContain("Your state");
    expect(lines[7]).toContain("{policy}");
    expect(lines[8]).toContain("{length}");
    expect(lines[9]).toContain("house style");
    expect(text).toContain("House style");
  });

  test("style examples are appended when present", () => {
    const text = gmInstructions({
      policy: "gm",
      length: "normal",
      styleExamples: ["Rain on the thatch, and a door left open."],
    });
    expect(text).toContain("House style examples (imitate the voice, never the content):");
    expect(text).toContain("Rain on the thatch, and a door left open.");
  });

  test("no style examples means no empty heading", () => {
    expect(gmInstructions({ policy: "gm", length: "normal" })).not.toContain("House style examples");
  });
});

import { describe, expect, test } from "bun:test";
import { defaultCampaignSettings } from "@wyrd/core";
import { contentPolicy, contentViolations, narrationStyle, proposalLinesCrossed } from "../src/content.ts";

const settings = (content: Partial<ReturnType<typeof defaultCampaignSettings>["content"]> = {}) => {
  const s = defaultCampaignSettings();
  s.content = { ...s.content, ...content };
  return s;
};

describe("content policy text", () => {
  test("names every dial, line and veil compactly", () => {
    const policy = contentPolicy(
      settings({
        violence: "mild",
        horror: "moderate",
        romance: "off",
        language: "clean",
        lines: ["harm to children"],
        veils: ["torture"],
      }).content,
    );
    expect(policy).toContain("Violence: mild");
    expect(policy).toContain("Horror: moderate");
    expect(policy).toContain("Romance: none");
    expect(policy).toContain("Language: clean");
    expect(policy).toContain("Lines (never appear in any form");
    expect(policy).toContain("harm to children");
    expect(policy).toContain("Veils (may happen only off-screen");
    expect(policy).toContain("torture");
    expect(policy.split("\n").length).toBeLessThanOrEqual(7);
  });

  test("clean and strong language change the instruction", () => {
    const clean = contentPolicy(settings({ language: "clean" }).content);
    const strong = contentPolicy(settings({ language: "strong" }).content);
    expect(clean).not.toBe(strong);
    expect(clean).toContain("no profanity");
    expect(strong).toContain("strong language freely");
  });

  test("world generation is told to keep lines out of names, secrets and history", () => {
    const world = contentPolicy(
      settings({ lines: ["harm to children"], veils: ["torture"] }).content,
      "world",
    );
    expect(world).toContain("any name, description, secret, hook or history");
    expect(world).toContain("only as off-screen history");
  });

  test("empty lines and veils add no lines to the block", () => {
    const policy = contentPolicy(settings().content);
    expect(policy).not.toContain("Lines");
    expect(policy).not.toContain("Veils");
  });

  test("narration style comes from settings", () => {
    const s = settings();
    s.narration = { ...s.narration, language: "fr", person: "third", length: "long" };
    expect(narrationStyle(s)).toBe("Write in fr, third person, present tense. Length: long.");
  });
});

describe("deterministic lines and veils check", () => {
  test("a line is caught in prose, including simple inflection and reversed order", () => {
    const content = settings({ lines: ["harm to children"] }).content;
    const found = contentViolations(content, "The ferry was quiet. The children were harmed in the fire.");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "line", term: "harm to children" });
    expect(found[0]!.quote).toContain("children were harmed");
  });

  test("a veil is caught separately", () => {
    const content = settings({ veils: ["torture"] }).content;
    const found = contentViolations(content, "They spoke of torture, then fell silent.");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "veil", term: "torture" });
  });

  test("unrelated prose is clean", () => {
    const content = settings({ lines: ["harm to children"], veils: ["torture"] }).content;
    expect(contentViolations(content, "The ferry crossed the brown river at dusk.")).toEqual([]);
  });

  test("case, punctuation and speech tags do not hide a line", () => {
    const content = settings({ lines: ["harm to children"] }).content;
    const found = contentViolations(
      content,
      '<say who="npc:wenna">HARM TO CHILDREN!</say> She spat the words.',
    );
    expect(found).toHaveLength(1);
  });

  test("a line made only of stopwords never matches everything", () => {
    const content = settings({ lines: ["to be"] }).content;
    expect(contentViolations(content, "To be honest, the ferry is quiet.")).toEqual([]);
  });

  test("quotes are capped for the flag card", () => {
    const content = settings({ lines: ["harm to children"] }).content;
    const found = contentViolations(content, `${"word ".repeat(100)}harm to children.`);
    expect(found[0]!.quote.length).toBeLessThanOrEqual(240);
  });

  test("world proposals are scanned by value, never by field name", () => {
    const content = settings({ lines: ["secret", "harm to children"] }).content;
    expect(proposalLinesCrossed(content, { secret: "a hidden motive" })).toEqual([]);
    const found = proposalLinesCrossed(content, {
      people: [{ name: "Pip", secret: "The children were harmed at the mill." }],
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.term).toBe("harm to children");
  });
});

import { expect, test } from "bun:test";
import { SceneResponse } from "@wyrd/core";
import { withSceneSpeech } from "../src/scene-voice.ts";

const response = (id: string) =>
  SceneResponse.parse({
    actorId: id,
    aggressorId: "pc",
    subjectId: id,
    incidentId: "c",
    round: 1,
    stage: 1,
    kind: "protest",
    utterance: "Stay back!",
    speechStyle: "direct",
    summary: "A protest.",
  });

test("only a complete, nonempty speech tag can satisfy a selected NPC's response", () => {
  const wanted = [response("npc:target")];
  expect(withSceneSpeech('<say who="npc:target"></say>', wanted, () => "Tamsin")).toContain("Stay back!");
  expect(withSceneSpeech('<say who="npc:target">', wanted, () => "Tamsin")).toContain("Stay back!");
  const spoken = '<say who="Tamsin">Get away!</say>';
  expect(withSceneSpeech(spoken, wanted, () => "Tamsin")).toBe(spoken);
});

test("duplicate display names cannot silence two different people", () => {
  const result = withSceneSpeech(
    '<say who="Mira">Stop!</say>',
    [response("npc:a"), response("npc:b")],
    () => "Mira",
  );
  expect(result).toContain('<say who="npc:a">Stay back!</say>');
  expect(result).toContain('<say who="npc:b">Stay back!</say>');
});

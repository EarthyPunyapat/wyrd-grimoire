import { describe, expect, test } from "bun:test";
import {
  defaultCampaignSettings,
  defaultTuning,
  type Entity,
  Entity as EntitySchema,
  type Fact,
  Fact as FactSchema,
  type Resolution,
  SceneState,
} from "@wyrd/core";
import { buildSheet, CORE_SKILL_CATALOG, type GameState, type RulesContext } from "@wyrd/engine";
import { type AssembleOptions, assemble, type CanonSource, estimateTokens } from "../src/assembler.ts";

const rules: RulesContext = { skills: CORE_SKILL_CATALOG, tuning: defaultTuning };

const entities: Entity[] = [
  EntitySchema.parse({
    id: "loc:ferry",
    kind: "location",
    name: "Ashford Ferry",
    detail: "full",
    summary: "A ferry house on a brown river.",
  }),
  EntitySchema.parse({
    id: "npc:wenna",
    kind: "npc",
    name: "Wenna",
    aliases: ["the ferrywoman"],
    detail: "sketch",
    summary: "The ferrywoman.",
  }),
  EntitySchema.parse({
    id: "npc:osric",
    kind: "npc",
    name: "Osric",
    detail: "stub",
    summary: "A tinker who owes Wenna money.",
  }),
];
const facts: Fact[] = [
  FactSchema.parse({
    id: "f1",
    entityId: "npc:wenna",
    predicate: "appearance.hands",
    value: "cracked like old leather",
    source: "pack",
  }),
  FactSchema.parse({
    id: "f2",
    entityId: "npc:wenna",
    predicate: "secret",
    value: "smuggles relics",
    source: "pack",
    visibility: "secret",
  }),
];

function canon(turns: Array<{ input: string; narration: string }> = []): CanonSource {
  return {
    entity: (id) => entities.find((e) => e.id === id) ?? null,
    factsAbout: (id, o) =>
      facts.filter((f) => f.entityId === id && (o?.includeSecret || f.visibility === "public")),
    findByName: (n) => entities.filter((e) => e.name.toLowerCase() === n.toLowerCase()),
    recentTurns: (limit) => turns.slice(-limit).map((t) => ({ ...t, status: "resolved" })),
  };
}

function state(): GameState {
  const settings = defaultCampaignSettings();
  settings.content.lines = ["harm to children"];
  const sheet = buildSheet(
    {
      id: "pc",
      identity: { name: "Wren", ancestry: "fantasy-core:halfling", pronouns: "she/her" },
      attributes: { str: 4, agi: 7, end: 5, int: 5, awa: 7, wil: 4, pre: 7 },
      skills: { "core:stealth": { trained: 60 } },
    },
    settings,
    defaultTuning,
  );
  return {
    campaign: {
      id: "c",
      name: "T",
      settings,
      packIds: ["fantasy-core"],
      packHash: null,
      rngState: [1, 2, 3, 4],
      gameTime: 1140,
    },
    mode: "exploration",
    party: { pcId: "pc", companionIds: [] },
    actors: { pc: { role: "pc", sheet } },
    scene: SceneState.parse({
      id: "s1",
      locationId: "loc:ferry",
      zones: [
        { id: "z:common", name: "the common room", props: [{ id: "prop:hatch", name: "cellar hatch" }] },
        { id: "z:jetty", name: "the jetty" },
      ],
      edges: [{ a: "z:common", b: "z:jetty" }],
      positions: { pc: "z:common", "npc:wenna": "z:jetty" },
      light: "dim",
      weather: "drizzle",
      openedAt: 0,
    }),
    combat: null,
    inventory: {},
    economy: {},
    factions: {},
    quests: {},
    clocks: {},
    calendar: { weather: {}, lastTick: { hour: 0, day: 0, week: 0 } },
    edges: [],
    minds: {},
    rumors: {},
    knowledge: { facts: {}, entities: {} },
    threat: null,
    flags: {},
    lastChecks: {},
  };
}

const stable = {
  roleInstructions: "You are the narrator.",
  rulesDigest: "Exploration rules.",
  tone: "Grim and wet.",
  worldBible: "A river valley.",
};
const resolution: Resolution = {
  actorId: "pc",
  steps: [{ index: 0, action: {}, outcome: "failure", summary: "Wren tries to slip past Osric: failure." }],
  requiredBeats: ["Wren tries to slip past Osric: failure."],
  forbidden: [],
  minutes: 1,
};
const opts = (over: Partial<AssembleOptions> = {}): AssembleOptions => ({
  role: "narrator",
  state: state(),
  canon: canon(),
  rules,
  stable,
  turn: { input: "I sneak towards the jetty.", resolution },
  ...over,
});

describe("context assembler v1", () => {
  test("instructions hold sections 1–4 and are byte-identical across turns", () => {
    const a = assemble(opts());
    const b = assemble(
      opts({ turn: { input: "Something else entirely." }, canon: canon([{ input: "x", narration: "y" }]) }),
    );
    expect(a.instructions).toBe(b.instructions);
    expect(a.instructions).toContain("## Role\n\nYou are the narrator.");
    expect(a.instructions).toContain("Lines (never include, in any form): harm to children.");
    expect(a.instructions).toContain("## Tone\n\nGrim and wet.");
  });

  test("context has the party, scene, focus entities and this turn", () => {
    const { context, sections } = assemble(opts());
    expect(sections.map((s) => s.n)).toEqual([6, 7, 8, 13]);
    expect(context).toContain("Wren (pc, she/her): halfling, unhurt");
    expect(context).toContain("Day 1, 19:00 (evening). Light: dim. Weather: drizzle.");
    expect(context).toContain("- the jetty: Wenna.");
    expect(context).toContain(
      "Required beats (mention every one):\n- Wren tries to slip past Osric: failure.",
    );
    // Osric isn't present but is named in the resolution, so he's a focus entity.
    expect(context).toContain("Osric (npc): A tinker who owes Wenna money.");
  });

  test("the narrator never sees secrets or IDs; the guard sees both", () => {
    const narrator = assemble(opts()).context;
    expect(narrator).toContain("appearance.hands: cracked like old leather");
    expect(narrator).not.toContain("smuggles relics");
    expect(narrator).not.toContain("[npc:wenna]");
    const guard = assemble(
      opts({ role: "guard", turn: { input: "x", resolution, draft: "Wenna counts her relics." } }),
    ).context;
    expect(guard).toContain("[f2] secret: smuggles relics (SECRET: the PC doesn't know this)");
    expect(guard).toContain("Wenna [npc:wenna]");
    expect(guard).toContain("Draft narration to check:\nWenna counts her relics.");
  });

  test("the parser sees IDs, skill values and the ways between places", () => {
    const { context } = assemble(opts({ role: "parser", turn: { input: "go to the jetty" } }));
    expect(context).toContain("the jetty [z:jetty]");
    expect(context).toContain("Stealth 81%");
    expect(context).toContain("the common room [z:common] ↔ the jetty [z:jetty]");
    expect(context).toContain("cellar hatch [prop:hatch]");
  });

  test("recent turns are trimmed oldest first, never below the minimum, to fit the budget", () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({
      input: `turn ${i}`,
      narration: "word ".repeat(400),
    }));
    const full = assemble(opts({ canon: canon(turns) }));
    expect(full.context).toContain("Player: turn 0");
    const tight = assemble(opts({ canon: canon(turns), budget: 2000 }));
    expect(tight.context).not.toContain("Player: turn 0\n");
    expect(tight.context).toContain("Player: turn 19");
    const kept = tight.context.match(/Player: turn \d+/g) ?? [];
    expect(kept.length).toBe(6); // narrator minimum
    expect(tight.tokens).toBe(estimateTokens(tight.instructions) + estimateTokens(tight.context));
  });

  test("this turn is never trimmed, even over budget", () => {
    const r = assemble(opts({ budget: 10, turn: { input: "very long ".repeat(500), resolution } }));
    expect(r.context).toContain("very long very long");
    expect(r.tokens).toBeGreaterThan(r.budget);
  });

  test("corrections from a blocked draft are included", () => {
    const { context } = assemble(
      opts({ turn: { input: "x", resolution, corrections: ["Osric was not killed."] } }),
    );
    expect(context).toContain("Fix these problems from your last draft:\n- Osric was not killed.");
  });
});

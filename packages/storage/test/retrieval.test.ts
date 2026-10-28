import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { EventEnvelope } from "@wyrd/core";
import { retrieve } from "../src/memory-index.ts";
import { applyProjections } from "../src/projections.ts";
import { migrate } from "../src/schema.ts";

/**
 * Memory recall eval (spec 15, "campaign memory eval set"): a campaign-sized index of facts, NPC
 * memories and summaries, and questions phrased the way the assembler builds queries (player input
 * plus focus names). Target: recall@10 ≥ 0.9.
 */
let seq = 0;
const env = (type: string, payload: unknown, gameTime = 0) =>
  ({
    id: `e${++seq}`,
    campaignId: "c",
    branchId: "main",
    seq,
    turnId: null,
    type,
    payload,
    source: "engine",
    gameTime,
    createdAt: "",
    schemaVersion: 1,
  }) as EventEnvelope;

const PEOPLE: Array<[string, string, string[]]> = [
  [
    "npc:wenna",
    "Wenna Harrow",
    [
      "charges two pennies a crossing, double after dark",
      "hands cracked like old leather",
      "fiercely protective of her son Hob",
      "keeps the ferry rope greased with eel fat",
    ],
  ],
  [
    "npc:hob",
    "Hob",
    [
      "twelve years old and works the ferry rope",
      "wants to run away to the city",
      "saw relics hidden in the cellar",
      "has a slingshot made from a forked hazel",
    ],
  ],
  [
    "npc:aldric",
    "Aldric Vane",
    [
      "wears a wet grey cloak",
      "burn scar across the back of his left hand",
      "claims to be a wool factor",
      "keeps his back to the wall",
    ],
  ],
  [
    "npc:tamsin",
    "Tamsin",
    [
      "cook at the ferry house",
      "makes an eel stew with too much pepper",
      "hears everything said in the common room",
      "owes money to a fence in Coldwater",
    ],
  ],
  [
    "npc:odile",
    "Odile Marsh",
    [
      "heads the Ledger House",
      "wears a silver abacus pendant",
      "the Ledger House is nearly bankrupt",
      "never forgives a missed payment",
    ],
  ],
  [
    "npc:brannoch",
    "Captain Brannoch",
    [
      "last captain of the watch",
      "lost an eye at Hollow Watch",
      "drinks only water",
      "trains recruits at dawn",
    ],
  ],
  [
    "npc:pell",
    "Pell Ashdown",
    [
      "market warden of Greywater",
      "takes bribes from both sides",
      "limps from an old fall",
      "collects carved river stones",
    ],
  ],
  [
    "npc:sel",
    "Sel Corran",
    [
      "trades in odd goods",
      "visited Hollow Watch last month",
      "carries a map stitched into her coat",
      "fears deep water",
    ],
  ],
  [
    "loc:ferry",
    "Ashford Ferry House",
    [
      "low stone inn on the north bank",
      "smells of eel stew and smoke",
      "the cellar hatch is locked at night",
      "a bell hangs by the jetty to call the ferry",
    ],
  ],
  [
    "site:greywater",
    "Greywater Market",
    [
      "crowded market town on the old crossing",
      "market day is every fifth day",
      "the bridge toll is three pennies",
      "famous for dyed wool",
    ],
  ],
  [
    "site:hollow",
    "Hollow Watch",
    [
      "abandoned watch post on a ridge",
      "lights seen in its tower at night",
      "half the old garrison died there",
      "the gate is chained shut",
    ],
  ],
  [
    "faction:ledger",
    "the Ledger House",
    [
      "merchant house holding the region's debts",
      "wants to buy the market charter",
      "pays informants in every inn",
      "its ledgers are kept in cipher",
    ],
  ],
];

const MEMORIES: Array<[string, string]> = [
  ["npc:wenna", "The stranger asked how much the crossing cost and didn't haggle."],
  ["npc:wenna", "Hob was seen talking to the man in the grey cloak."],
  ["npc:aldric", "The cook keeps glancing at the cellar hatch."],
  ["npc:brannoch", "Sergeant Holt told me the stranger lied about the warehouse."],
  ["npc:pell", "Someone left a purse of silver under my stall at dawn."],
  ["npc:sel", "The lights in the tower moved against the wind."],
];

const SUMMARIES = [
  "Wren arrived at the ferry house in the rain, paid Wenna for a crossing that couldn't happen until morning, and noticed the stranger in the grey cloak watching the cellar hatch.",
  "At Greywater Market Wren met the warden Pell Ashdown, who took a bribe in plain sight, and heard that the Ledger House wants the market charter.",
  "On the ridge road a band of thieves ambushed Wren; Wren fought them off and found a map pointing to Hollow Watch.",
];

function campaign() {
  const db = new Database(":memory:");
  migrate(db);
  const fact = (id: string, entityId: string, value: string, importance = 2, source = "pack") =>
    applyProjections(
      db,
      env("FactAsserted", {
        fact: { id, entityId, predicate: "note", value, source, visibility: "public", importance },
      }),
    );
  for (const [id, name, facts] of PEOPLE) {
    const kind = id.split(":")[0] === "npc" ? "npc" : "location";
    applyProjections(
      db,
      env("EntityCreated", {
        entity: {
          id,
          kind,
          name,
          aliases: [],
          detail: "sketch",
          summary: "",
          data: {},
          status: "active",
          importance: 2,
        },
      }),
    );
    for (const [i, value] of facts.entries()) fact(`${id}:${i}`, id, value);
  }
  // Noise: many low-importance facts about walk-on people.
  for (let i = 0; i < 80; i++)
    fact(
      `noise:${i}`,
      `npc:extra-${i % 20}`,
      `an ordinary traveller number ${i} with a pack and tired feet`,
      1,
      "model",
    );
  for (const [i, [npc, content]] of MEMORIES.entries())
    applyProjections(
      db,
      env("MemoryRecorded", {
        memory: {
          id: `mem:${i}`,
          npcId: npc,
          gameTime: i * 60,
          kind: "witnessed",
          content,
          about: [],
          importance: 3,
          feeling: 0,
          belief: 1,
        },
      }),
    );
  for (const [i, text] of SUMMARIES.entries())
    applyProjections(
      db,
      env(
        "SummaryWritten",
        {
          summary: {
            id: `sum:${i}`,
            level: "scene",
            fromSeq: 1,
            toSeq: 2,
            gameTime: i * 1440,
            text,
            entityIds: [],
            importance: 3,
          },
        },
        i * 1440,
      ),
    );
  return db;
}

const CASES: Array<[string, string[], string]> = [
  ["How much does Wenna charge to cross? Wenna Harrow", ["facts"], "fact:npc:wenna:0"],
  ["I look at Wenna's hands. Wenna Harrow", ["facts"], "fact:npc:wenna:1"],
  ["Is Wenna protective of her son? Wenna Harrow Hob", ["facts"], "fact:npc:wenna:2"],
  ["What does Hob want? Hob", ["facts"], "fact:npc:hob:1"],
  ["Ask Hob about the relics in the cellar. Hob", ["facts"], "fact:npc:hob:2"],
  ["I study the scar on the stranger's hand. Aldric Vane", ["facts"], "fact:npc:aldric:1"],
  ["What does the stranger say his trade is? Aldric Vane", ["facts"], "fact:npc:aldric:2"],
  ["Does Tamsin owe anyone money? Tamsin Coldwater", ["facts"], "fact:npc:tamsin:3"],
  ["Who leads the Ledger House? Odile Marsh the Ledger House", ["facts"], "fact:npc:odile:0"],
  ["How did Captain Brannoch lose his eye? Captain Brannoch Hollow Watch", ["facts"], "fact:npc:brannoch:1"],
  ["Does the warden take bribes? Pell Ashdown", ["facts"], "fact:npc:pell:1"],
  ["Has Sel been to Hollow Watch? Sel Corran Hollow Watch", ["facts"], "fact:npc:sel:1"],
  ["What's the toll on the bridge at Greywater? Greywater Market", ["facts"], "fact:site:greywater:2"],
  ["Tell me about the lights in the tower. Hollow Watch", ["facts"], "fact:site:hollow:1"],
  [
    "What does the Ledger House want with the market? the Ledger House Greywater Market",
    ["facts"],
    "fact:faction:ledger:1",
  ],
  ["What did Wenna notice about Hob? Wenna Harrow Hob", ["npc:npc:wenna"], "mem:1"],
  ["What has the captain heard about the stranger? Captain Brannoch", ["npc:npc:brannoch"], "mem:3"],
  ["Remember the ambush on the ridge road. thieves map", ["summaries"], "sum:2"],
  ["What happened at the market with the warden? Pell Ashdown Greywater Market", ["summaries"], "sum:1"],
  [
    "When I first came to the ferry house in the rain. Wenna Harrow Ashford Ferry House",
    ["summaries"],
    "sum:0",
  ],
];

describe("memory recall eval", () => {
  test("recall@10 ≥ 0.9 across facts, NPC memories and summaries", () => {
    const db = campaign();
    let hits = 0;
    const misses: string[] = [];
    for (const [query, namespaces, expected] of CASES) {
      const found = retrieve(db, { query, namespaces, includeSecret: true, now: 5 * 1440, limit: 10 }).map(
        (h) => h.id,
      );
      if (found.includes(expected)) hits++;
      else misses.push(`${query} → ${expected}`);
    }
    const recall = hits / CASES.length;
    if (recall < 0.9) console.log(misses);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  test("visibility: secret items stay out unless asked for, and namespaces don't leak", () => {
    const db = campaign();
    applyProjections(
      db,
      env("FactAsserted", {
        fact: {
          id: "s1",
          entityId: "npc:aldric",
          predicate: "secret",
          value: "he is a reeve's agent hunting relic thieves",
          source: "pack",
          visibility: "secret",
          importance: 4,
        },
      }),
    );
    expect(
      retrieve(db, { query: "Aldric Vane reeve agent", namespaces: ["facts"], now: 0 }).map((h) => h.id),
    ).not.toContain("fact:s1");
    expect(
      retrieve(db, {
        query: "Aldric Vane reeve agent",
        namespaces: ["facts"],
        includeSecret: true,
        now: 0,
      }).map((h) => h.id),
    ).toContain("fact:s1");
    expect(
      retrieve(db, {
        query: "Hob talking grey cloak",
        namespaces: ["npc:npc:aldric"],
        includeSecret: true,
        now: 0,
      }).map((h) => h.id),
    ).not.toContain("mem:1");
  });
});

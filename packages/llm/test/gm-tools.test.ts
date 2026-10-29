import { afterEach, beforeEach, expect, test } from "bun:test";
import { catalogWith } from "@wyrd/engine";
import { executeTool, gmToolDefs } from "../src/gm/tools.ts";
import { makeTurnContext } from "../src/pipeline.ts";
import { gmFixture, rules } from "./gm-fixture.ts";

let fx: ReturnType<typeof gmFixture>;
beforeEach(() => {
  fx = gmFixture();
});
afterEach(() => fx.close());

let n = 0;
function run(name: string, args: unknown) {
  const state = fx.store.state();
  return executeTool(
    { id: `call_${++n}`, name, args },
    {
      state,
      pcId: "pc",
      turnId: "turn-1",
      ctx: makeTurnContext(state, fx.canon, rules),
      canon: fx.canon,
      items: catalogWith(state, { weapons: {}, armor: {}, gear: {} }),
      newId: () => `id${++n}`,
    },
  );
}
const types = (r: Awaited<ReturnType<typeof run>>) => r.effects.drafts.map((d) => d.type);

test("lists core, Levels and source GM tools", () => {
  expect(
    gmToolDefs({ inCombat: false })
      .map((t) => t.name)
      .sort(),
  ).toEqual(
    [
      "source_timeline",
      "intervene_canon",
      "propose_level_up",
      "grant_ability",
      "rank_ability",
      "breakthrough",
      "set_level",
      "delegate",
      "act",
      "change_state",
      "lookup_lore",
      "observe",
      "offer_choices",
      "retcon",
      "roll",
      "show_card",
      "time_skip",
    ].sort(),
  );
});

test("roll resolves a check", async () => {
  const r = await run("roll", {
    skill: "core:stealth",
    difficulty: "normal",
    goal: "slip past the ferrywoman",
  });
  expect(r.ok).toBe(true);
  expect(r.effects.mechanics).toHaveLength(1);
  expect(types(r)).toContain("CheckResolved");
  expect(r.effects.progress?.phase).toBe("rolling");
  expect(r.effects.mechanics[0]?.purpose).toBe("slip past the ferrywoman");
});

test("act reports plan errors to the model", async () => {
  const r = await run("act", { actions: [{ type: "interact", targetId: "npc:nobody", verb: "open" }] });
  expect(r.ok).toBe(false);
  expect(JSON.parse(r.result).errors).toBeDefined();
  expect(r.effects.drafts).toHaveLength(0);
});

test("change_state defines and gives an item", async () => {
  const r = await run("change_state", {
    changes: [
      { kind: "item.define", name: "Yellow lantern ring", description: "Glows with fear." },
      { kind: "item.give", actorId: "pc", itemId: "campaign:yellow-lantern-ring" },
    ],
  });
  expect(r.ok).toBe(true);
  expect(types(r)).toEqual(expect.arrayContaining(["ItemDefined", "ItemTransferred"]));
});

test("retcon emits RetconApplied with an inverse and a retcon card", async () => {
  const r = await run("retcon", {
    summary: "You always had a spare coin",
    changes: [{ kind: "coins", actorId: "pc", delta: 5 }],
  });
  expect(r.ok).toBe(true);
  const applied = r.effects.drafts.find((d) => d.type === "RetconApplied");
  expect(applied).toBeDefined();
  const payload = applied!.payload as { inverse: unknown[]; turnId: string; retconId: string };
  expect(payload.inverse.length).toBeGreaterThan(0);
  expect(payload.turnId).toBe("turn-1");
  expect(r.effects.cards).toEqual([{ type: "retcon", retconId: payload.retconId }]);
  expect(r.effects.retcon?.retconId).toBe(payload.retconId);
});

test("lookup_lore hides secret facts", async () => {
  const r = await run("lookup_lore", { query: "Wenna" });
  expect(r.ok).toBe(true);
  expect(r.result).toContain("cracked like old leather");
  expect(r.result).not.toContain("smuggles relics");
  expect(r.effects.progress?.phase).toBe("researching");
});

test("lookup_lore skips entities the PC does not know", async () => {
  const r = await run("lookup_lore", { query: "Drowned" });
  expect(r.result).not.toContain("The Drowned Man");
});

test("observe refuses unknown entities", async () => {
  const r = await run("observe", { targetId: "npc:ghost" });
  expect(r.ok).toBe(false);
  expect(r.result).toContain("not known");
});

test("observe returns a known entity with its public facts and place", async () => {
  const r = await run("observe", { targetId: "npc:wenna" });
  expect(r.ok).toBe(true);
  expect(r.result).toContain("cracked like old leather");
  expect(r.result).toContain("z:jetty");
  expect(r.result).not.toContain("smuggles relics");
});

test("show_card and offer_choices are effects only", async () => {
  const c = await run("show_card", { cards: [{ type: "chapter", title: "The Ferry" }] });
  expect(c.ok).toBe(true);
  expect(c.effects.cards[0]).toEqual({ type: "chapter", title: "The Ferry", subtitle: "" });
  const o = await run("offer_choices", { choices: [{ label: "Cross" }, { label: "Wait" }] });
  expect(o.effects.choices.map((x) => x.label)).toEqual(["Cross", "Wait"]);
  expect(o.effects.drafts).toHaveLength(0);
});

test("time_skip waits and reports simulating", async () => {
  const r = await run("time_skip", { minutes: 60, reason: "wait for the tide" });
  expect(r.ok).toBe(true);
  expect(r.effects.progress).toEqual({ phase: "simulating", detail: "wait for the tide" });
  expect(types(r)).toContain("TimeAdvanced");
});

test("bad args never throw", async () => {
  expect((await run("roll", { nope: 1 })).ok).toBe(false);
  expect((await run("roll", { nope: 1 })).result).toContain("errors");
  expect((await run("summon_dragon", {})).ok).toBe(false);
});

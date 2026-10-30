import { describe, expect, test } from "bun:test";
import { draft, type RecipeDef, RecipeDef as RecipeSchema } from "@wyrd/core";
import { abandonResearch, type DowntimeContext, resolveDowntime } from "../src/downtime.ts";
import { unwrap } from "../src/result.ts";
import { ctx as rules, Sim } from "./sim.ts";

const recipe: RecipeDef & { id: string } = {
  ...RecipeSchema.parse({
    id: "test-ration",
    name: "Test Ration",
    output: { item: "test:ration", qty: 1 },
    inputs: [{ item: "test:flour", qty: 1 }],
    skill: "core:mechanics",
    difficulty: "easy",
    minutes: 30,
  }),
  id: "test:test-ration",
};
const ctx: DowntimeContext = { ...rules, nameOf: (id) => id, recipes: { "test:test-ration": recipe } };

function sim(seed = 3) {
  const s = new Sim({}, seed);
  s.addActor("pc", "pc");
  return s;
}

const types = (drafts: { type: string }[]) => drafts.map((d) => d.type);

describe("downtime (spec 06)", () => {
  test("work advances time, resolves and pays by degree", () => {
    const s = sim();
    const out = unwrap(resolveDowntime(s.state, "pc", { type: "work" }, ctx));
    expect(out.result.action).toBe("work");
    expect(out.result.minutes).toBe(rules.tuning.downtime.minutes.work);
    expect(types(out.events)).toContain("TimeAdvanced");
    expect(types(out.events)).toContain("DowntimeResolved");
    s.commit(out.events);
    if (out.result.degree !== "critFailure") {
      expect(types(out.events)).toContain("CoinsChanged");
      expect(s.state.economy.wallets.pc!.coins).toBe(rules.tuning.downtime.workPay[out.result.degree!]);
    }
  });

  test("research starts a clock and continues it", () => {
    const s = sim();
    const first = unwrap(resolveDowntime(s.state, "pc", { type: "research", topic: "the old well" }, ctx));
    s.commit(first.events);
    const clockId = first.result.rewards.clockId!;
    expect(s.state.clocks[clockId]!.name).toBe("the old well");
    const second = unwrap(
      resolveDowntime(s.state, "pc", { type: "research", topic: "the old well", clockId }, ctx),
    );
    s.commit(second.events);
    expect(s.state.clocks[clockId]!.filled).toBe(2);
  });

  test("researching the same topic again continues its clock instead of starting another", () => {
    const s = sim();
    const first = unwrap(resolveDowntime(s.state, "pc", { type: "research", topic: "Kryptonite" }, ctx));
    s.commit(first.events);
    const again = unwrap(resolveDowntime(s.state, "pc", { type: "research", topic: "  kryptonite " }, ctx));
    s.commit(again.events);
    const research = Object.values(s.state.clocks).filter((c) => c.id.startsWith("clock:research:"));
    expect(research).toHaveLength(1);
    expect(research[0]!.filled).toBe(2);
    expect(again.result.rewards.clockId).toBe(first.result.rewards.clockId);
  });

  test("finished research can't be repeated, and only your own research clocks can be continued", () => {
    const s = sim();
    const first = unwrap(resolveDowntime(s.state, "pc", { type: "research", topic: "the old well" }, ctx));
    s.commit(first.events);
    const clockId = first.result.rewards.clockId!;
    const left = s.state.clocks[clockId]!.segments - s.state.clocks[clockId]!.filled;
    s.commit([draft("ClockAdvanced", { clockId, by: left, reason: "test" }, "engine")]);
    const done = resolveDowntime(s.state, "pc", { type: "research", topic: "The old well" }, ctx);
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.errors[0]!.code).toBe("RESEARCH_DONE");
    s.commit([
      draft("ClockCreated", {
        clock: {
          id: "clock:threat",
          name: "The Hollow Lantern",
          kind: "progress",
          segments: 6,
          filled: 0,
          visible: true,
        },
      }),
    ]);
    const hijack = resolveDowntime(
      s.state,
      "pc",
      { type: "research", topic: "x", clockId: "clock:threat" },
      ctx,
    );
    expect(hijack.ok).toBe(false);
    expect(s.state.clocks["clock:threat"]!.filled).toBe(0);
  });

  test("research can be abandoned, and only research the actor owns", () => {
    const s = sim();
    const first = unwrap(resolveDowntime(s.state, "pc", { type: "research", topic: "Kryptonite" }, ctx));
    s.commit(first.events);
    const clockId = first.result.rewards.clockId!;
    expect(abandonResearch(s.state, "pc", "clock:threat").ok).toBe(false);
    s.commit(unwrap(abandonResearch(s.state, "pc", clockId)));
    expect(s.state.clocks[clockId]).toBeUndefined();
    const fresh = unwrap(resolveDowntime(s.state, "pc", { type: "research", topic: "Kryptonite" }, ctx));
    s.commit(fresh.events);
    expect(s.state.clocks[fresh.result.rewards.clockId!]!.filled).toBe(1);
  });

  test("recovery heals, and training with a teacher grants an improvement", () => {
    const s = sim();
    s.commit([draft("HpChanged", { actorId: "pc", hp: 1, delta: 0, cause: "damage" })]);
    const out = unwrap(resolveDowntime(s.state, "pc", { type: "recover" }, ctx));
    s.commit(out.events);
    expect(s.state.actors.pc!.sheet.status.hp).toBeGreaterThan(1);

    s.addActor("npc:teacher", "npc");
    s.commit([
      draft("SceneOpened", {
        scene: {
          id: "scene-1",
          locationId: "loc:test",
          zones: [{ id: "z:here", name: "here", tags: [], props: [] }],
          edges: [],
          positions: { pc: "z:here", "npc:teacher": "z:here" },
          light: "bright",
          weather: "",
          openedAt: 0,
        },
      }),
    ]);
    const train = unwrap(
      resolveDowntime(s.state, "pc", { type: "train", skill: "core:melee", teacherId: "npc:teacher" }, ctx),
    );
    expect(types(train.events)).toContain("SkillMarked");
    expect(train.result.rewards.improvement).toBe(true);
  });

  test("train and work refuse a skill the pack does not have", () => {
    const s = sim();
    s.addActor("npc:teacher", "npc");
    s.commit([
      draft("SceneOpened", {
        scene: {
          id: "scene-1",
          locationId: "loc:test",
          zones: [{ id: "z:here", name: "here", tags: [], props: [] }],
          edges: [],
          positions: { pc: "z:here", "npc:teacher": "z:here" },
          light: "bright",
          weather: "",
          openedAt: 0,
        },
      }),
    ]);
    for (const action of [
      { type: "train" as const, skill: "not a skill", teacherId: "npc:teacher" },
      { type: "train" as const, skill: "core:nope", teacherId: "npc:teacher" },
      { type: "work" as const, skill: "not a skill" },
      { type: "work" as const, skill: "core:nope" },
    ]) {
      const before = s.events.length;
      const out = resolveDowntime(s.state, "pc", action, ctx);
      expect(out.ok).toBe(false);
      if (out.ok) continue;
      expect(out.errors[0]!.code).toBe("SKILL_UNKNOWN");
      expect(out.errors[0]!.message).toContain(action.skill);
      expect(s.events.length).toBe(before);
    }
    expect(s.state.actors.pc!.sheet.progression.marks).toEqual([]);
  });
});

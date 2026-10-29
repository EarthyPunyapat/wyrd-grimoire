import { expect, test } from "bun:test";
import { defaultTuning, draft } from "@wyrd/core";
import { approvalEvents, milestones } from "../src/companions.ts";
import {
  advanceDelegations,
  assignTask,
  blockedTasks,
  companionBond,
  delegationTasks,
} from "../src/delegation.ts";
import { reduce } from "../src/reduce.ts";
import { unwrap } from "../src/result.ts";
import { ctx, Sim } from "./sim.ts";

function setup(seed = 1) {
  const s = new Sim({ structural: { resolution: "d20" } }, seed);
  s.addActor("pc", "pc");
  const sheet = s.addActor("ari", "npc", { level: 20 });
  s.commit([draft("CompanionJoined", { companionId: "ari", reason: "A lasting bond", sheet })]);
  return s;
}
const task = (over = {}) => ({
  id: "task-1",
  assignee: "ari",
  goal: "Inspect the beacon",
  due: 60,
  opposition: { level: 20 },
  ...over,
});
const advance = (s: Sim, minutes: number) => {
  s.commit([draft("TimeAdvanced", { minutes, reason: "test" })]);
  s.commit(advanceDelegations(s.state, ctx));
};

test("loyal companions ignore approval and departure events, including replay", () => {
  const s = setup();
  s.commit(
    unwrap(
      companionBond(s.state, "ari", {
        loyal: true,
        voiceProfile: "Warm, precise, and candid. Call the player Ethan.",
      }),
    ),
  );
  s.commit([
    draft("ApprovalChanged", { companionId: "ari", delta: -100, reason: "test" }),
    draft("CompanionLeft", { companionId: "ari", reason: "test", betrayed: true, beat: "Leaves" }),
  ]);
  expect(s.state.companions.ari!.approval).toBe(0);
  expect(s.state.companions.ari!.status).toBe("active");
  expect(s.state.party.companionIds).toContain("ari");
  expect(
    approvalEvents(s.state, [{ companionId: "ari", delta: -10, reason: "test" }], (id) => id, defaultTuning),
  ).toEqual([]);
  s.state.companions.ari!.approval = -100;
  expect(milestones(s.state, "ari", "test", (id) => id, defaultTuning)).toEqual([]);
  expect(s.state.companions.ari!.voiceProfile).toContain("Warm");
});

test("assignment validates living companions, future due time, IDs, owned ability and opposition", () => {
  const s = setup();
  for (const over of [
    { assignee: "pc" },
    { assignee: "missing" },
    { due: 0 },
    { abilityId: "missing" },
    { opposition: { actorId: "missing" } },
    { goal: "  " },
  ])
    expect(assignTask(s.state, task(over), ctx).ok).toBe(false);
  s.commit(unwrap(assignTask(s.state, task(), ctx)));
  expect(delegationTasks(s.state)[0]?.status).toBe("active");
  expect(assignTask(s.state, task(), ctx).ok).toBe(false);
  expect(advanceDelegations(s.state, ctx)).toEqual([]);
});

test("seeded equal-level rolls can succeed or fail, complete only at due time and never reroll", () => {
  const statuses = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) {
    const s = setup(seed);
    s.commit(unwrap(assignTask(s.state, task(), ctx)));
    advance(s, 30);
    expect(delegationTasks(s.state)[0]!.status).toBe("active");
    advance(s, 30);
    const done = delegationTasks(s.state)[0]!;
    statuses.add(done.status);
    expect(["done", "failed"]).toContain(done.status);
    expect(done.report).toContain("Inspect the beacon");
    const progress = s.events.filter((e) => e.type === "TaskProgressed" && e.payload.roll);
    expect(progress).toHaveLength(1);
    expect(
      progress[0]!.type === "TaskProgressed" ? progress[0]!.payload.roll?.rolls : undefined,
    ).toHaveLength(1);
    expect(advanceDelegations(s.state, ctx)).toEqual([]);
    let rebuilt: typeof s.state | undefined;
    for (const e of s.events) rebuilt = reduce(rebuilt, e);
    expect(rebuilt).toEqual(s.state);
  }
  expect([...statuses].sort()).toEqual(["done", "failed"]);
});

test("impossible gaps block, expose an interruption and can be retried with a cited exploit", () => {
  const s = setup();
  s.commit(unwrap(assignTask(s.state, task({ opposition: { level: 22 } }), ctx)));
  const before = s.state.campaign.rngState;
  advance(s, 60);
  expect(delegationTasks(s.state)[0]?.status).toBe("blocked");
  expect(blockedTasks(s.state)).toHaveLength(1);
  expect(s.state.campaign.rngState).toEqual(before);
  s.commit(
    unwrap(
      assignTask(
        s.state,
        task({ due: 120, exploit: "The beacon's exposed core", opposition: { level: 22 } }),
        ctx,
      ),
    ),
  );
  advance(s, 60);
  expect(delegationTasks(s.state)[0]?.status).not.toBe("blocked");
});

test("level advantages and infinity resolve automatically; legacy campaigns still use d20 task checks", () => {
  const s = setup();
  s.state.campaign.settings.structural.resolution = "d100";
  s.commit(unwrap(assignTask(s.state, task({ opposition: { level: 20 } }), ctx)));
  advance(s, 60);
  const roll = s.events.find((e) => e.type === "TaskProgressed" && e.payload.roll);
  expect(roll?.type === "TaskProgressed" ? roll.payload.roll?.display.roll?.die : undefined).toBe("d20");
  const infinite = setup();
  infinite.state.actors.ari!.sheet.level = "infinite";
  infinite.commit(unwrap(assignTask(infinite.state, task(), ctx)));
  const before = infinite.state.campaign.rngState;
  advance(infinite, 60);
  expect(delegationTasks(infinite.state)[0]!.status).toBe("done");
  expect(infinite.state.campaign.rngState).toEqual(before);
});

test("downtime advances tasks through the shared resolver", async () => {
  const { resolveDowntime } = await import("../src/downtime.ts");
  const s = setup();
  s.commit(unwrap(assignTask(s.state, task({ opposition: { level: 18 } }), ctx)));
  s.commit(
    unwrap(resolveDowntime(s.state, "pc", { type: "recover" }, { ...ctx, nameOf: (id) => id })).events,
  );
  expect(delegationTasks(s.state)[0]!.status).toBe("done");
});

test("long and split advances interleave daily world RNG and task rolls in the same order", async () => {
  const { runTicks } = await import("../src/world/ticks.ts");
  const create = () => {
    const s = setup(17);
    s.commit(unwrap(assignTask(s.state, task({ id: "early", due: 60 }), ctx)));
    s.commit(unwrap(assignTask(s.state, task({ id: "late", due: 1500 }), ctx)));
    return s;
  };
  const world = {
    ...ctx,
    nameOf: (id: string) => id,
    regions: () => [{ id: "region:test", climate: "temperate" }],
  };
  const long = create();
  long.commit([draft("TimeAdvanced", { minutes: 2000, reason: "test" })]);
  long.commit(runTicks(long.state, world));
  const split = create();
  for (const minutes of [60, 1380, 60, 500]) {
    split.commit([draft("TimeAdvanced", { minutes, reason: "test" })]);
    split.commit(runTicks(split.state, world));
  }
  expect(delegationTasks(long.state)).toEqual(delegationTasks(split.state));
  expect(long.state.campaign.rngState).toEqual(split.state.campaign.rngState);
});

test("an unavailable assignee blocks instead of inventing a result or consuming dice", () => {
  const s = setup();
  s.commit(unwrap(assignTask(s.state, task(), ctx)));
  s.commit([draft("ActorDied", { actorId: "ari", cause: "test" })]);
  const before = s.state.campaign.rngState;
  advance(s, 60);
  expect(blockedTasks(s.state)).toHaveLength(1);
  expect(s.state.campaign.rngState).toEqual(before);
});

test("editing a voice cannot revoke an existing loyal bond", () => {
  const s = setup();
  s.commit(unwrap(companionBond(s.state, "ari", { loyal: true })));
  s.commit(unwrap(companionBond(s.state, "ari", { loyal: undefined, voiceProfile: "Warm and wry." })));
  expect(s.state.companions.ari!.loyal).toBe(true);
});

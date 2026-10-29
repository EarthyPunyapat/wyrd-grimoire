import { afterEach, expect, test } from "bun:test";
import { catalogWith, Working } from "@wyrd/engine";
import { executeTool } from "../src/gm/tools.ts";
import { makeTurnContext } from "../src/pipeline.ts";
import { gmFixture, rules } from "./gm-fixture.ts";

const fixtures: ReturnType<typeof gmFixture>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.close();
});
function setup() {
  const fx = gmFixture();
  fixtures.push(fx);
  let state = fx.store.state();
  state.campaign.settings.structural.resolution = "d20";
  state.actors.pc!.sheet.level = "infinite";
  let n = 0;
  const run = (name: string, args: unknown) =>
    executeTool(
      { id: "c", name, args },
      {
        state,
        pcId: "pc",
        turnId: "t",
        canon: fx.canon,
        ctx: makeTurnContext(state, fx.canon, rules),
        items: catalogWith(state, { weapons: {}, armor: {}, gear: {} }),
        newId: () => `avatar-${++n}`,
      },
    );
  const apply = (drafts: Parameters<Working["apply"]>[0]) => {
    const w = new Working(state);
    w.apply(drafts);
    state = w.state;
  };
  return {
    get state() {
      return state;
    },
    run,
    apply,
  };
}

test("create_avatar makes a playable actor at the chosen Level and starts a run", async () => {
  const s = setup();
  const r = await s.run("create_avatar", { name: "Mira Voss", level: 7, worldId: "world:main" });
  expect(r.ok).toBe(true);
  expect(r.effects.drafts.map((d) => d.type)).toEqual(
    expect.arrayContaining(["ActorCreated", "AvatarCreated"]),
  );
  const created = r.effects.drafts.find((d) => d.type === "ActorCreated");
  expect(created?.payload.sheet.identity.name).toBe("Mira Voss");
  expect(created?.payload.sheet.level).toBe(7);
  s.apply(r.effects.drafts);
  expect(s.state.actors[created!.type === "ActorCreated" ? created!.payload.sheet.id : ""]?.role).toBe(
    "companion",
  );
  expect(Object.values((s.state.flags.avatarRuns ?? {}) as Record<string, { level: number }>)[0]?.level).toBe(
    7,
  );
});

test("create_avatar is refused for a finite character", async () => {
  const s = setup();
  s.state.actors.pc!.sheet.level = 12;
  expect((await s.run("create_avatar", { name: "Mira", level: 3 })).ok).toBe(false);
});

test("an avatar at a finite Level rolls real dice against its opposition", async () => {
  const s = setup();
  const created = await s.run("create_avatar", { name: "Mira", level: 7 });
  s.apply(created.effects.drafts);
  const avatarId = created.effects.drafts.find((d) => d.type === "AvatarCreated")?.payload.avatarId as string;
  const roll = await s.run("roll", {
    actorId: avatarId,
    skill: "core:stealth",
    difficulty: "normal",
    goal: "slip past the guard",
    opposition: { level: 7 },
  });
  expect(roll.ok).toBe(true);
  expect(roll.effects.mechanics[0]?.roll).toBeDefined();
});

test("an infinite avatar is refused: avatars must roll", async () => {
  const s = setup();
  expect((await s.run("create_avatar", { name: "Mira", level: "infinite" })).ok).toBe(false);
});

test("a sovereign tool call during an active run unseals it", async () => {
  const s = setup();
  const created = await s.run("create_avatar", { name: "Mira", level: 5 });
  s.apply(created.effects.drafts);

  const act = await s.run("roll", {
    actorId: "pc",
    skill: "core:stealth",
    difficulty: "normal",
    goal: "intervene directly",
  });
  expect(act.ok).toBe(true);
  expect(act.effects.drafts[0]?.type).toBe("AvatarRunEnded");
  expect(act.effects.drafts[0]?.payload).toMatchObject({ reason: "unsealed" });
  s.apply(act.effects.drafts);
  const runs = Object.values((s.state.flags.avatarRuns ?? {}) as Record<string, { status: string }>);
  expect(runs[0]?.status).toBe("ended");
});

test("seal sets an effective Level for resolution and unseal restores the true Level", async () => {
  const s = setup();
  let r = await s.run("seal", { actorId: "pc", effectiveLevel: 5 });
  expect(r.ok).toBe(true);
  expect(r.effects.drafts[0]?.type).toBe("SealSet");
  s.apply(r.effects.drafts);
  expect(s.state.actors.pc!.sheet.effectiveLevel).toBe(5);

  r = await s.run("unseal", { actorId: "pc" });
  expect(r.ok).toBe(true);
  expect(r.effects.drafts[0]?.type).toBe("SealBroken");
  s.apply(r.effects.drafts);
  expect(s.state.actors.pc!.sheet.effectiveLevel).toBeUndefined();

  expect((await s.run("seal", { actorId: "missing", effectiveLevel: 5 })).ok).toBe(false);
});

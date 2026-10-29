import { expect, test } from "bun:test";
import { draft } from "@wyrd/core";
import { activeAvatarRuns, avatarRuns, runForSovereign } from "../src/avatars.ts";
import { resolveCheck } from "../src/checks.ts";
import { effectiveLevel, levelDelta } from "../src/levels.ts";
import { unwrap } from "../src/result.ts";
import { ctx, Sim } from "./sim.ts";

function campaign() {
  const sim = new Sim();
  sim.addActor("pc", "pc", { level: "infinite" });
  sim.addActor("av", "companion", { level: 5 });
  return sim;
}

test("an avatar run records the chosen level and starts active", () => {
  const sim = campaign();
  sim.commit([
    draft("AvatarCreated", { avatarId: "av", sovereignId: "pc", level: 5, worldId: "world:main" }, "player"),
  ]);
  const run = runForSovereign(sim.state, "pc");
  expect(run?.avatarId).toBe("av");
  expect(run?.level).toBe(5);
  expect(run?.status).toBe("active");
  expect(activeAvatarRuns(sim.state).map((r) => r.avatarId)).toEqual(["av"]);
  expect(sim.state.actors.av!.sheet.level).toBe(5);
});

test("an avatar's death ends its run but never the sovereign", () => {
  const sim = campaign();
  sim.commit([
    draft("AvatarCreated", { avatarId: "av", sovereignId: "pc", level: 5, worldId: "world:main" }, "player"),
    draft("ActorDied", { actorId: "av", cause: "fell from the tower" }, "engine"),
  ]);
  expect(avatarRuns(sim.state)[0]?.status).toBe("ended");
  expect(avatarRuns(sim.state)[0]?.reason).toBe("died");
  expect(sim.state.actors.av!.dead).toBe(true);
  expect(sim.state.actors.pc!.dead).toBeUndefined();
  expect(activeAvatarRuns(sim.state)).toEqual([]);
});

test("a sovereign cannot be killed while a run is on record", () => {
  const sim = campaign();
  sim.commit([
    draft("AvatarCreated", { avatarId: "av", sovereignId: "pc", level: 5, worldId: "world:main" }, "player"),
    draft("ActorDied", { actorId: "pc", cause: "a lucky spear" }, "engine"),
  ]);
  expect(sim.state.actors.pc!.dead).toBeUndefined();
  expect(sim.state.actors.pc!.sheet.level).toBe("infinite");
});

test("a seal sets an effective level for resolution until it is broken", () => {
  const sim = campaign();
  sim.commit([draft("SealSet", { actorId: "pc", effectiveLevel: 5 }, "player")]);
  const sealed = sim.state.actors.pc!.sheet;
  expect(sealed.level).toBe("infinite");
  expect(sealed.effectiveLevel).toBe(5);
  expect(effectiveLevel(sealed)).toBe(5);
  expect(levelDelta(sealed, { level: 9 })).toBe(-4);

  sim.commit([draft("SealBroken", { actorId: "pc" }, "player")]);
  const unsealed = sim.state.actors.pc!.sheet;
  expect(unsealed.effectiveLevel).toBeUndefined();
  expect(effectiveLevel(unsealed)).toBe("infinite");
  expect(levelDelta(unsealed, { level: 9 })).toBe(Infinity);
});

test("ending a run with unsealed leaves the avatar alive", () => {
  const sim = campaign();
  sim.commit([
    draft("AvatarCreated", { avatarId: "av", sovereignId: "pc", level: 5, worldId: "world:main" }, "player"),
    draft("AvatarRunEnded", { avatarId: "av", reason: "unsealed" }, "player"),
  ]);
  expect(avatarRuns(sim.state)[0]?.status).toBe("ended");
  expect(avatarRuns(sim.state)[0]?.reason).toBe("unsealed");
  expect(sim.state.actors.av!.dead).toBeUndefined();
});

test("a sealed infinite actor rolls ordinary dice at the seal's effective Level", () => {
  const sim = campaign();
  sim.commit([draft("SealSet", { actorId: "pc", effectiveLevel: 5 }, "player")]);
  const out = unwrap(
    resolveCheck(
      sim.state,
      {
        actorId: "pc",
        skill: "core:stealth",
        difficulty: "normal",
        purpose: "slip past the guard while sealed",
        opposition: { level: 5 },
      },
      ctx,
    ),
  );
  const resolved = out.events.find((d) => d.type === "CheckResolved");
  expect(resolved?.type === "CheckResolved" ? resolved.payload.effective.rolls.length : 0).toBeGreaterThan(0);
});

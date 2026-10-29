import { expect, test } from "bun:test";
import { defaultTuning, draft, SceneState } from "@wyrd/core";
import {
  approvalEvents,
  companionBeats,
  draftFromArchetype,
  resolveTurn,
  sheetFromDraft,
  unwrap,
  validateTurn,
} from "@wyrd/engine";
import { creationContent } from "../src/content.ts";
import { Fight, pack } from "./combat/fixture.ts";

const content = creationContent([pack]);
/** Orla the innkeeper as a full sheet, the way the server builds one for a recruit. */
const recruitSheet = (f: Fight) => (id: string) =>
  id === "npc:orla"
    ? sheetFromDraft(
        id,
        draftFromArchetype(
          "fantasy-core:human",
          content.archetypes["fantasy-core:sellsword"]!,
          "Orla Tamsey",
        ),
        content,
        pack.items,
        f.state.campaign.settings,
        defaultTuning,
      )
    : null;

const turn = (f: Fight, actorId: string, actions: unknown[]) => {
  const v = validateTurn(f.state, actorId, actions, f.ctx);
  if (!v.ok) return v;
  const r = unwrap(resolveTurn(f.state, v.value, f.ctx, `combat-${f.events.length}`));
  f.commit(r.events);
  return { ok: true as const, resolution: r.resolution };
};

const newScene = (f: Fight, n: number) =>
  f.commit([
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: `scene:road-${n}`,
        locationId: "loc:road",
        zones: [{ id: "z:road", name: "the road" }],
        positions: { pc: "z:road", "npc:orla": "z:road" },
        openedAt: f.state.campaign.gameTime,
      }),
    }),
  ]);

test("a companion is recruited, fights, gains and loses approval from what they witness, and leaves at the threshold", () => {
  const f = new Fight({ seed: 3 });
  f.ctx = { ...f.ctx, recruitSheet: recruitSheet(f) };

  // Not willing yet: a stranger won't join.
  const refused = validateTurn(
    f.state,
    "pc",
    [{ type: "recruit", targetId: "npc:orla", reason: "x" }],
    f.ctx,
  );
  expect(refused.ok ? "" : refused.planErrors?.[0]?.code).toBe("NOT_WILLING");
  // A bond (as a backstory hook makes) is enough.
  f.commit([
    draft("RelationshipChanged", { edge: { from: "pc", to: "npc:orla", type: "friend", strength: 0.8 } }),
  ]);
  const joined = turn(f, "pc", [
    {
      type: "recruit",
      targetId: "npc:orla",
      reason: "Her inn is wrecked and she wants the bandits paid back.",
    },
  ]);
  expect(joined.ok).toBe(true);
  expect(f.state.party.companionIds).toEqual(["npc:orla"]);
  expect(f.state.actors["npc:orla"]!.role).toBe("companion");
  f.commit([
    draft("CompanionProfiled", {
      companionId: "npc:orla",
      profile: {
        values: ["hospitality"],
        likes: ["protecting guests"],
        dislikes: ["cruelty"],
        canBetray: false,
        personalQuest: { title: "Rebuild the Tamsey Arms", stages: ["Find the money", "Hire the builders"] },
      },
    }),
  ]);

  // She fights on the party's side and takes her own turns.
  turn(f, "pc", [{ type: "strike", targetId: "npc:mags" }]);
  const started = f.events.find((e) => e.type === "CombatStarted")!;
  expect(
    (started.payload as { combat: { combatants: Record<string, { side: string }> } }).combat.combatants[
      "npc:orla"
    ]?.side,
  ).toBe("party");
  for (let i = 0; i < 30 && f.state.combat; i++) {
    const foe = Object.values(f.state.combat.combatants).find(
      (c) => c.side === "enemy" && c.status === "active",
    );
    const done = foe ? turn(f, "pc", [{ type: "strike", targetId: foe.actorId }]) : { ok: false };
    if (!done.ok) turn(f, "pc", [{ type: "endTurn" }]);
  }
  const acted = f.events.some(
    (e) =>
      (e.type === "CheckResolved" || e.type === "HitResolved") &&
      (e.payload as { actorId?: string }).actorId === "npc:orla",
  );
  expect(acted).toBe(true);

  // Approval from what she witnesses: capped at ±10 an event and ±20 a scene.
  newScene(f, 1);
  const nameOf = f.ctx.nameOf;
  const up = (delta: number, reason: string) =>
    f.commit(approvalEvents(f.state, [{ companionId: "npc:orla", delta, reason }], nameOf, defaultTuning));
  up(15, "The PC stood between her guests and the bandits.");
  up(15, "The PC paid for the broken chairs.");
  up(15, "The PC bought a round.");
  expect(f.state.companions["npc:orla"]!.approval).toBe(20);
  // Someone who isn't there doesn't witness anything.
  f.commit([draft("EntityLeftScene", { entityId: "npc:orla", reason: "went ahead" })]);
  up(-10, "The PC kicked a beggar.");
  expect(f.state.companions["npc:orla"]!.approval).toBe(20);

  // Cruelty, scene after scene: a confrontation at −50, then she leaves at −75.
  for (let n = 2; n <= 5; n++) {
    newScene(f, n);
    up(-10, "The PC beat a surrendered bandit.");
    up(-10, "The PC laughed about it.");
  }
  expect(f.state.companions["npc:orla"]!.approval).toBe(-60);
  expect(f.state.companions["npc:orla"]!.confronted).toBe(true);
  expect(f.state.party.companionIds).toEqual(["npc:orla"]);
  const owed = companionBeats(f.state, nameOf);
  expect(owed.beats[0]).toContain("confronts");
  f.commit(owed.events);
  newScene(f, 6);
  up(-10, "The PC burned a farm.");
  up(-10, "The PC kept the stolen silver.");
  expect(f.state.party.companionIds).toEqual([]);
  expect(f.state.companions["npc:orla"]!.status).toBe("left");
  expect(f.state.actors["npc:orla"]!.role).toBe("npc");
  expect(companionBeats(f.state, nameOf).beats[0]).toContain("leaves the party");
  // The bond remains, but someone who walked out doesn't rejoin.
  const again = validateTurn(
    f.state,
    "pc",
    [{ type: "recruit", targetId: "npc:orla", reason: "please" }],
    f.ctx,
  );
  expect(again.ok ? "" : again.planErrors?.[0]?.code).toBe("LEFT_PARTY");
});

test("approval at +50 unlocks the companion's personal quest", () => {
  const f = new Fight({ seed: 3 });
  f.ctx = { ...f.ctx, recruitSheet: recruitSheet(f) };
  f.commit([
    draft("RelationshipChanged", { edge: { from: "npc:orla", to: "pc", type: "family", strength: 1 } }),
  ]);
  turn(f, "pc", [{ type: "recruit", targetId: "npc:orla", reason: "Family." }]);
  f.commit([
    draft("CompanionProfiled", {
      companionId: "npc:orla",
      profile: {
        values: ["family"],
        likes: [],
        dislikes: [],
        canBetray: true,
        personalQuest: { title: "Rebuild the Tamsey Arms", stages: ["Find the money", "Hire the builders"] },
      },
    }),
  ]);
  for (let n = 1; n <= 3; n++) {
    newScene(f, n);
    for (const reason of ["kind", "brave"])
      f.commit(
        approvalEvents(
          f.state,
          [{ companionId: "npc:orla", delta: 10, reason }],
          f.ctx.nameOf,
          defaultTuning,
        ),
      );
  }
  expect(f.state.companions["npc:orla"]!.approval).toBe(60);
  const quest = f.state.quests["quest:companion-orla"]!;
  expect(quest).toMatchObject({ title: "Rebuild the Tamsey Arms", kind: "companion", giverId: "npc:orla" });
  expect(companionBeats(f.state, f.ctx.nameOf).beats.join(" ")).toContain("Rebuild the Tamsey Arms");
});

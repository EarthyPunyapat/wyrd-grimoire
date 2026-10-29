import { describe, expect, test } from "bun:test";
import { draft, type Resolution, SceneState } from "@wyrd/core";
import { fold } from "../src/reduce.ts";
import { sceneWitnesses } from "../src/scene-perception.ts";
import { type SceneReactionContext, sceneReactions } from "../src/scene-reactions.ts";
import { attrs } from "./fixtures.ts";
import { ctx as rules, Sim } from "./sim.ts";

const names: Record<string, string> = { pc: "Ash", victim: "Tamsin", host: "Ilsa", visitor: "Rook" };
const context = (profiles: Record<string, string> = {}): SceneReactionContext => ({
  ...rules,
  items: { weapons: {}, armor: {}, gear: {} },
  bodyPlans: {},
  creatures: {},
  nameOf: (id) => names[id] ?? id,
  combatInfo: (id) => ({ canFight: id !== "table" }),
  kindOf: (id) => (id === "table" ? "item" : "npc"),
  reactionInfo: (id) => ({ temperament: profiles[id] ?? "assertive", speechStyle: "plain and direct" }),
});

function parlor() {
  const s = new Sim({}, "parlor");
  s.addActor("pc", "pc", { attributes: attrs({ str: 2, agi: 2 }) });
  s.addActor("victim", "npc");
  s.commit([
    draft("SceneOpened", {
      scene: SceneState.parse({
        id: "parlor",
        locationId: "parlor",
        openedAt: 0,
        zones: [
          { id: "room", name: "Parlor" },
          { id: "exit", name: "Doorway", tags: ["exit"] },
          { id: "closed", name: "Closed office" },
        ],
        edges: [
          { a: "room", b: "exit" },
          { a: "room", b: "closed", blocksSight: true },
        ],
        positions: {
          pc: "room",
          victim: "room",
          host: "room",
          visitor: "room",
          absent: "closed",
          table: "room",
        },
      }),
    }),
  ]);
  return s;
}

function assault(round: number): Resolution {
  return {
    actorId: "pc",
    steps: [
      {
        index: 0,
        actorId: "pc",
        action: { type: "strike", targetId: "victim" },
        outcome: "failure",
        summary: "Ash misses.",
        witnessIds: ["victim", "host", "visitor"],
      },
    ],
    requiredBeats: ["Ash misses."],
    forbidden: [],
    minutes: 0,
    combat: { round },
  };
}

function react(s: Sim, round = 1, profiles: Record<string, string> = {}) {
  const r = sceneReactions(s.state, assault(round), context(profiles), "incident");
  s.commit(r.events);
  return r;
}

describe("scene reactions", () => {
  test("a missed attack gets victim speech and one salient witness, with lasting hostility", () => {
    const s = parlor();
    const r = react(s);
    expect(r.responses.map((x) => x.actorId)).toEqual(["victim", "host"]);
    expect(r.responses.every((x) => x.utterance.length > 0)).toBe(true);
    expect(s.state.minds.victim!.dispositions.pc!.attitude).toBeLessThan(0);
    expect(s.state.minds.host!.memories.some((m) => m.response)).toBe(true);
    expect(s.state.minds.absent).toBeUndefined();
    expect(s.state.minds.table).toBeUndefined();
  });

  test("the same incident/round cannot apply a reaction twice, even though game time is zero", () => {
    const s = parlor();
    react(s);
    const before = JSON.stringify(s.state);
    const r = react(s);
    expect(r.events).toHaveLength(0);
    expect(r.responses).toHaveLength(0);
    expect(JSON.stringify(s.state)).toBe(before);
    expect(react(s, 2).responses.some((x) => x.kind === "callForHelp")).toBe(true);
    expect(s.state.campaign.gameTime).toBe(0);
  });

  test("cautious and protective witnesses respond differently; retreat uses a legal edge", () => {
    const cautious = parlor();
    const r = react(cautious, 1, { host: "cautious" });
    expect(r.responses.find((x) => x.actorId === "host")!.kind).toBe("withdraw");
    expect(cautious.state.scene!.positions.host).toBe("exit");
    const protective = react(parlor(), 1, { host: "protective" });
    expect(protective.responses.find((x) => x.actorId === "host")!.kind).toBe("protest");
  });

  test("only a present perceiving person can witness an incident", () => {
    const s = parlor();
    s.addActor("sleeping", "npc");
    const asleep = s.state.actors.sleeping!;
    s.state = {
      ...s.state,
      actors: {
        ...s.state.actors,
        sleeping: {
          ...asleep,
          sheet: {
            ...asleep.sheet,
            status: { ...asleep.sheet.status, conditions: [{ id: "core:unconscious" }] },
          },
        },
      },
      scene: { ...s.state.scene!, positions: { ...s.state.scene!.positions, sleeping: "room" } },
    };
    expect(sceneWitnesses(s.state, "pc", "victim", context())).toEqual(["host", "victim", "visitor"]);
  });

  test("an unconscious victim cannot speak, and companion approval is left to M6", () => {
    const s = parlor();
    const victim = s.state.actors.victim!;
    s.state = {
      ...s.state,
      party: { ...s.state.party, companionIds: ["host"] },
      actors: {
        ...s.state.actors,
        victim: {
          ...victim,
          sheet: {
            ...victim.sheet,
            status: { ...victim.sheet.status, conditions: [{ id: "core:unconscious" }] },
          },
        },
      },
    };
    const r = react(s);
    expect(r.responses.some((x) => x.actorId === "victim" || x.actorId === "host")).toBe(false);
    expect(s.state.minds.host).toBeUndefined();
  });

  test("a call for help identifies an established recipient and never spawns a guard", () => {
    const s = parlor();
    react(s);
    const r = react(s, 2);
    const call = r.responses.find((x) => x.kind === "callForHelp")!;
    expect(call.recipientId).toBeDefined();
    expect(s.state.scene!.positions[call.recipientId!]).toBeDefined();
    expect(r.events.some((e) => e.type === "ActorCreated" || e.type === "EntityCreated")).toBe(false);
  });

  test("response events survive replay and observation never invents a hit", () => {
    const s = parlor();
    const hp = s.state.actors.victim!.sheet.status.hp;
    react(s);
    react(s, 2);
    expect(fold(s.events)).toEqual(s.state);
    expect(s.state.actors.victim!.sheet.status.hp).toBe(hp);
    expect(s.state.minds.victim!.memories[0]!.content).toContain("attempted");
  });

  test("a rejected persuasion gets a refusal rather than echoing the player's speech", () => {
    const s = parlor();
    const res: Resolution = {
      actorId: "pc",
      steps: [
        {
          index: 0,
          action: {
            type: "talk",
            targetId: "victim",
            utterance: "Stake your freedom on chess",
            approach: "persuade",
          },
          outcome: "failure",
          summary: "The persuasion fails.",
        },
      ],
      requiredBeats: [],
      forbidden: [],
      minutes: 1,
    };
    const r = sceneReactions(s.state, res, context(), "conversation");
    expect(r.responses[0]!.kind).toBe("refuse");
    expect(r.responses[0]!.utterance).not.toContain("Stake your freedom");
  });
});

// Enrollment stays separate from companion control and spends initiative rather than granting a strike.
test("a persistent protective witness joins the victim's side without a free attack", async () => {
  const { Combatant, CombatState } = await import("@wyrd/core");
  const s = parlor();
  s.commit([
    draft("CombatStarted", {
      combat: CombatState.parse({
        id: "incident",
        round: 1,
        turn: 1,
        order: ["victim", "pc"],
        intent: "driveOff",
        combatants: {
          victim: Combatant.parse({ actorId: "victim", side: "enemy", group: "victim", initiative: 300 }),
          pc: Combatant.parse({
            actorId: "pc",
            side: "party",
            group: "party",
            initiative: 200,
            controlled: true,
            ap: 3,
          }),
        },
      }),
    }),
  ]);
  react(s, 1, { host: "protective" });
  react(s, 2, { host: "protective" });
  const beforeHp = s.state.actors.pc!.sheet.status.hp;
  const r = react(s, 3, { host: "protective" });
  expect(r.responses.find((x) => x.actorId === "host")?.kind).toBe("intervene");
  expect(s.state.combat!.combatants.host!.side).toBe("enemy");
  expect(s.state.combat!.combatants.host!.ap).toBe(0);
  expect(s.state.combat!.order[s.state.combat!.turn]).toBe("pc");
  expect(s.state.actors.pc!.sheet.status.hp).toBe(beforeHp);
  expect(r.events.some((e) => e.type === "HpChanged")).toBe(false);
  expect(fold(s.events)).toEqual(s.state);
});

test("a blocked or restrained witness cannot be narrated as retreating", () => {
  const s = parlor();
  s.addActor("host", "npc");
  const host = s.state.actors.host!;
  s.state = {
    ...s.state,
    actors: {
      ...s.state.actors,
      host: {
        ...host,
        sheet: { ...host.sheet, status: { ...host.sheet.status, conditions: [{ id: "core:restrained" }] } },
      },
    },
  };
  const r = react(s, 1, { host: "cautious" });
  expect(s.state.scene!.positions.host).toBe("room");
  expect(r.responses.find((x) => x.actorId === "host")?.summary).toContain("no legal route");
  expect(r.events.some((e) => e.type === "EntityMoved")).toBe(false);
});

test("a frightened civilian attempts escape on a normal turn without being marked fled in advance", async () => {
  const { Combatant, CombatState } = await import("@wyrd/core");
  const { sceneActions } = await import("../src/scene-tactics.ts");
  const s = parlor();
  s.commit([
    draft("CombatStarted", {
      combat: CombatState.parse({
        id: "incident",
        round: 1,
        turn: 0,
        order: ["victim", "pc"],
        intent: "driveOff",
        combatants: {
          victim: Combatant.parse({ actorId: "victim", side: "enemy", group: "victim", ap: 3 }),
          pc: Combatant.parse({ actorId: "pc", side: "party", group: "party", controlled: true }),
        },
      }),
    }),
  ]);
  for (const round of [1, 2, 3]) react(s, round, { victim: "cautious" });
  const before = JSON.stringify(s.state);
  expect(sceneActions(s.state, "victim", context())).toContainEqual({ type: "move", toZoneId: "exit" });
  expect(JSON.stringify(s.state)).toBe(before);
  expect(s.state.combat!.combatants.victim!.status).toBe("active");
  expect(s.state.combat!.combatants.victim!.fleeing).toBe(false);
});

test("a creature is not given human dialogue, and a silent witness can still retreat", () => {
  const s = parlor();
  const c = context({ host: "cautious" });
  const r = sceneReactions(
    s.state,
    assault(1),
    {
      ...c,
      kindOf: (id) => (id === "victim" ? "creature" : "npc"),
      reactionInfo: (id) => ({
        temperament: id === "host" ? "cautious" : "assertive",
        ...(id === "host" ? { canSpeak: false } : {}),
      }),
    },
    "incident",
  );
  s.commit(r.events);
  expect(r.responses.every((x) => x.utterance === "")).toBe(true);
  expect(s.state.scene!.positions.host).toBe("exit");
});

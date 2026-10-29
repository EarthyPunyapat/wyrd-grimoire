import { afterEach, expect, test } from "bun:test";
import { CharacterSheet, draft, Entity } from "@wyrd/core";
import { catalogWith, companionBond, delegationTasks, unwrap } from "@wyrd/engine";
import { FakeProvider } from "../src/fake.ts";
import { executeTool } from "../src/gm/tools.ts";
import { makeTurnContext, TurnPipeline } from "../src/pipeline.ts";
import { RoleRouter } from "../src/router.ts";
import { gmFixture, rules } from "./gm-fixture.ts";

const fixtures: ReturnType<typeof gmFixture>[] = [];
afterEach(() => {
  for (const fx of fixtures.splice(0)) fx.close();
});
function setup() {
  const fx = gmFixture();
  fixtures.push(fx);
  const sheet = CharacterSheet.parse({
    ...fx.store.state().actors.pc!.sheet,
    id: "ari",
    level: 20,
    identity: { name: "Ari", ancestry: "fantasy-core:human" },
  });
  fx.store.append([
    draft("EntityCreated", { entity: Entity.parse({ id: "ari", name: "Ari", kind: "npc", detail: "full" }) }),
    draft("CompanionJoined", { companionId: "ari", reason: "A lasting bond", sheet }),
  ]);
  fx.store.append(
    unwrap(
      companionBond(fx.store.state(), "ari", {
        loyal: true,
        voiceProfile: "Warm, precise, candid. Address Ethan by name.",
      }),
    ),
  );
  let n = 0;
  const run = async (name: string, args: unknown) => {
    const state = fx.store.state();
    const r = await executeTool(
      { id: `call-${++n}`, name, args },
      {
        state,
        pcId: "pc",
        turnId: "t",
        canon: fx.canon,
        ctx: makeTurnContext(state, fx.canon, rules),
        items: catalogWith(state, { weapons: {}, armor: {}, gear: {} }),
        newId: () => `task-${++n}`,
      },
    );
    fx.store.append(r.effects.drafts);
    return r;
  };
  return { fx, run };
}

test("delegate creates a replayable task, and a time advance returns a report card", async () => {
  const { fx, run } = setup();
  const now = fx.store.state().campaign.gameTime;
  expect(
    (
      await run("delegate", {
        assignee: "ari",
        goal: "Inspect the beacon",
        due: now + 60,
        opposition: { level: 18 },
      })
    ).ok,
  ).toBe(true);
  const r = await run("time_skip", { minutes: 60, reason: "Let Ari work" });
  expect(r.ok).toBe(true);
  expect(r.effects.cards[0]?.type).toBe("report");
  expect(r.result).toContain("Completed");
  expect(r.result).not.toContain("smuggles relics");
  expect(delegationTasks(fx.store.state())[0]?.status).toBe("done");
  const state = fx.store.state();
  fx.store.rebuild();
  expect(fx.store.state()).toEqual(state);
});

test("an impossible task interrupts the existing skip at its boundary", async () => {
  const { fx, run } = setup();
  const now = fx.store.state().campaign.gameTime;
  await run("delegate", {
    assignee: "ari",
    goal: "Open the sealed gate",
    due: now + 60,
    opposition: { level: 22 },
  });
  const r = await run("time_skip", { minutes: 180, reason: "Wait" });
  expect(r.ok).toBe(true);
  expect(JSON.parse(r.result).interrupted).toBe(true);
  expect(fx.store.state().campaign.gameTime).toBe(now + 60);
  expect(r.effects.cards[0]).toMatchObject({ type: "report", title: "Delegation needs you" });
});

test("voice and loyalty reach the GM prompt; task reports persist in actual GM turns", async () => {
  const { fx } = setup();
  let ids = 0;
  const fake = new FakeProvider([
    {
      role: "gm",
      reply: (req) => {
        const count = req.messages.filter((m) => m.role === "tool").length;
        if (count === 0)
          return {
            toolCall: {
              name: "delegate",
              args: { assignee: "ari", goal: "Inspect the beacon", due: 60, opposition: { level: 18 } },
            },
          };
        if (count === 1) return { toolCall: { name: "time_skip", args: { minutes: 60, reason: "Wait" } } };
        return { text: '<say who="ari">The beacon is secure, Ethan.</say>' };
      },
    },
  ]);
  const router = new RoleRouter({
    providers: { fake },
    routing: { gm: { provider: "fake", model: "test", fallbacks: [] } },
  });
  const pipeline = new TurnPipeline({
    store: fx.store,
    canon: fx.canon,
    router,
    rules,
    tone: "",
    worldBible: "",
    newId: () => `id-${++ids}`,
  });
  await pipeline.run({ input: "Ari, check the beacon. I'll wait." });
  const first = fake.calls("gm")[0]!;
  expect(first.messages[0]!.content).toContain("Warm, precise, candid");
  expect(first.messages[0]!.content).toContain("loyal");
  expect(first.messages[0]!.content).not.toContain("smuggles relics");
  const completed = fx.store.events().find((e) => e.type === "TurnCompleted");
  expect(completed?.payload.gm?.cards.some((c) => c.type === "report")).toBe(true);
});

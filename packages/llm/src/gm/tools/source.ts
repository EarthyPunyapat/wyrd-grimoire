import { draft, worldOf } from "@wyrd/core";
import { z } from "zod";
import { registerGmTool } from "../registry.ts";

registerGmTool({
  name: "intervene_canon",
  description:
    "Record that the player's already-committed intervention fact averts a pending canon clock. Cite an existing committed or earlier-in-this-turn intervention fact id about the clock's subject; never cancel canon just because it is inconvenient.",
  schema: z.object({ clockId: z.string().min(1), factId: z.string().min(1) }),
  run: (a, x) => {
    const clock = x.state.clocks[a.clockId];
    if (
      clock?.kind !== "canon" ||
      !clock.canon ||
      (x.state.flags.canonResults as Record<string, unknown> | undefined)?.[a.clockId]
    )
      return { ok: false, body: { errors: "No pending canon clock" } };
    const subject = clock.canon.intervention?.entityId ?? clock.canon.outcome.entityId;
    const pending = x.pendingDrafts ?? [];
    const candidates = [
      ...x.canon.factsAbout(subject, { includeSecret: true }),
      ...pending.flatMap((e) => (e.type === "FactAsserted" ? [e.payload.fact] : [])),
    ];
    const fact = candidates.find(
      (f) =>
        f.id === a.factId &&
        worldOf(f) === worldOf(clock) &&
        f.value !== false &&
        !f.retracted &&
        !f.supersededBy &&
        (f.source === "player" || f.source === "engine" || f.source === "model") &&
        f.entityId === subject &&
        (!clock.canon!.intervention || f.predicate === clock.canon!.intervention.predicate) &&
        !pending.some(
          (e) =>
            (e.type === "FactRetracted" && e.payload.factId === f.id) ||
            (e.type === "FactSuperseded" && e.payload.oldFactId === f.id),
        ),
    );
    if (!fact)
      return {
        ok: false,
        body: {
          errors: "Cite a current intervention fact matching this clock's subject and intervention predicate",
        },
      };
    return {
      ok: true,
      body: { averted: clock.name },
      effects: { drafts: [draft("CanonClockIntervened", a)] },
    };
  },
});

registerGmTool({
  name: "source_timeline",
  description:
    "Read the source campaign's behind-the-screen canon clocks, intervention predicates, outcomes and character autonomy. Use these to stay in character and recognise player interventions. Never reveal future events, off-screen actions or facts the PC has not learned in narration.",
  schema: z.object({}),
  run: (_a, x) => ({
    ok: true,
    body: {
      worlds: x.state.worlds,
      clocks: Object.values(x.state.clocks).filter((c) => c.kind === "canon"),
      results: x.state.flags.canonResults ?? {},
      characters: x.state.flags.canonActors ?? {},
    },
  }),
});

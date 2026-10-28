import { FakeProvider, type FakeReply } from "./fake.ts";
import type { GenerateRequest } from "./types.ts";

/**
 * An offline stand-in for every text role, for trying the loop without API keys. It's a
 * FakeProvider with simple keyword parsing: good enough to walk around, look and talk, nothing
 * more. Real play needs real models.
 */
export function offlineProvider(): FakeProvider {
  return new FakeProvider(
    [
      { role: "parser", match: (r) => r.tools !== undefined, reply: parse },
      {
        role: "parser",
        reply: {
          text: "(offline mode can't answer questions; see docs/spec/02-rules-core.md for the rules)",
        },
      },
      { role: "narrator", reply: narrate },
      { role: "guard", reply: { toolCall: { name: "report_canon", args: {} } } },
    ],
    "offline",
  );
}

const context = (r: GenerateRequest) => {
  const first = r.messages[0];
  return first && first.role === "user" ? first.content : "";
};

/** `name [id]` pairs listed in the parser's context. */
function listed(ctx: string, prefix: string): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  for (const m of ctx.matchAll(/([A-Za-z][\w' -]*?) \[([a-z]+:[a-z0-9-]+)\]/g)) {
    const id = m[2]!;
    if (id.startsWith(prefix) && !out.some((o) => o.id === id))
      out.push({ id, name: m[1]!.trim().replace(/^the /i, "") });
  }
  return out;
}

function parse(r: GenerateRequest): FakeReply {
  const ctx = context(r);
  const input = (/## This turn\n\nPlayer: (.*)/.exec(ctx)?.[1] ?? "").trim();
  const lower = input.toLowerCase();
  const find = (prefix: string) => listed(ctx, prefix).find((x) => lower.includes(x.name.toLowerCase()));
  const act = (actions: unknown[]) => ({
    toolCall: { name: "propose_actions", args: { actions, intent: input } },
  });

  if (/^\(|\?\)$|^ooc\b/.test(lower)) {
    return { toolCall: { name: "answer_ooc", args: { topic: "other", question: input } } };
  }
  const said = /"([^"]+)"/.exec(input)?.[1];
  if (said) {
    const who = find("npc:") ?? listed(ctx, "npc:")[0];
    if (who) return act([{ type: "talk", targetId: who.id, utterance: said, approach: "neutral" }]);
  }
  const wait = /\bwait(?:\s+(\d+))?/.exec(lower);
  if (wait) return act([{ type: "wait", minutes: Number(wait[1] ?? 10) }]);
  if (/\b(go|walk|head|move|run|climb)\b/.test(lower)) {
    const zone = find("z:");
    if (zone) return act([{ type: "move", toZoneId: zone.id }]);
  }
  if (/\bsearch\b/.test(lower)) {
    const t = find("prop:") ?? find("item:");
    return act([t ? { type: "search", targetId: t.id } : { type: "search", area: "the area" }]);
  }
  if (/\b(sneak|hide|creep)\b/.test(lower)) {
    return act([
      {
        type: "check",
        skill: "stealth",
        goal: input,
        proposedDifficulty: "normal",
        reason: "someone might notice",
      },
    ]);
  }
  const target = find("npc:") ?? find("prop:") ?? find("item:");
  return act([
    target ? { type: "examine", targetId: target.id } : { type: "examine", area: "the surroundings" },
  ]);
}

function narrate(r: GenerateRequest): FakeReply {
  const ctx = context(r);
  const beats = /Required beats \(mention every one\):\n((?:- .*\n?)+)/.exec(ctx)?.[1] ?? "";
  const text = beats
    .split("\n")
    .map((l) => l.replace(/^- /, "").trim())
    .filter(Boolean)
    .join(" ");
  return { text: `(offline narrator) ${text || "Nothing much happens."}` };
}

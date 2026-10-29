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

/** `Name [spell:id] (tier …)` lines the parser prompt lists for spellcasting. */
function spellsListed(ctx: string): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  for (const m of ctx.matchAll(/^- (.+?) \[([a-z0-9-]+:[a-z0-9-]+)\] \(tier /gm))
    out.push({ id: m[2]!, name: m[1]!.trim() });
  return out;
}

function parse(r: GenerateRequest): FakeReply {
  const ctx = context(r);
  const input = (/## This turn\n\n(?:[\s\S]*?\n)?Player: (.*)/.exec(ctx)?.[1] ?? "").trim();
  const lower = input.toLowerCase();
  const find = (prefix: string) => listed(ctx, prefix).find((x) => lower.includes(x.name.toLowerCase()));
  const act = (actions: unknown[]) => ({
    toolCall: { name: "propose_actions", args: { actions, intent: input } },
  });

  const inCombat = JSON.stringify(r.tools ?? []).includes("takeCover");
  if (inCombat) {
    const actions = combatClauses(input, ctx);
    if (actions.length) return act(actions);
  }
  if (!inCombat && /\b(travel|journey|ride|set out|make for)\b/.test(lower)) {
    const site = find("site:");
    if (site) return act([{ type: "travel", toSiteId: site.id, pace: "normal" }]);
  }
  if (!inCombat && /\b(join me|come with me|come along|travel with me|join (?:us|the party))\b/.test(lower)) {
    const who = find("npc:");
    if (who)
      return act([
        { type: "recruit", targetId: who.id, reason: `Asked to come along: ${input}`.slice(0, 300) },
      ]);
  }
  if (!inCombat && /\b(cast|spell)\b/.test(lower)) {
    const spell = spellsListed(ctx).find((s) => lower.includes(s.name.toLowerCase()));
    if (spell) {
      const who = find("npc:");
      return act([{ type: "cast", spell: spell.id, targetIds: who ? [who.id] : [] }]);
    }
  }
  if (!inCombat && ATTACK.test(lower)) {
    const who = find("npc:");
    if (who) return act([{ type: "strike", targetId: who.id }]);
  }
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

const ATTACK = /\b(attack|hit|strike|stab|slash|punch|shoot|fire at|loose at|swing at|kill)\b/;

/** Offline combat parsing: split on commas and "then"/"and", one action per clause (spec 03 free text). */
function combatClauses(input: string, ctx: string): unknown[] {
  const out: unknown[] = [];
  for (const clause of input
    .split(/,|\bthen\b|\band\b/i)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)) {
    const find = (prefix: string) => listed(ctx, prefix).find((x) => clause.includes(x.name.toLowerCase()));
    const npc = find("npc:");
    const prop = find("prop:");
    if (/\b(kick|topple|flip|overturn|tip|knock)\b.*\b(table|bench|counter)/.test(clause))
      out.push({
        type: "stunt",
        effect: "createCover",
        ...(prop ? { propId: prop.id } : {}),
        description: clause,
      });
    else if (/\b(duck|cover|crouch|hide behind|get behind)\b/.test(clause))
      out.push({ type: "takeCover", ...(prop ? { propId: prop.id } : {}) });
    else if (/\baim\b/.test(clause)) out.push({ type: "aim", ...(npc ? { targetId: npc.id } : {}) });
    else if (ATTACK.test(clause) && npc) out.push({ type: "strike", targetId: npc.id });
    else if (/\b(close in|charge|engage|rush)\b/.test(clause) && npc)
      out.push({ type: "engage", targetId: npc.id });
    else if (/\b(defend|parry|block|brace|guard)\b/.test(clause)) out.push({ type: "defend" });
    else if (/\breload\b/.test(clause)) out.push({ type: "reload" });
    else if (/\b(surrender|yield|give up)\b/.test(clause)) out.push({ type: "surrender" });
    else if (/\b(flee|run away|escape)\b/.test(clause)) out.push({ type: "flee" });
    else if (/\b(disengage|back off|step back)\b/.test(clause)) out.push({ type: "disengage" });
    else if (/\b(get up|stand up|stand)\b/.test(clause)) out.push({ type: "standUp" });
    else if (/\b(bandage|first aid|bind)\b/.test(clause))
      out.push({ type: "firstAid", targetId: npc?.id ?? "pc" });
    else if (/\b(go|move|run|head)\b/.test(clause)) {
      const zone = find("z:");
      if (zone) out.push({ type: "move", toZoneId: zone.id });
    } else if (/\b(wait|hold)\b/.test(clause)) out.push({ type: "endTurn" });
  }
  return out;
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

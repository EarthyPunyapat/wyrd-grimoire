import type { CampaignSettings, Entity, Fact, Resolution } from "@wyrd/core";
import { type GameState, type RulesContext, skillLabel, skillValue } from "@wyrd/engine";

/** What the assembler reads from canon. `CanonQueries` from storage satisfies it. */
export interface CanonSource {
  entity(id: string): Entity | null;
  factsAbout(entityId: string, opts?: { includeSecret?: boolean }): Fact[];
  findByName(name: string): Entity[];
  recentTurns(limit: number): Array<{ input: string; narration: string | null; status: string | null }>;
}

export type AssemblerRole = "parser" | "narrator" | "guard";

/** Token budgets per role (spec 07). Estimated at 4 characters per token. */
export const ROLE_BUDGETS: Record<AssemblerRole, number> = { parser: 8_000, narrator: 24_000, guard: 12_000 };
const MIN_TURNS: Record<AssemblerRole, number> = { parser: 4, narrator: 6, guard: 2 };
const MAX_TURNS: Record<AssemblerRole, number> = { parser: 4, narrator: 20, guard: 4 };

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export type StableInputs = {
  /** Section 1: the role's instructions and output contract (from llm/prompts). */
  roleInstructions: string;
  /** Section 2: rules digest for the current mode. */
  rulesDigest: string;
  /** Section 3: the pack's tone.md. */
  tone: string;
  /** Section 4: world bible summary (hand-authored worlds provide a premise). */
  worldBible: string;
};

export type TurnInputs = {
  input: string;
  resolution?: Resolution;
  /** Guard only: the draft narration to check. */
  draft?: string;
  /** Narrator only: corrective notes after a blocked first draft. */
  corrections?: string[];
};

export type Section = { n: number; title: string; text: string };

export type AssembledPrompt = {
  /** Sections 1–4: byte-identical across turns while their inputs don't change (prompt-cache contract). */
  instructions: string;
  /** Sections 6–13 as one user message. */
  context: string;
  sections: Section[];
  tokens: number;
  budget: number;
};

const join = (sections: Section[]) => sections.map((s) => `## ${s.title}\n\n${s.text.trim()}`).join("\n\n");

/** Section 1's shared tail: content dials, lines and veils, language. */
export function contentRules(s: CampaignSettings): string {
  const c = s.content;
  const lines = [
    `Violence: ${c.violence}. Horror: ${c.horror}. Romance: ${c.romance === "off" ? "none" : "fade to black at most"}. Language: ${c.language}.`,
    c.lines.length ? `Lines (never include, in any form): ${c.lines.join("; ")}.` : "Lines: none set.",
    c.veils.length
      ? `Veils (may happen only off-screen; cut away): ${c.veils.join("; ")}.`
      : "Veils: none set.",
    `Write in ${s.narration.language}, ${s.narration.person} person, present tense. Length: ${s.narration.length}.`,
  ];
  return lines.join("\n");
}

function clock(gameTime: number): string {
  const day = Math.floor(gameTime / 1440) + 1;
  const m = gameTime % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  const part =
    m < 300 ? "night" : m < 720 ? "morning" : m < 1020 ? "afternoon" : m < 1260 ? "evening" : "night";
  return `Day ${day}, ${hh}:${mm} (${part})`;
}

export type AssembleOptions = {
  role: AssemblerRole;
  state: GameState;
  canon: CanonSource;
  rules: RulesContext;
  stable: StableInputs;
  turn: TurnInputs;
  /** Overrides the role's default budget. */
  budget?: number;
};

/**
 * Builds a role's prompt from sections in priority order (spec 07, "Context assembler"), within
 * the role's budget. v1 covers sections 1–4, 6–8, 12 and 13; retrieval and summaries come in M5.
 * Narrator context only carries public facts; the guard also sees secrets, to catch leaks.
 */
export function assemble(o: AssembleOptions): AssembledPrompt {
  const { state, canon, role } = o;
  const withIds = role !== "narrator";
  const label = (id: string, name: string) => (withIds ? `${name} [${id}]` : name);

  const instructions = join([
    {
      n: 1,
      title: "Role",
      text: `${o.stable.roleInstructions.trim()}\n\n${contentRules(state.campaign.settings)}`,
    },
    { n: 2, title: "Rules", text: o.stable.rulesDigest },
    { n: 3, title: "Tone", text: o.stable.tone || "(no tone guide)" },
    { n: 4, title: "World", text: o.stable.worldBible || "(no world bible yet)" },
  ]);

  // 6. PC and party, compact.
  const party = [state.party.pcId, ...state.party.companionIds].filter((x): x is string => !!x);
  const partyText = party
    .map((id) => {
      const a = state.actors[id];
      if (!a) return null;
      const sh = a.sheet;
      const top = Object.keys(sh.skills)
        .map((sk) => {
          try {
            return {
              name: skillLabel(sk, o.rules.skills),
              v: skillValue(sh, sk, o.rules.skills, o.rules.tuning),
            };
          } catch {
            return null;
          }
        })
        .filter((x): x is { name: string; v: number } => x !== null)
        .sort((a, b) => b.v - a.v)
        .slice(0, 5)
        .map((x) => (role === "narrator" ? x.name : `${x.name} ${x.v}%`));
      const conditions = sh.status.conditions.map((c) => c.id.split(":")[1] + (c.level ? ` ${c.level}` : ""));
      const hurt =
        sh.status.hp < sh.derived.hpMax
          ? sh.status.hp <= sh.derived.hpMax / 2
            ? "badly hurt"
            : "hurt"
          : "unhurt";
      return [
        `- ${label(id, sh.identity.name)} (${a.role}${sh.identity.pronouns ? `, ${sh.identity.pronouns}` : ""}): ${sh.identity.ancestry.split(":")[1]}, ${hurt}`,
        conditions.length ? `  conditions: ${conditions.join(", ")}` : null,
        top.length ? `  good at: ${top.join(", ")}` : null,
        sh.identity.appearance.build || sh.identity.appearance.hair
          ? `  looks: ${[sh.identity.appearance.build, sh.identity.appearance.hair, sh.identity.appearance.clothingStyle].filter(Boolean).join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");

  // 7. Scene.
  const scene = state.scene;
  const nameOf = (id: string) => state.actors[id]?.sheet.identity.name ?? canon.entity(id)?.name ?? id;
  const sceneFull = (detailed: boolean) => {
    if (!scene) return "No scene is open.";
    const loc = canon.entity(scene.locationId);
    const lines = [
      `${label(scene.locationId, loc?.name ?? scene.locationId)}${loc?.summary ? `: ${loc.summary}` : ""}`,
      `${clock(state.campaign.gameTime)}. Light: ${scene.light}.${scene.weather ? ` Weather: ${scene.weather}.` : ""}`,
      "Places:",
    ];
    for (const z of scene.zones) {
      const who = Object.entries(scene.positions)
        .filter(([, zone]) => zone === z.id)
        .map(([id]) => label(id, nameOf(id)));
      const props =
        detailed && z.props.length ? ` Props: ${z.props.map((p) => label(p.id, p.name)).join(", ")}.` : "";
      const tags = detailed && z.tags.length ? ` (${z.tags.join(", ")})` : "";
      lines.push(`- ${label(z.id, z.name)}${tags}: ${who.length ? who.join(", ") : "nobody"}.${props}`);
    }
    if (detailed) {
      const zone = (id: string) => label(id, scene.zones.find((z) => z.id === id)?.name ?? id);
      const exits = scene.edges.map(
        (e) => `${zone(e.a)} ↔ ${zone(e.b)}${e.requires ? ` (needs ${e.requires})` : ""}`,
      );
      if (exits.length) lines.push(`Ways between places: ${exits.join("; ")}.`);
    }
    return lines.join("\n");
  };

  // 8. Focus entities: everyone and everything present, plus anything named in the input or resolution.
  const focusIds = new Set<string>();
  if (scene) for (const id of Object.keys(scene.positions)) if (!state.actors[id]) focusIds.add(id);
  const mentionText = `${o.turn.input} ${o.turn.resolution?.requiredBeats.join(" ") ?? ""}`;
  for (const word of mentionText.match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)?\b/g) ?? []) {
    for (const e of canon.findByName(word)) focusIds.add(e.id);
  }
  const focusText = [...focusIds]
    .map((id) => canon.entity(id))
    .filter((e): e is Entity => e !== null)
    .map((e) => {
      const facts = canon.factsAbout(e.id, { includeSecret: role === "guard" });
      const factLines = facts.map(
        (f) =>
          `  - ${role === "guard" ? `[${f.id}] ` : ""}${f.predicate}: ${typeof f.value === "string" ? f.value : JSON.stringify(f.value)}${f.visibility === "secret" ? " (SECRET: the PC doesn't know this)" : ""}`,
      );
      return [`- ${label(e.id, e.name)} (${e.kind})${e.summary ? `: ${e.summary}` : ""}`, ...factLines].join(
        "\n",
      );
    })
    .join("\n");

  // 13. This turn.
  const thisTurn = [`Player: ${o.turn.input}`];
  if (o.turn.resolution) {
    const r = o.turn.resolution;
    thisTurn.push(
      "What happened (resolved by the engine; this is fixed):",
      ...r.steps.map((s) => `- ${s.summary}`),
      ...(r.stoppedAt !== undefined ? [`- The plan stopped at action ${r.stoppedAt + 1}.`] : []),
      "Required beats (mention every one):",
      ...r.requiredBeats.map((b) => `- ${b}`),
    );
    if (r.forbidden.length) thisTurn.push("Do not reveal or decide:", ...r.forbidden.map((f) => `- ${f}`));
  }
  if (o.turn.corrections?.length)
    thisTurn.push("Fix these problems from your last draft:", ...o.turn.corrections.map((c) => `- ${c}`));
  if (o.turn.draft !== undefined) thisTurn.push("Draft narration to check:", o.turn.draft);

  // 12. Recent turns, verbatim; trimmed oldest-first down to the role's minimum.
  const turns = canon.recentTurns(MAX_TURNS[role]).filter((t) => t.status !== null);
  const turnText = (n: number) =>
    turns
      .slice(-n)
      .map((t) => `Player: ${t.input}${t.narration ? `\nNarration: ${t.narration}` : ""}`)
      .join("\n\n");

  const budget = o.budget ?? ROLE_BUDGETS[role];
  let nTurns = turns.length;
  let detailedScene = true;
  const build = (): Section[] => [
    { n: 6, title: "Party", text: partyText || "(no party)" },
    { n: 7, title: "Scene", text: sceneFull(detailedScene) },
    { n: 8, title: "Who and what is here", text: focusText || "(nothing notable)" },
    ...(nTurns > 0 ? [{ n: 12, title: "Recent turns", text: turnText(nTurns) }] : []),
    { n: 13, title: "This turn", text: thisTurn.join("\n") },
  ];
  const total = (secs: Section[]) => estimateTokens(instructions) + estimateTokens(join(secs));
  let sections = build();
  while (total(sections) > budget && nTurns > Math.min(MIN_TURNS[role], turns.length)) {
    nTurns--;
    sections = build();
  }
  if (total(sections) > budget) {
    detailedScene = false;
    sections = build();
  }
  return { instructions, context: join(sections), sections, tokens: total(sections), budget };
}

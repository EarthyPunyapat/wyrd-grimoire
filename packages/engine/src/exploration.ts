import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  type AttributeId,
  type CharacterSheet,
  type CheckRequestInput,
  type Difficulty,
  draft,
  type EventDraft,
  ExplorationAction,
  type ExplorationActionInput,
  type Modifier,
  type Resolution,
  type ResolvedStep,
  type SceneInput,
  SceneState,
} from "@wyrd/core";
import { resolveCheck, resolveOpposedCheck } from "./checks.ts";
import { castProblem, resolveCast } from "./plugins/spellcasting.ts";
import { isSuccess } from "./resolution/index.ts";
import { fail, ok, type Result } from "./result.ts";
import { lookupSkill } from "./skills.ts";
import type { GameState, RulesContext } from "./state.ts";
import { Working } from "./working.ts";
import { toldEvents } from "./world/knowledge.ts";

/**
 * Exploration turns (spec 08): validate a parsed plan against the scene, then resolve it into
 * events plus a structured Resolution for the narrator. Pure: canon names come in through
 * `nameOf`, never from storage.
 */
export type ExplorationContext = RulesContext & {
  /** A full sheet for an NPC who joins the party and isn't an actor yet (spec 04 recruiting). */
  recruitSheet?: (npcId: string) => CharacterSheet | null;
  /** Display name for an actor, entity, zone or prop ID. */
  nameOf: (id: string) => string;
  /** Minutes each kind of action takes. */
  minutes?: Partial<Record<ExplorationAction["type"], number>>;
  /** Canon lookups for travel between sites (spec 06); missing = no travel here. */
  travel?: TravelLookups;
};

export type TravelLookups = {
  /** The site a location belongs to. */
  siteOf: (locationId: string) => string | undefined;
  /** Where you arrive at a site, if it has been generated yet. */
  arrival: (siteId: string) => { locationId: string; scene: SceneInput } | null;
  /** Unexplored sites can be generated before the turn resolves (spec 06 lazy generation). */
  canGenerate?: boolean;
  /** A road encounter for this terrain and danger, from the pack's tables (null = none fits). */
  encounter?: (
    terrain: string,
    danger: number,
  ) => { name: string; foes: Array<{ name: string; statBlock?: string }> } | null;
};

type Route = { days: number; terrain: string; danger: number };
const routeBetween = (state: GameState, a: string, b: string): Route | null => {
  const e = state.edges.find(
    (x) => x.type === "routeTo" && ((x.from === a && x.to === b) || (x.from === b && x.to === a)),
  );
  if (!e) return null;
  const d = (e.data ?? {}) as Partial<Route>;
  return { days: d.days ?? 1, terrain: d.terrain ?? "road", danger: d.danger ?? 1 };
};
type Journey = { fromSiteId: string; toSiteId: string; minutesLeft: number };
const journeyOf = (state: GameState) => (state.flags.journey ?? null) as Journey | null;
const LADDER: readonly Difficulty[] = ["easy", "normal", "hard", "extreme", "heroic"];

const DEFAULT_MINUTES: Record<ExplorationAction["type"], number> = {
  check: 1,
  examine: 0,
  search: 10,
  interact: 0,
  move: 1,
  wait: 0,
  talk: 1,
  strike: 0,
  travel: 0,
  recruit: 1,
  cast: 1,
};

/** Difficulty range the parser may propose for a free-form check; harder steps need rule tables. */
const PARSER_DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard", "extreme"];
const MAX_WAIT_MINUTES = 8 * 60;

export type PlanError = {
  actionIndex: number;
  code: string;
  message: string;
  legalAlternatives?: ExplorationActionInput[];
};

export type ValidatedPlan = { actorId: string; actions: ExplorationAction[] };

const APPROACH_SKILL = {
  persuade: "core:persuasion",
  deceive: "core:deception",
  intimidate: "core:intimidation",
  charm: "core:persuasion",
} as const;

/** Normalises a skill reference the parser wrote: `stealth` → `core:stealth`, `END` → attribute. */
export function normaliseSkill(
  raw: string,
  ctx: RulesContext,
): { skill: string | { attribute: AttributeId } } | null {
  const s = raw.trim().toLowerCase();
  if ((ATTRIBUTE_IDS as readonly string[]).includes(s)) return { skill: { attribute: s as AttributeId } };
  const byName = ATTRIBUTE_IDS.find((a) => ATTRIBUTE_NAMES[a].toLowerCase() === s);
  if (byName) return { skill: { attribute: byName } };
  const candidates = s.includes(":")
    ? [s]
    : [
        `core:${s}`,
        ...Object.keys(ctx.skills)
          .filter((k) => k.endsWith(`:${s.split("/")[0]}`))
          .map((k) => (s.includes("/") ? `${k}/${s.split("/")[1]}` : k)),
      ];
  for (const c of candidates) {
    try {
      lookupSkill(c, ctx.skills);
      return { skill: c };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const present = (scene: SceneState, id: string) => id in scene.positions || id === scene.locationId;
const propIn = (scene: SceneState, id: string) => scene.zones.some((z) => z.props.some((p) => p.id === id));

const isZone = (scene: SceneState, id: string) => scene.zones.some((z) => z.id === id);

/** The gated edge (e.g. a climb) directly between two zones, if any. */
const gatedEdge = (scene: SceneState, a: string, b: string) =>
  scene.edges.find((e) => e.requires && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));

/** A zone from which a gated edge leads to `target`. */
const gatedFrom = (scene: SceneState, target: string) => {
  const e = scene.edges.find((x) => x.requires && (x.a === target || x.b === target));
  return e ? (e.a === target ? e.b : e.a) : undefined;
};

/** Talking needs the same zone or a neighbouring one. */
const withinEarshot = (scene: SceneState, a: string, b: string) =>
  a === b || scene.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

/** Zones reachable from `from`, with path length in edges (breadth-first). Edges with `requires` aren't walkable. */
function reachable(scene: SceneState, from: string): Map<string, number> {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const z = queue.shift()!;
    for (const e of scene.edges) {
      if (e.requires) continue;
      const next = e.a === z ? e.b : e.b === z ? e.a : null;
      if (next && !dist.has(next)) {
        dist.set(next, dist.get(z)! + e.moveCost);
        queue.push(next);
      }
    }
  }
  return dist;
}

/**
 * Whether an NPC would join (spec 04): they like the PC enough, share a bond (a friend or family
 * edge, such as a backstory hook), or an active quest asks for them to be recruited.
 */
export function willingToJoin(state: GameState, npcId: string, ctx: RulesContext): boolean {
  const pc = state.party.pcId;
  if (!pc) return false;
  const attitude = state.minds[npcId]?.dispositions[pc]?.attitude ?? 0;
  if (attitude >= ctx.tuning.companions.willingAttitude) return true;
  const bonded = state.edges.some(
    (e) =>
      ["friend", "family", "bond", "loyalTo"].includes(e.type) &&
      ((e.from === npcId && e.to === pc) || (e.from === pc && e.to === npcId)),
  );
  if (bonded) return true;
  return Object.values(state.quests).some(
    (q) =>
      q.status === "active" &&
      q.stages[q.stage]?.objectives.some(
        (o) => o.kind === "npcState" && o.npcId === npcId && o.state === "recruited",
      ),
  );
}

function validateOne(
  state: GameState,
  actorId: string,
  a: ExplorationAction,
  index: number,
  ctx: ExplorationContext,
): PlanError | null {
  const scene = state.scene!;
  const err = (code: string, message: string, legalAlternatives?: ExplorationActionInput[]): PlanError => ({
    actionIndex: index,
    code,
    message,
    ...(legalAlternatives ? { legalAlternatives } : {}),
  });
  const here = scene.positions[actorId];
  const lookAround: ExplorationActionInput[] = [{ type: "examine", area: "the surroundings" }];

  switch (a.type) {
    case "check": {
      if (!normaliseSkill(a.skill, ctx))
        return err("SKILL_UNKNOWN", `There is no skill or attribute called "${a.skill}"`);
      if (a.targetId && isZone(scene, a.targetId)) {
        // A check aimed at a place is an attempt to get there over a gated edge (a climb).
        if (!here || !gatedEdge(scene, here, a.targetId)) {
          const from = gatedFrom(scene, a.targetId);
          return err(
            "CLIMB_NOT_FROM_HERE",
            `${ctx.nameOf(a.targetId)} can't be reached from here with a check`,
            from && from !== here ? [{ type: "move", toZoneId: from }] : undefined,
          );
        }
        return null;
      }
      if (a.targetId && !present(scene, a.targetId) && !propIn(scene, a.targetId)) {
        return err("TARGET_NOT_PRESENT", `${a.targetId} isn't here`, lookAround);
      }
      return null;
    }
    case "examine":
    case "search":
      if (a.targetId && !present(scene, a.targetId) && !propIn(scene, a.targetId)) {
        return err("TARGET_NOT_PRESENT", `${a.targetId} isn't here`, [
          { type: a.type, area: a.area ?? "the surroundings" },
        ]);
      }
      return null;
    case "interact":
      if (!present(scene, a.targetId) && !propIn(scene, a.targetId)) {
        return err("TARGET_NOT_PRESENT", `${a.targetId} isn't here`, lookAround);
      }
      return null;
    case "move": {
      if (!scene.zones.some((z) => z.id === a.toZoneId)) {
        const options = scene.zones
          .filter((z) => z.id !== here)
          .map((z) => ({ type: "move" as const, toZoneId: z.id }));
        return err("ZONE_UNKNOWN", `There is no place called ${a.toZoneId} here`, options);
      }
      if (a.toZoneId === here) return err("ALREADY_THERE", `Already in ${ctx.nameOf(a.toZoneId)}`);
      if (!here) return err("NOT_IN_SCENE", "The actor isn't in the scene");
      if (!reachable(scene, here).has(a.toZoneId)) {
        const gate = gatedEdge(scene, here, a.toZoneId);
        if (gate?.requires === "climb") {
          return err("ZONE_NEEDS_CLIMB", `Getting to ${ctx.nameOf(a.toZoneId)} needs a climb`, [
            {
              type: "check",
              skill: "core:athletics",
              goal: `climb to ${ctx.nameOf(a.toZoneId)}`,
              proposedDifficulty: "normal",
              reason: "a climb",
              targetId: a.toZoneId,
            },
          ]);
        }
        const from = gatedFrom(scene, a.toZoneId);
        if (from && from !== here && reachable(scene, here).has(from)) {
          return err(
            "ZONE_NOT_FROM_HERE",
            `${ctx.nameOf(a.toZoneId)} can only be reached from ${ctx.nameOf(from)}`,
            [{ type: "move", toZoneId: from }],
          );
        }
        return err("ZONE_UNREACHABLE", `There's no way to ${ctx.nameOf(a.toZoneId)} from here`);
      }
      return null;
    }
    case "wait":
      if (a.minutes > MAX_WAIT_MINUTES) {
        return err("WAIT_TOO_LONG", `Waiting is at most ${MAX_WAIT_MINUTES} minutes; longer is a rest`, [
          { type: "wait", minutes: MAX_WAIT_MINUTES },
        ]);
      }
      return null;
    case "travel": {
      if (!ctx.travel) return err("TRAVEL_UNAVAILABLE", "There's nowhere to travel to from here");
      const journey = journeyOf(state);
      const from = journey?.fromSiteId ?? ctx.travel.siteOf(scene.locationId);
      if (!from) return err("NOT_AT_SITE", "You're not anywhere a road leads from");
      if (journey && (a.toSiteId === journey.toSiteId || a.toSiteId === journey.fromSiteId)) {
        return ctx.travel.arrival(a.toSiteId) || ctx.travel.canGenerate
          ? null
          : err("SITE_UNEXPLORED", `${ctx.nameOf(a.toSiteId)} isn't ready yet`);
      }
      if (a.toSiteId === from) return err("ALREADY_THERE", `You're already at ${ctx.nameOf(from)}`);
      if (!routeBetween(state, from, a.toSiteId)) {
        const options = state.edges
          .filter((e) => e.type === "routeTo" && (e.from === from || e.to === from))
          .map((e) => ({
            type: "travel" as const,
            toSiteId: e.from === from ? e.to : e.from,
            pace: "normal" as const,
          }));
        return err(
          "NO_ROUTE",
          `No road leads from ${ctx.nameOf(from)} to ${ctx.nameOf(a.toSiteId)}`,
          options,
        );
      }
      return ctx.travel.arrival(a.toSiteId) || ctx.travel.canGenerate
        ? null
        : err("SITE_UNEXPLORED", `${ctx.nameOf(a.toSiteId)} isn't ready yet`);
    }
    case "strike":
      if (!present(scene, a.targetId))
        return err("TARGET_NOT_PRESENT", `${a.targetId} isn't here to attack`, lookAround);
      if (a.targetId === actorId) return err("TARGET_SELF", "You can't attack yourself");
      return null;
    case "recruit": {
      if (!present(scene, a.targetId))
        return err("TARGET_NOT_PRESENT", `${a.targetId} isn't here to ask`, lookAround);
      if (a.targetId === actorId || a.targetId === state.party.pcId)
        return err("RECRUIT_SELF", "You're already in your own party");
      if (state.party.companionIds.includes(a.targetId))
        return err("ALREADY_COMPANION", `${ctx.nameOf(a.targetId)} already travels with you`);
      if (state.actors[a.targetId]?.dead) return err("TARGET_DEAD", `${ctx.nameOf(a.targetId)} is dead`);
      if (state.companions?.[a.targetId]?.status === "left")
        return err("LEFT_PARTY", `${ctx.nameOf(a.targetId)} has left the party and won't come back`);
      if (state.party.companionIds.length >= ctx.tuning.companions.max)
        return err("PARTY_FULL", `At most ${ctx.tuning.companions.max} companions travel with you at once`);
      if (!state.actors[a.targetId] && !ctx.recruitSheet?.(a.targetId))
        return err("CANT_RECRUIT", `${ctx.nameOf(a.targetId)} can't join a party`);
      if (!willingToJoin(state, a.targetId, ctx))
        return err("NOT_WILLING", `${ctx.nameOf(a.targetId)} isn't ready to join you; win them over first`, [
          { type: "talk", targetId: a.targetId, utterance: "Will you come with me?", approach: "persuade" },
        ]);
      return null;
    }
    case "cast": {
      const problem = castProblem(state, actorId, a, ctx as never);
      if (problem) return err(problem.code, problem.message);
      return null;
    }
    case "talk": {
      if (!present(scene, a.targetId))
        return err("TARGET_NOT_PRESENT", `${a.targetId} isn't here to talk to`, lookAround);
      if (a.targetId === actorId) return err("TALK_TO_SELF", "Talking to yourself needs no action");
      const there = scene.positions[a.targetId];
      if (here && there && !withinEarshot(scene, here, there)) {
        return err(
          "TARGET_OUT_OF_EARSHOT",
          `${ctx.nameOf(a.targetId)} is in ${ctx.nameOf(there)}, out of earshot`,
          reachable(scene, here).has(there) ? [{ type: "move", toZoneId: there }] : undefined,
        );
      }
      return null;
    }
  }
}

/**
 * Validates a plan for the current state: shape (zod), mode, presence and reachability.
 * Errors carry stable codes and, where useful, legal alternatives for the repair loop.
 */
export function validatePlan(
  state: GameState,
  actorId: string,
  actions: readonly unknown[],
  ctx: ExplorationContext,
): Result<ValidatedPlan> & { planErrors?: PlanError[] } {
  const errors: PlanError[] = [];
  if (state.mode !== "exploration") {
    return { ...fail("MODE_UNSUPPORTED", `Mode ${state.mode} isn't playable yet`), planErrors: [] };
  }
  if (!state.scene) return { ...fail("NO_SCENE", "No scene is open"), planErrors: [] };
  if (!state.actors[actorId] && !(actorId in state.scene.positions)) {
    return { ...fail("ACTOR_UNKNOWN", `No actor ${actorId}`), planErrors: [] };
  }
  if (actions.length === 0)
    errors.push({ actionIndex: 0, code: "PLAN_EMPTY", message: "The plan has no actions" });

  const parsed: ExplorationAction[] = [];
  let projected = state;
  actions.forEach((raw, i) => {
    const r = ExplorationAction.safeParse(raw);
    if (!r.success) {
      const type = (raw as { type?: unknown })?.type;
      const known = ExplorationAction.options.some((o) => o.shape.type.value === type);
      errors.push({
        actionIndex: i,
        code: known ? "ACTION_INVALID" : "ACTION_NOT_AVAILABLE",
        message: known
          ? r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")
          : `"${String(type)}" isn't an exploration action; use one of ${ExplorationAction.options.map((o) => o.shape.type.value).join(", ")}`,
      });
      return;
    }
    parsed.push(r.data);
    const e = validateOne(projected, actorId, r.data, i, ctx);
    if (e) errors.push(e);
    // Later actions are judged from where earlier moves leave the actor ("go to the jetty, then talk").
    else if (r.data.type === "move" && projected.scene) {
      projected = {
        ...projected,
        scene: {
          ...projected.scene,
          positions: { ...projected.scene.positions, [actorId]: r.data.toZoneId },
        },
      };
    }
  });
  if (errors.length) {
    return { ok: false, errors: errors.map(({ code, message }) => ({ code, message })), planErrors: errors };
  }
  return ok({ actorId, actions: parsed });
}

const LIGHT_MODIFIER: Record<SceneState["light"], Modifier | null> = {
  bright: null,
  dim: { source: "dim light", value: -20 },
  dark: { source: "darkness", value: -40 },
};

/**
 * Resolves a validated plan in order. Each action is re-validated against the state the earlier
 * actions produced; if one no longer makes sense, execution stops there (spec 08, step 5).
 */
export function resolvePlan(
  initial: GameState,
  plan: ValidatedPlan,
  ctx: ExplorationContext,
): Result<{ events: EventDraft[]; resolution: Resolution }> {
  const w = new Working(initial);
  const steps: ResolvedStep[] = [];
  const beats: string[] = [];
  const forbidden = new Set<string>();
  let minutes = 0;
  let stoppedAt: number | undefined;
  const actorName = ctx.nameOf(plan.actorId);
  const minutesFor = (t: ExplorationAction["type"]) => ctx.minutes?.[t] ?? DEFAULT_MINUTES[t];

  for (const [index, action] of plan.actions.entries()) {
    const invalid = validateOne(w.state, plan.actorId, action, index, ctx);
    if (invalid) {
      stoppedAt = index;
      beats.push(`${actorName} couldn't go on to the next thing: ${invalid.message}.`);
      break;
    }
    const scene = w.state.scene!;
    const step = (
      outcome: ResolvedStep["outcome"],
      summary: string,
      mechanics?: ResolvedStep["mechanics"],
    ) => {
      steps.push({ index, action, outcome, summary, ...(mechanics ? { mechanics } : {}) });
      beats.push(summary);
    };

    const runCheck = (req: CheckRequestInput, what: string) => {
      const out = resolveCheck(w.state, req, ctx);
      if (!out.ok) return out;
      w.apply(out.value.events);
      const eff = out.value.effective;
      step(
        eff.degree,
        `${actorName} ${what}: ${eff.degree === "critSuccess" ? "a critical success" : eff.degree === "critFailure" ? "a critical failure" : eff.degree}.`,
        eff.display,
      );
      return ok(true);
    };

    switch (action.type) {
      case "check": {
        const norm = normaliseSkill(action.skill, ctx)!;
        const difficulty = PARSER_DIFFICULTIES.includes(action.proposedDifficulty)
          ? action.proposedDifficulty
          : "extreme";
        const r = runCheck(
          {
            actorId: plan.actorId,
            skill: norm.skill,
            difficulty,
            purpose: `${action.goal} (${action.reason})`,
          },
          `tries to ${action.goal}`,
        );
        if (!r.ok) return r;
        if (action.targetId && isZone(scene, action.targetId) && isSuccess(steps.at(-1)!.outcome as never)) {
          w.apply([draft("EntityMoved", { entityId: plan.actorId, toZoneId: action.targetId }, "engine")]);
          const last = steps.at(-1)!;
          last.summary = `${last.summary} ${actorName} is now in ${ctx.nameOf(action.targetId)}.`;
          beats[beats.length - 1] = last.summary;
        }
        break;
      }
      case "examine": {
        const what = action.targetId ? ctx.nameOf(action.targetId) : (action.area ?? "the surroundings");
        step("done", `${actorName} examines ${what}.`);
        forbidden.add("Describe only what the PC can perceive, plus facts they know; reveal no secrets.");
        break;
      }
      case "search": {
        const what = action.targetId ? ctx.nameOf(action.targetId) : (action.area ?? "the area");
        const light = LIGHT_MODIFIER[scene.light];
        const r = runCheck(
          {
            actorId: plan.actorId,
            skill: "core:perception",
            difficulty: "normal",
            modifiers: light ? [light] : [],
            tags: ["sight"],
            purpose: `search ${what}`,
          },
          `searches ${what}`,
        );
        if (!r.ok) return r;
        break;
      }
      case "interact":
        step("done", `${actorName} ${action.verb} ${ctx.nameOf(action.targetId)}.`);
        break;
      case "move": {
        const dist = reachable(scene, scene.positions[plan.actorId]!).get(action.toZoneId) ?? 1;
        w.apply([draft("EntityMoved", { entityId: plan.actorId, toZoneId: action.toZoneId }, "engine")]);
        minutes += dist * minutesFor("move") - minutesFor("move");
        step("done", `${actorName} goes to ${ctx.nameOf(action.toZoneId)}.`);
        break;
      }
      case "wait":
        minutes += action.minutes;
        step("done", `${actorName} waits about ${action.minutes} minutes.`);
        break;
      case "travel": {
        const r = travel(w, plan.actorId, action, ctx, (outcome, summary, mechanics) =>
          step(outcome, summary, mechanics),
        );
        if (!r.ok) return r;
        stoppedAt = index + 1 < plan.actions.length ? index + 1 : undefined;
        break;
      }
      case "recruit": {
        const id = action.targetId;
        const sheet = w.state.actors[id] ? undefined : (ctx.recruitSheet?.(id) ?? undefined);
        w.apply([
          draft(
            "CompanionJoined",
            { companionId: id, reason: action.reason, ...(sheet ? { sheet } : {}) },
            "engine",
          ),
          draft(
            "FactAsserted",
            {
              fact: {
                id: `fact:${id}:joined:${w.state.campaign.gameTime}`,
                entityId: id,
                predicate: "joinedPartyBecause",
                value: action.reason,
                source: "model",
                visibility: "public",
                importance: 4,
              },
            },
            "engine",
          ),
        ]);
        step("success", `${ctx.nameOf(id)} agrees to travel with ${actorName}.`);
        break;
      }
      case "cast": {
        const cast = resolveCast(w, plan.actorId, action, ctx as never, false);
        if (!cast.ok) return cast;
        steps.push({
          index,
          action,
          outcome: cast.value.step.outcome,
          summary: cast.value.step.summary,
          ...(cast.value.step.lines[0] ? { mechanics: cast.value.step.lines[0] } : {}),
          ...(cast.value.step.lines.length ? { lines: cast.value.step.lines } : {}),
        });
        beats.push(cast.value.step.summary);
        break;
      }
      case "strike":
        // The turn dispatcher turns a plan with a strike into a fight before resolvePlan runs.
        step("done", `${actorName} goes for ${ctx.nameOf(action.targetId)}.`);
        break;
      case "talk": {
        const target = ctx.nameOf(action.targetId);
        const said = `${actorName} says to ${target}: "${action.utterance}"`;
        if (action.approach === "neutral") {
          step("done", `${said}.`);
          w.apply(toldEvents(w.state, action.targetId, plan.actorId, action.utterance, "neutral", null, ctx));
          forbidden.add(
            `${target} may answer, but agrees to, gives or reveals nothing the engine hasn't resolved.`,
          );
          break;
        }
        const skill = APPROACH_SKILL[action.approach];
        if (w.state.actors[action.targetId]) {
          const out = resolveOpposedCheck(
            w.state,
            {
              actorId: plan.actorId,
              skill,
              difficulty: "normal",
              purpose: `${action.approach} ${target}`,
              opposedBy: {
                actorId: action.targetId,
                skill: action.approach === "intimidate" ? { attribute: "wil" } : "core:insight",
              },
            },
            ctx,
          );
          if (!out.ok) return out;
          w.apply(out.value.events);
          const won = out.value.winner === "active";
          w.apply(
            toldEvents(w.state, action.targetId, plan.actorId, action.utterance, action.approach, won, ctx),
          );
          step(
            won ? "success" : "failure",
            `${said}. The attempt to ${action.approach} ${won ? "works" : "fails"}.`,
            out.value.active.display,
          );
        } else {
          const r = runCheck(
            { actorId: plan.actorId, skill, difficulty: "normal", purpose: `${action.approach} ${target}` },
            `tries to ${action.approach} ${target}`,
          );
          if (!r.ok) return r;
          const last = steps.at(-1)!;
          w.apply(
            toldEvents(
              w.state,
              action.targetId,
              plan.actorId,
              action.utterance,
              action.approach,
              isSuccess(last.outcome as never),
              ctx,
            ),
          );
          last.summary = `${said}. ${last.summary} ${isSuccess(last.outcome as never) ? `${target} is swayed.` : `${target} isn't swayed.`}`;
          beats[beats.length - 1] = last.summary;
        }
        break;
      }
    }
    minutes += minutesFor(action.type);
    if (action.type === "travel") break; // arriving (or being waylaid) ends the plan
  }

  if (minutes > 0) w.apply([draft("TimeAdvanced", { minutes, reason: "exploration" }, "engine")]);
  return ok({
    events: w.events,
    resolution: {
      actorId: plan.actorId,
      steps,
      requiredBeats: beats,
      forbidden: [...forbidden],
      ...(stoppedAt !== undefined ? { stoppedAt } : {}),
      minutes,
    },
  });
}

/** Plain summary used when narration fails, so the turn still reads sensibly. */
export function mechanicalSummary(resolution: Resolution): string {
  return resolution.requiredBeats.join(" ");
}

/**
 * A journey along a route (spec 06): a Navigation check set by danger and pace decides the time
 * taken and whether trouble finds you. Arrival opens the site's arrival scene; an encounter stops
 * you on the road (a road scene with the foes) and the journey resumes when you travel again.
 */
function travel(
  w: Working,
  actorId: string,
  a: Extract<ExplorationAction, { type: "travel" }>,
  ctx: ExplorationContext,
  step: (outcome: ResolvedStep["outcome"], summary: string, mechanics?: ResolvedStep["mechanics"]) => void,
): Result<true> {
  const t = ctx.travel!;
  const state = w.state;
  const journey = journeyOf(state);
  const from = journey?.fromSiteId ?? t.siteOf(state.scene!.locationId)!;
  const resuming = journey && a.toSiteId === journey.toSiteId;
  const route = routeBetween(state, journey?.fromSiteId ?? from, journey?.toSiteId ?? a.toSiteId) ?? {
    days: 1,
    terrain: "road",
    danger: 1,
  };
  const tt = ctx.tuning.world.travel;
  const full = route.days * 1440;
  // Resuming covers what's left; turning back covers what was already walked.
  const base = resuming
    ? journey!.minutesLeft
    : journey
      ? Math.max(tt.minRoadMinutes, full - journey.minutesLeft)
      : full;
  const start =
    tt.dangerDifficulty[Math.max(0, Math.min(tt.dangerDifficulty.length - 1, route.danger - 1))] ?? 1;
  const di = Math.max(0, Math.min(LADDER.length - 1, start + tt.paceShift[a.pace]));
  const check = resolveCheck(
    state,
    {
      actorId,
      skill: "core:navigation",
      difficulty: LADDER[di]!,
      purpose: `travel to ${ctx.nameOf(a.toSiteId)}`,
      tags: ["travel"],
    },
    ctx,
  );
  if (!check.ok) return check;
  w.apply(check.value.events);
  const degree = check.value.effective.degree;
  const minutes = Math.round(base * tt.pace[a.pace] * (isSuccess(degree) ? 1 : tt.failureTimeFactor));
  const encounter =
    (!isSuccess(degree) && route.danger >= 2) || degree === "critFailure"
      ? (t.encounter?.(route.terrain, route.danger) ?? null)
      : null;
  if (encounter) {
    const spent = Math.max(1, Math.round(minutes / 2));
    const now = state.campaign.gameTime + spent;
    const roadId = `location:road-${now}`;
    const group = `road-${now}`;
    const foes = encounter.foes.map((f, i) => ({ ...f, id: `npc:${group}-${i + 1}` }));
    w.apply([
      draft("TimeAdvanced", { minutes: spent, reason: "travel" }, "engine"),
      draft(
        "EntityCreated",
        {
          entity: {
            id: roadId,
            kind: "location",
            name: `the ${route.terrain} to ${ctx.nameOf(a.toSiteId)}`,
            aliases: [],
            detail: "stub",
            summary: `Somewhere between ${ctx.nameOf(from)} and ${ctx.nameOf(a.toSiteId)}.`,
            data: { road: true },
            status: "active",
            importance: 1,
          },
        },
        "engine",
      ),
      ...foes.map((f) =>
        draft(
          "EntityCreated",
          {
            entity: {
              id: f.id,
              kind: "npc" as const,
              name: f.name,
              aliases: [],
              detail: "stub" as const,
              summary: encounter.name,
              data: { ...(f.statBlock ? { statBlock: f.statBlock } : {}), group, intent: "rob" },
              status: "active" as const,
              importance: 1,
            },
          },
          "engine",
        ),
      ),
      draft("SceneClosed", { sceneId: state.scene!.id, reason: "waylaid on the road" }, "engine"),
      draft(
        "SceneOpened",
        {
          scene: SceneState.parse({
            id: `scene:${roadId}`,
            locationId: roadId,
            zones: [
              { id: "z:road", name: "the road" },
              { id: "z:verge", name: "the verge" },
              { id: "z:brush", name: "the brush", tags: ["coverPartial", "dim"] },
              { id: "z:back", name: "back the way you came", tags: ["exit"] },
            ],
            edges: [
              { a: "z:road", b: "z:verge" },
              { a: "z:verge", b: "z:brush" },
              { a: "z:road", b: "z:brush" },
              { a: "z:road", b: "z:back" },
            ],
            positions: {
              ...Object.fromEntries([actorId, ...state.party.companionIds].map((id) => [id, "z:road"])),
              ...Object.fromEntries(foes.map((f, i) => [f.id, i % 2 ? "z:brush" : "z:verge"])),
            },
            light: "bright",
            openedAt: now,
          }),
        },
        "engine",
      ),
      draft(
        "JourneyChanged",
        {
          journey: {
            fromSiteId: from,
            toSiteId: journey?.toSiteId ?? a.toSiteId,
            minutesLeft: Math.max(tt.minRoadMinutes, minutes - spent),
          },
        },
        "engine",
      ),
    ]);
    step(
      degree,
      `On the way to ${ctx.nameOf(a.toSiteId)}, ${ctx.nameOf(actorId)} is waylaid: ${encounter.name}.`,
      check.value.effective.display,
    );
    return ok(true);
  }
  const arrival = t.arrival(a.toSiteId)!;
  const arrivedAt = state.campaign.gameTime + minutes;
  const scene = SceneState.parse({
    ...arrival.scene,
    id: `scene:${arrival.locationId}:${arrivedAt}`,
    positions: {
      ...arrival.scene.positions,
      ...Object.fromEntries(
        [actorId, ...state.party.companionIds].map((id) => [id, arrival.scene.zones[0]!.id]),
      ),
    },
    openedAt: arrivedAt,
  });
  w.apply([
    draft("TimeAdvanced", { minutes, reason: "travel" }, "engine"),
    ...(journey ? [draft("JourneyChanged", { journey: null }, "engine")] : []),
    draft("SceneClosed", { sceneId: state.scene!.id, reason: "travel" }, "engine"),
    draft("SceneOpened", { scene }, "engine"),
  ]);
  const days = minutes / 1440;
  const span =
    days >= 1 ? `${Math.round(days * 10) / 10} days` : `${Math.max(1, Math.round(minutes / 60))} hours`;
  step(
    degree,
    `After ${span} on the ${route.terrain}, ${ctx.nameOf(actorId)} arrives at ${ctx.nameOf(a.toSiteId)}.`,
    check.value.effective.display,
  );
  return ok(true);
}

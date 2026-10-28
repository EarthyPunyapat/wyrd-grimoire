import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_NAMES,
  type AttributeId,
  type CheckRequestInput,
  type Difficulty,
  draft,
  type EventDraft,
  ExplorationAction,
  type ExplorationActionInput,
  type Modifier,
  type Resolution,
  type ResolvedStep,
  type SceneState,
} from "@wyrd/core";
import { resolveCheck, resolveOpposedCheck } from "./checks.ts";
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
  /** Display name for an actor, entity, zone or prop ID. */
  nameOf: (id: string) => string;
  /** Minutes each kind of action takes. */
  minutes?: Partial<Record<ExplorationAction["type"], number>>;
};

const DEFAULT_MINUTES: Record<ExplorationAction["type"], number> = {
  check: 1,
  examine: 0,
  search: 10,
  interact: 0,
  move: 1,
  wait: 0,
  talk: 1,
  strike: 0,
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
    case "strike":
      if (!present(scene, a.targetId))
        return err("TARGET_NOT_PRESENT", `${a.targetId} isn't here to attack`, lookAround);
      if (a.targetId === actorId) return err("TARGET_SELF", "You can't attack yourself");
      return null;
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

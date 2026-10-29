import {
  type ActorId,
  type ConditionInstance,
  type DiseaseDef,
  type DiseaseInstance,
  draft,
  type EventDraft,
  emptyNeeds,
  type ItemCatalog,
  localIdOf,
  type Modifier,
  type NeedLadder,
  type NeedStageDef,
  type NeedState,
  Rng,
  type SurvivalState,
  survivalOf,
  weatherKindOf,
} from "@wyrd/core";
import { type CheckOutcome, resolveCheck } from "./checks.ts";
import { applyCondition, type CheckContext, removeCondition } from "./conditions.ts";
import { isSuccess } from "./resolution/index.ts";
import { fail, ok, type Result } from "./result.ts";
import type { GameState, RulesContext } from "./state.ts";
import type { Working } from "./working.ts";

/**
 * Survival, disease, weather effects, lighting and language barriers (spec 11, M7). Everything here
 * is pure: randomness comes from the seeded RNG, time from game state, and content through `ctx`.
 */

export type SurvivalContext = RulesContext & {
  /** Pack items, to read tags (`food`, `water`, `light`, `warm`). */
  items?: ItemCatalog;
  /** Pack diseases by namespaced id. */
  diseases?: Record<string, DiseaseDef>;
};

/** The survival slice of a state's flags. */
export const survivalSlice = (state: GameState): SurvivalState => survivalOf(state.flags);

export const needsOf = (state: GameState, actorId: ActorId): NeedState =>
  survivalSlice(state).needs[actorId] ?? emptyNeeds();

/** The season from the calendar; the daily tick needs it for exposure and foraging. */
export function seasonOf(gameTime: number, tuning: RulesContext["tuning"]): string {
  const w = tuning.world;
  const dayNumber = Math.floor(gameTime / 1440);
  const daysPerYear = w.daysPerMonth * w.monthNames.length;
  const month = Math.floor((dayNumber % daysPerYear) / w.daysPerMonth);
  return w.seasons[month] ?? "";
}

/** The climate a weather string implies for water needs. */
export function climateOf(weather: string): string {
  const w = weather.toLowerCase();
  if (/(snow|sleet|bitter|freezing|frost|blizzard)/.test(w)) return "cold";
  if (/(hot|heat|scorch|swelter|dust)/.test(w)) return "arid";
  if (/(humid|tropical|muggy|monsoon)/.test(w)) return "tropical";
  if (/(sea|marine|salt)/.test(w)) return "marine";
  return "temperate";
}

/** Degrees relative to comfortable: the weather plus the season. */
export function temperatureOf(weather: string, season: string, tuning: RulesContext["tuning"]): number {
  const s = tuning.survival;
  const kind = weather.toLowerCase();
  const weatherTemperature = Object.entries(s.weather.temperature).find(([k]) => kind.includes(k))?.[1];
  return (weatherTemperature ?? 0) + (s.exposure.seasonTemperature[season] ?? 0);
}

const itemTags = (id: string, ctx: SurvivalContext): readonly string[] => {
  const local = localIdOf(id);
  const gear = ctx.items?.gear[id];
  return gear?.tags ?? [local];
};

/** Food or water, from an item's tags or its conventional local id. */
export function supplyKindOf(id: string, ctx: SurvivalContext): "food" | "water" | null {
  const local = localIdOf(id);
  const tags = itemTags(id, ctx);
  if (tags.includes("food") || local === "rations" || local === "ration") return "food";
  if (tags.includes("water") || tags.includes("drink") || local === "waterskin" || local === "water")
    return "water";
  return null;
}

/** Worn clothing's warmth, from item tags plus the base. */
export function warmthOf(state: GameState, actorId: ActorId, ctx: SurvivalContext): number {
  const sheet = state.actors[actorId]?.sheet;
  if (!sheet) return ctx.tuning.survival.exposure.baseWarmth;
  let warmth = ctx.tuning.survival.exposure.baseWarmth;
  for (const id of sheet.equipment.worn) {
    for (const tag of itemTags(id, ctx)) warmth += ctx.tuning.survival.exposure.warmthByTag[tag] ?? 0;
  }
  return warmth;
}

/** The exposure ladder an actor is on: cold, hot, or none. */
export function exposureStep(
  state: GameState,
  actorId: ActorId,
  ctx: SurvivalContext,
  weather: string,
  season: string,
): { kind: "cold" | "hot" | "none"; steps: number } {
  const s = ctx.tuning.survival.exposure;
  const comfort = temperatureOf(weather, season, ctx.tuning) + warmthOf(state, actorId, ctx);
  if (comfort < s.coldBelow) return { kind: "cold", steps: 1 };
  if (comfort > s.hotAbove) return { kind: "hot", steps: 1 };
  return { kind: "none", steps: 0 };
}

/** The highest rung reached at `value`, or null below the first. */
export function stageAt(ladder: readonly NeedStageDef[], value: number): NeedStageDef | null {
  let found: NeedStageDef | null = null;
  for (const stage of ladder) if (value >= stage.at) found = stage;
  return found;
}

/** Whether a stage (or a worse one) blocks natural healing. */
export function recoveryBlocked(needs: NeedState, tuning: RulesContext["tuning"]): boolean {
  const stages = tuning.survival.stages;
  const active = new Set(needs.stages);
  for (const ladder of Object.values(stages))
    for (const stage of ladder) if (stage.noRecovery && active.has(stage.id)) return true;
  return false;
}

const addNotice = (
  w: Working,
  kind: "need" | "supply" | "disease" | "weather" | "light" | "language",
  text: string,
) =>
  w.apply([
    draft(
      "SurvivalNotice",
      {
        notice: {
          id: `notice:${w.state.campaign.gameTime}:${w.events.length}`,
          at: w.state.campaign.gameTime,
          kind,
          text,
        },
      },
      "engine",
    ),
  ]);

/** Consumes rations or water from the actor's carried items, with a notice per stack. */
export function consumeSupply(
  w: Working,
  actorId: ActorId,
  kind: "food" | "water",
  qty: number,
  reason: string,
  ctx: SurvivalContext,
): number {
  const actor = w.state.actors[actorId];
  if (!actor || qty <= 0) return 0;
  let left = qty;
  for (const stack of [...actor.sheet.equipment.carried]) {
    if (left <= 0) break;
    if (supplyKindOf(stack.item, ctx) !== kind) continue;
    const take = Math.min(left, stack.qty);
    if (take <= 0) continue;
    w.apply([
      draft(
        "SuppliesConsumed",
        {
          actorId,
          itemId: stack.item,
          kind,
          qty: take,
          notice:
            kind === "food"
              ? `You eat ${take === 1 ? "a day's rations" : `${take} days' rations`} (${reason}).`
              : `You drink ${take === 1 ? "a waterskin" : `${take} waterskins`} (${reason}).`,
        },
        "engine",
      ),
    ]);
    left -= take;
  }
  return qty - left;
}

/** Adds foraged or hunted supplies to the carried items. */
export function gainSupply(
  w: Working,
  actorId: ActorId,
  kind: "food" | "water",
  qty: number,
  notice: string,
  ctx: SurvivalContext,
): void {
  const itemId =
    Object.keys(ctx.items?.gear ?? {}).find((id) => supplyKindOf(id, ctx) === kind) ??
    (kind === "food" ? "core:rations" : "core:waterskin");
  w.apply([draft("SuppliesGained", { actorId, itemId, kind, qty, notice }, "engine")]);
}

const _conditionKey = (c: ConditionInstance) => `${c.id}:${c.level ?? 1}`;

/** Applies the stages a need has reached and clears the ones it has left. */
function syncStages(
  w: Working,
  actorId: ActorId,
  ladder: NeedLadder,
  value: number,
  previous: readonly string[],
  applied: Set<string>,
  ctx: SurvivalContext,
): void {
  const stages = ctx.tuning.survival.stages[ladder];
  const stage = stageAt(stages, value);
  const nextIds = stages.filter((s) => value >= s.at).map((s) => s.id);
  const wanted = new Set(nextIds);
  const present = new Set(w.state.actors[actorId]?.sheet.status.conditions.map((c) => c.id) ?? []);
  // Remove conditions for stages no longer reached.
  for (const id of previous) {
    if (wanted.has(id)) continue;
    const def = stages.find((s) => s.id === id);
    if (!def?.condition || applied.has(def.condition)) continue;
    if (present.has(def.condition)) w.apply(unwrap(removeCondition(w.state, actorId, def.condition)));
    applied.delete(def.condition);
  }
  if (!stage) return;
  // Apply the current stage's condition (replace keeps levels correct).
  if (stage.condition) {
    const instance: ConditionInstance = {
      id: stage.condition,
      ...(stage.level !== undefined ? { level: stage.level } : {}),
    };
    w.apply(unwrap(applyCondition(w.state, actorId, instance)));
    applied.add(stage.condition);
  }
}

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.errors[0]?.message ?? "survival rule failed");
  return r.value;
};

/** Rolls the endurance checks a severe need demands, damaging the actor on failure. */
function needChecks(w: Working, actorId: ActorId, stage: NeedStageDef | null, ctx: SurvivalContext): void {
  if (!stage?.checkEveryHours) return;
  const perDay = Math.min(
    ctx.tuning.survival.disease.maxChecksPerDay,
    Math.max(1, Math.floor(24 / stage.checkEveryHours)),
  );
  for (let i = 0; i < perDay; i++) {
    const actor = w.state.actors[actorId];
    if (!actor || actor.dead) return;
    const out = unwrap(
      resolveCheck(
        w.state,
        {
          actorId,
          skill: { attribute: "end" },
          difficulty: stage.checkDifficulty ?? ctx.tuning.survival.disease.checkDifficulty,
          purpose: `endure ${stage.name}`,
          tags: ["resist"],
        },
        ctx,
      ),
    );
    w.apply(out.events);
    if (!isSuccess(out.effective.degree) && (stage.failureDamage ?? 0) > 0) {
      const hp = w.state.actors[actorId]!.sheet.status.hp;
      const damage = Math.min(stage.failureDamage ?? 0, hp);
      if (damage > 0)
        w.apply([
          draft("HpChanged", { actorId, hp: hp - damage, delta: -damage, cause: "survival" }, "engine"),
        ]);
    }
  }
}

/**
 * The daily survival tick (spec 06, Daily): eat, drink, sleep, exposure, escalation and endurance
 * checks, then disease progression. The PC carries the supplies; diseases affect the whole party.
 */
export function survivalDaily(w: Working, ctx: SurvivalContext, dayNumber: number): EventDraft[] {
  const settings = w.state.campaign.settings;
  const pcId = w.state.party.pcId;
  const start = w.events.length;
  if (!pcId || !w.state.actors[pcId]) return [];
  const survival = survivalSlice(w.state);
  const needs = survival.needs[pcId] ?? emptyNeeds();
  const t = ctx.tuning.survival;
  const weather = w.state.calendar.weather.scene ?? w.state.scene?.weather ?? "";
  const season = seasonOf(dayNumber * 1440, ctx.tuning);

  let daysWithoutFood = needs.daysWithoutFood;
  let daysWithoutWater = needs.daysWithoutWater;
  let hoursAwake = needs.hoursAwake;
  let exposure = needs.exposure;
  let exposureKind = needs.exposureKind;

  if (settings.subsystems.survival) {
    // Food: one ration a day, consumed automatically.
    const eaten = consumeSupply(w, pcId, "food", t.rationPerDay, "a day's rations", ctx);
    if (eaten >= t.rationPerDay) {
      daysWithoutFood = 0;
    } else {
      daysWithoutFood++;
      addNotice(w, "need", "The larder is empty. Hunger sets in.");
    }

    // Water: litres by climate and exertion, drawn from waterskins.
    const climate = climateOf(weather);
    const travelling = Boolean(w.state.flags.journey);
    const litres =
      (t.litresPerDay[climate] ?? t.litresPerDay.temperate ?? 2.5) + (travelling ? t.exertionBonusLitres : 0);
    const units = Math.max(1, Math.ceil(litres / t.litresPerWaterskin));
    const drunk = consumeSupply(w, pcId, "water", units, `${litres} litres for the ${climate} day`, ctx);
    if (drunk >= units) {
      daysWithoutWater = 0;
    } else {
      daysWithoutWater++;
      addNotice(w, "need", "Your waterskin runs dry.");
    }

    // Sleep: a night's rest unless the day was spent fighting or on the road.
    const rested = w.state.mode !== "combat" && !travelling;
    hoursAwake = rested
      ? Math.max(0, t.sleep.awakeHoursPerDay - t.sleep.assumedHours)
      : hoursAwake + t.sleep.awakeHoursPerDay;

    // Exposure: clothing warmth against the day's temperature.
    const step = exposureStep(w.state, pcId, ctx, weather, season);
    if (step.kind === "none") {
      exposure = 0;
      exposureKind = "none";
    } else {
      exposureKind = step.kind;
      exposure = step.steps;
    }
  }

  // Escalation ladders: conditions and endurance checks.
  const applied = new Set<string>();
  const ladders: Array<[NeedLadder, number]> = [
    ["food", daysWithoutFood],
    ["water", daysWithoutWater],
    ["sleep", hoursAwake],
    ...(exposureKind === "cold" ? ([["cold", exposure]] as Array<[NeedLadder, number]>) : []),
    ...(exposureKind === "hot" ? ([["hot", exposure]] as Array<[NeedLadder, number]>) : []),
  ];
  const nextStages: string[] = [];
  for (const [ladder, value] of ladders) {
    const stages = t.stages[ladder];
    nextStages.push(...stages.filter((s) => value >= s.at).map((s) => s.id));
    syncStages(w, pcId, ladder, value, needs.stages, applied, ctx);
    needChecks(w, pcId, stageAt(stages, value), ctx);
  }
  // Clear stages of a ladder that no longer applies (exposure clearing, for one).
  for (const id of needs.stages) {
    if (nextStages.includes(id)) continue;
    const def = Object.values(t.stages)
      .flat()
      .find((s) => s.id === id);
    if (
      def?.condition &&
      !applied.has(def.condition) &&
      w.state.actors[pcId]?.sheet.status.conditions.some((c) => c.id === def.condition)
    )
      w.apply(unwrap(removeCondition(w.state, pcId, def.condition)));
  }

  // Natural healing, unless a need blocks it.
  const nextNeeds: NeedState = {
    daysWithoutFood,
    daysWithoutWater,
    hoursAwake,
    exposure,
    exposureKind,
    stages: nextStages,
  };
  const actor = w.state.actors[pcId];
  if (settings.subsystems.survival && actor && !recoveryBlocked(nextNeeds, ctx.tuning)) {
    const hp = actor.sheet.status.hp;
    const max = actor.sheet.derived.hpMax;
    if (t.dailyHeal > 0 && hp < max)
      w.apply([
        draft(
          "HpChanged",
          { actorId: pcId, hp: Math.min(max, hp + t.dailyHeal), delta: t.dailyHeal, cause: "healing" },
          "engine",
        ),
      ]);
  }

  if (settings.subsystems.survival)
    w.apply([
      draft(
        "SurvivalNeedsUpdated",
        { actorId: pcId, needs: nextNeeds, reason: `day ${dayNumber}` },
        "engine",
      ),
    ]);

  // Lights burn down with the day.
  for (const [actorId, lights] of Object.entries(survival.lights)) {
    for (const light of lights) {
      const left = Math.max(0, light.minutesLeft - 1440);
      w.apply([draft("LightBurned", { actorId, itemId: light.itemId, minutesLeft: left }, "engine")]);
      if (left === 0) addNotice(w, "light", `${localIdOf(light.itemId)} burns out.`);
    }
  }

  if (settings.subsystems.disease) progressDiseases(w, ctx);
  return w.events.slice(start);
}

/** Whether the actor has a light burning or a torch or lantern in hand. */
export function hasLightSource(state: GameState, actorId: ActorId): boolean {
  if ((survivalSlice(state).lights[actorId]?.length ?? 0) > 0) return true;
  const eq = state.actors[actorId]?.sheet.equipment;
  if (!eq) return false;
  return [eq.held.main, eq.held.off, ...eq.worn]
    .filter((id): id is string => !!id)
    .some((id) => ["torch", "lantern", "candle"].includes(localIdOf(id)));
}

/** Darkvision comes from a talent or condition; the pack names the trait. */
export function hasDarkvision(state: GameState, actorId: ActorId): boolean {
  const sheet = state.actors[actorId]?.sheet;
  if (!sheet) return false;
  return [...sheet.talents, ...sheet.status.conditions.map((c) => c.id)].some((id) =>
    localIdOf(id).includes("darkvision"),
  );
}

export type EnvironmentEffect = { modifiers: Modifier[]; banes: number };

/**
 * Weather and light penalties for one check (spec 11): rain and wind penalise ranged attacks and
 * Perception; dim light −20 and darkness −40 on sight, unless a light or darkvision helps.
 */
export function environmentEffect(
  state: GameState,
  actorId: ActorId,
  check: CheckContext,
  ctx: RulesContext,
): EnvironmentEffect {
  const settings = state.campaign.settings;
  const modifiers: Modifier[] = [];
  const sight =
    check.skillId === "core:perception" ||
    check.skillId === "core:search" ||
    check.skillId?.startsWith("core:ranged") === true ||
    check.tags.includes("sight");
  const ranged = check.skillId === "core:ranged" || check.tags.includes("ranged");

  if (settings.subsystems.weatherEffects) {
    const weather = state.scene?.weather || state.calendar.weather.scene || "";
    if (weather) {
      const effect = weatherEffectOf(weather, ctx.tuning);
      if (ranged && effect.rangedPenalty !== 0)
        modifiers.push({ source: `${effect.kind} weather`, value: effect.rangedPenalty });
      if (sight && effect.perceptionPenalty !== 0)
        modifiers.push({ source: `${effect.kind} weather`, value: effect.perceptionPenalty });
    }
  }
  if (settings.subsystems.lightingAndVision && state.scene && sight) {
    const effect = lightEffectOf(
      state.scene.light,
      { hasLight: hasLightSource(state, actorId), hasDarkvision: hasDarkvision(state, actorId) },
      ctx.tuning,
    );
    if (effect.modifier !== 0) modifiers.push({ source: effect.note, value: effect.modifier });
  }
  return { modifiers, banes: 0 };
}

const weatherEffectOf = (weather: string, tuning: RulesContext["tuning"]) => {
  const kind = weatherKindOf(weather);
  const row = tuning.survival.weather.effects[kind];
  return {
    kind,
    rangedPenalty: row?.rangedPenalty ?? 0,
    perceptionPenalty: row?.perceptionPenalty ?? 0,
    travelFactor: row?.travelFactor ?? 1,
    blocksRoutes: row?.blocksRoutes ?? false,
  };
};

const lightEffectOf = (
  light: "bright" | "dim" | "dark",
  o: { hasLight: boolean; hasDarkvision: boolean },
  tuning: RulesContext["tuning"],
) => {
  const t = tuning.survival.light;
  if (light === "bright" || o.hasLight) return { modifier: 0, note: "" };
  if (light === "dim") return { modifier: t.dimPenalty, note: "dim light" };
  return o.hasDarkvision ? { modifier: 0, note: "" } : { modifier: t.darkPenalty, note: "darkness" };
};

/** Travel time multiplier from the weather (snow and mud slow, storms more). */
export function travelFactor(state: GameState, tuning: RulesContext["tuning"]): number {
  if (!state.campaign.settings.subsystems.weatherEffects) return 1;
  const weather = state.scene?.weather || state.calendar.weather.scene || "";
  return weather ? weatherEffectOf(weather, tuning).travelFactor : 1;
}

/** Whether the weather closes the roads today (spec 11: storms can block routes). */
export function routesBlocked(state: GameState, tuning: RulesContext["tuning"]): boolean {
  if (!state.campaign.settings.subsystems.weatherEffects) return false;
  const weather = state.scene?.weather || state.calendar.weather.scene || "";
  return weather ? weatherEffectOf(weather, tuning).blocksRoutes : false;
}

// ── Disease ─────────────────────────────────────────────────────────────────────────────────────

/** Resists or catches a disease after exposure (spec 11, Disease). */
export function exposeToDisease(
  state: GameState,
  actorId: ActorId,
  diseaseId: string,
  ctx: SurvivalContext,
): Result<EventDraft[]> {
  const def = ctx.diseases?.[diseaseId];
  if (!def) return fail("DISEASE_UNKNOWN", `No disease ${diseaseId}`);
  if (!state.actors[actorId]) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  const out = resolveCheck(
    state,
    {
      actorId,
      skill: { attribute: "end" },
      difficulty: def.resistance,
      purpose: `resist ${def.name}`,
      tags: ["resist"],
    },
    ctx,
  );
  if (!out.ok) return out;
  const drafts: EventDraft[] = [...out.value.events];
  if (isSuccess(out.value.effective.degree)) {
    drafts.push(
      draft(
        "SurvivalNotice",
        {
          notice: {
            id: `notice:${state.campaign.gameTime}:disease:${diseaseId}`,
            at: state.campaign.gameTime,
            kind: "disease",
            text: `You shake off the ${def.name.toLowerCase()}.`,
          },
        },
        "engine",
      ),
    );
    return ok(drafts);
  }
  const instance: DiseaseInstance = {
    id: `disease:${actorId}:${state.campaign.gameTime}:${diseaseId}`,
    diseaseId,
    actorId,
    infectedAt: state.campaign.gameTime,
    stage: 0,
    nextCheckAt: state.campaign.gameTime + Math.max(1, def.onsetHours) * 60,
    symptoms: def.stages[0]?.symptoms ?? [],
    cured: false,
  };
  drafts.push(draft("DiseaseInfected", { actorId, disease: instance }, "engine"));
  drafts.push(
    draft(
      "SurvivalNotice",
      {
        notice: {
          id: `notice:${state.campaign.gameTime}:sick:${diseaseId}`,
          at: state.campaign.gameTime,
          kind: "disease",
          text: `You have caught the ${def.name.toLowerCase()}.`,
        },
      },
      "engine",
    ),
  );
  return ok(drafts);
}

const diseaseDef = (_state: GameState, ctx: SurvivalContext, instance: DiseaseInstance) => {
  const def = ctx.diseases?.[instance.diseaseId];
  if (def) return def;
  const local = localIdOf(instance.diseaseId);
  return Object.values(ctx.diseases ?? {}).find((d) => localIdOf(d.id) === local) ?? null;
};

/** Applies and clears a disease stage's conditions. */
function syncDiseaseConditions(
  w: Working,
  actorId: ActorId,
  def: DiseaseDef,
  previous: number,
  next: number,
): void {
  const present = new Set(w.state.actors[actorId]?.sheet.status.conditions.map((c) => c.id) ?? []);
  const old = def.stages[previous];
  const fresh = def.stages[next];
  for (const c of old?.conditions ?? []) {
    if (!fresh?.conditions.some((x) => x.id === c.id) && present.has(c.id))
      w.apply(unwrap(removeCondition(w.state, actorId, c.id)));
  }
  for (const c of fresh?.conditions ?? [])
    w.apply(
      unwrap(
        applyCondition(w.state, actorId, { id: c.id, ...(c.level !== undefined ? { level: c.level } : {}) }),
      ),
    );
}

/** Advances every active disease one check, and passes contagious ones to close company. */
export function progressDiseases(w: Working, ctx: SurvivalContext): void {
  const now = w.state.campaign.gameTime;
  const survival = survivalSlice(w.state);
  const rng = new Rng(w.state.campaign.rngState);
  let rolled = false;
  const party = [w.state.party.pcId, ...w.state.party.companionIds].filter((x): x is string => !!x);
  for (const actorId of party) {
    for (const instance of survival.diseases[actorId] ?? []) {
      if (instance.cured) continue;
      const def = diseaseDef(w.state, ctx, instance);
      if (!def) continue;
      if (now < instance.nextCheckAt) continue;
      const stage = def.stages[instance.stage];
      if (!stage) {
        // Past the last stage: recovery runs out and the disease clears.
        w.apply([draft("DiseaseCured", { actorId, instanceId: instance.id, cure: "rest" }, "engine")]);
        addNotice(w, "disease", `The ${def.name.toLowerCase()} has passed.`);
        continue;
      }
      const check = stage.check
        ? resolveCheck(
            w.state,
            {
              actorId,
              skill: { attribute: "end" },
              difficulty: stage.check,
              purpose: `resist ${def.name}`,
              tags: ["resist"],
            },
            ctx,
          )
        : null;
      if (check) {
        if (!check.ok) continue;
        w.apply(check.value.events);
      }
      const resisted = check ? isSuccess(check.value.effective.degree) : false;
      if (resisted) {
        w.apply([
          draft(
            "DiseaseProgressed",
            {
              actorId,
              instanceId: instance.id,
              stage: instance.stage,
              symptoms: instance.symptoms,
              nextCheckAt: now + 1440,
            },
            "engine",
          ),
        ]);
        continue;
      }
      const next = instance.stage + 1;
      const symptoms = def.stages
        .slice(0, next)
        .flatMap((s) => s.symptoms)
        .filter((x, i, all) => all.indexOf(x) === i);
      syncDiseaseConditions(w, actorId, def, instance.stage, Math.min(next, def.stages.length - 1));
      w.apply([
        draft(
          "DiseaseProgressed",
          {
            actorId,
            instanceId: instance.id,
            stage: next,
            symptoms,
            nextCheckAt: now + (next >= def.stages.length ? Math.max(1, def.recoveryDays) * 1440 : 1440),
          },
          "engine",
        ),
      ]);
      if ((stage.damage ?? 0) > 0) {
        const hp = w.state.actors[actorId]?.sheet.status.hp ?? 0;
        const damage = Math.min(stage.damage, hp);
        if (damage > 0)
          w.apply([
            draft("HpChanged", { actorId, hp: hp - damage, delta: -damage, cause: "survival" }, "engine"),
          ]);
      }
      if (stage.contagious && def.contagion.chance > 0) {
        for (const other of party) {
          if (other === actorId) continue;
          if (rng.int(1, 1000) > def.contagion.chance * 1000) continue;
          rolled = true;
          if ((survival.diseases[other] ?? []).some((d) => d.diseaseId === def.id && !d.cured)) continue;
          w.apply([
            draft(
              "DiseaseInfected",
              {
                actorId: other,
                disease: {
                  id: `disease:${other}:${now}:${def.id}`,
                  diseaseId: def.id,
                  actorId: other,
                  infectedAt: now,
                  stage: 0,
                  nextCheckAt: now + Math.max(1, def.onsetHours) * 60,
                  symptoms: def.stages[0]?.symptoms ?? [],
                  cured: false,
                },
              },
              "engine",
            ),
          ]);
          addNotice(w, "disease", `The ${def.name.toLowerCase()} passes to someone close.`);
        }
      }
    }
  }
  if (rolled)
    w.apply([
      draft(
        "SurvivalNeedsUpdated",
        {
          actorId: w.state.party.pcId!,
          needs: needsOf(w.state, w.state.party.pcId!),
          reason: "disease spread",
          rngAfter: [...rng.state],
        },
        "engine",
      ),
    ]);
}

/** Cures one disease instance with a named cure (rest, herb, medicine or prayer). */
export function cureDisease(
  state: GameState,
  actorId: ActorId,
  instanceId: string,
  cure: string,
): Result<EventDraft[]> {
  const instance = (survivalSlice(state).diseases[actorId] ?? []).find((d) => d.id === instanceId);
  if (!instance) return fail("DISEASE_UNKNOWN", `No disease ${instanceId} on ${actorId}`);
  return ok([draft("DiseaseCured", { actorId, instanceId, cure }, "engine")]);
}

// ── Foraging and hunting ────────────────────────────────────────────────────────────────────────

export type ForageResult = {
  events: EventDraft[];
  degree: CheckOutcome["effective"]["degree"];
  gained: number;
};

/**
 * Forages or hunts (spec 11: Survival checks by region and season). A success brings rations;
 * winter and barren ground make it harder.
 */
export function forage(
  state: GameState,
  actorId: ActorId,
  o: { season: string; hunting?: boolean; barren?: boolean },
  ctx: SurvivalContext,
): Result<ForageResult> {
  if (!state.actors[actorId]) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  const f = ctx.tuning.survival.forage;
  const LADDER = ["easy", "normal", "hard", "extreme", "heroic"] as const;
  const base = o.hunting ? f.huntDifficulty : f.difficulty;
  const start = LADDER.indexOf(base);
  const shift = (f.seasonShift[o.season] ?? 0) + (o.barren ? 1 : 0);
  const difficulty = LADDER[Math.max(0, Math.min(LADDER.length - 1, start + shift))]!;
  const out = resolveCheck(
    state,
    {
      actorId,
      skill: "core:survival",
      difficulty,
      purpose: o.hunting ? "hunt for food" : "forage for food",
      tags: ["survival"],
    },
    ctx,
  );
  if (!out.ok) return out;
  const degree = out.value.effective.degree;
  const events = [...out.value.events];
  const rng = new Rng(state.campaign.rngState);
  let gained = 0;
  if (isSuccess(degree)) {
    const [lo, hi] = degree === "critSuccess" ? f.critYield : f.yield;
    gained = rng.int(lo, hi);
    events.push(
      draft(
        "SuppliesGained",
        {
          actorId,
          itemId:
            Object.keys(ctx.items?.gear ?? {}).find((id) => supplyKindOf(id, ctx) === "food") ??
            "core:rations",
          kind: "food",
          qty: gained,
          notice: o.hunting ? `The hunt brings ${gained} days' meat.` : `You gather ${gained} days' food.`,
        },
        "engine",
      ),
    );
  } else {
    events.push(
      draft(
        "SurvivalNotice",
        {
          notice: {
            id: `notice:${state.campaign.gameTime}:forage`,
            at: state.campaign.gameTime,
            kind: "need",
            text: o.hunting ? "The hunt comes back empty." : "You find nothing worth eating.",
          },
        },
        "engine",
      ),
    );
  }
  return ok({ events, degree, gained });
}

// ── Language ───────────────────────────────────────────────────────────────────────────────────

/** A Language check against an unknown tongue (spec 11, Language barriers). */
export function languageCheck(
  state: GameState,
  actorId: ActorId,
  language: string,
  ctx: SurvivalContext,
): Result<CheckOutcome> {
  if (!state.actors[actorId]) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  const slug = language
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return resolveCheck(
    state,
    {
      actorId,
      skill: `core:language/${slug || "unknown"}`,
      difficulty: ctx.tuning.survival.language.checkDifficulty,
      purpose: `understand ${language}`,
      tags: ["language"],
    },
    ctx,
  );
}

/** An Insight check to read gestures and tone when no words are shared. */
export function gesturesCheck(
  state: GameState,
  actorId: ActorId,
  ctx: SurvivalContext,
): Result<CheckOutcome> {
  if (!state.actors[actorId]) return fail("ACTOR_UNKNOWN", `No actor ${actorId}`);
  return resolveCheck(
    state,
    {
      actorId,
      skill: "core:insight",
      difficulty: ctx.tuning.survival.language.insightDifficulty,
      purpose: "read gestures and tone",
      tags: ["language", "sight"],
    },
    ctx,
  );
}

/** The PC's languages: the sheet's, or the trade tongue when creation didn't record any. */
export function languagesOf(state: GameState, actorId: ActorId, ctx: SurvivalContext): string[] {
  const sheet = state.actors[actorId]?.sheet;
  if (!sheet) return [];
  return sheet.languages.length ? sheet.languages : [ctx.tuning.survival.language.commonTongue];
}

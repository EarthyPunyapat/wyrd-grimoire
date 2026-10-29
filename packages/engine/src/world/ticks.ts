import {
  type ActorId,
  type CalendarDef,
  type DiseaseDef,
  draft,
  Entity,
  type EventDraft,
  type Fact,
  festivalsOn,
  type ItemCatalog,
  type NamingStyleDef,
  Rng,
  type Rumor,
  type Tuning,
} from "@wyrd/core";
import { advanceCanon } from "../canon-clocks.ts";
import { advanceDelegations } from "../delegation.ts";
import { healingDaily } from "../injury/healing.ts";
import type { GameState, RulesContext } from "../state.ts";
import { survivalDaily } from "../survival.ts";
import { Working } from "../working.ts";

/** An NPC the living tick may marry, retire or bury (the caller supplies canon; the engine is pure). */
export type WorldNpc = {
  id: string;
  name: string;
  /** Years; missing means adult but never old enough to die of age. */
  age?: number;
  role?: string;
  factionId?: string;
};

/** What world ticks need from canon (the caller supplies it; the engine never reads storage). */
export type WorldContext = RulesContext & {
  nameOf: (id: string) => string;
  factsAbout?: (id: string) => Fact[];
  entityActive?: (id: string) => boolean;
  /** Regions with their climate; `current` marks the open scene's region (its weather shows in the scene). */
  regions?: () => Array<{ id: string; climate: string; current?: boolean }>;
  /** Pack calendar; absent means the tuning calendar (spec 06, Time and calendar). */
  calendar?: CalendarDef;
  /** NPCs the weekly Living World tick can give life events to. */
  npcs?: () => WorldNpc[];
  /** Naming styles from the pack, for births. */
  naming?: NamingStyleDef[];
  /** Names already in canon, so a birth avoids an exact duplicate. */
  namesTaken?: () => string[];
  /** Pack items, for survival tags (food, water, light, warm). */
  items?: ItemCatalog;
  /** Pack diseases by namespaced id. */
  diseases?: Record<string, DiseaseDef>;
};

const MINUTES = { hour: 60, day: 1440, week: 10080 } as const;

export type CalendarDate = {
  year: number;
  month: number;
  monthName: string;
  day: number;
  hour: number;
  minute: number;
  season: string;
  timeOfDay: "night" | "dawn" | "day" | "dusk";
  dayNumber: number;
  /** 1-based day of the year (for festivals). */
  dayOfYear: number;
  /** Weekday name from a pack calendar; empty with the tuning fallback. */
  weekday: string;
  /** The festival on this day, if any. */
  festival?: string;
};

/** Calendar view of game time (spec 06, Time and calendar). Day 1, month 1, year 1 is minute 0. */
export function calendarOf(gameTime: number, t: Tuning["world"], cal?: CalendarDef): CalendarDate {
  const dayNumber = Math.floor(gameTime / MINUTES.day);
  const minuteOfDay = gameTime % MINUTES.day;
  const hour = Math.floor(minuteOfDay / 60);
  const timeOfDay: CalendarDate["timeOfDay"] =
    hour === t.dawn ? "dawn" : hour === t.dusk ? "dusk" : hour > t.dawn && hour < t.dusk ? "day" : "night";
  const time = { hour, minute: minuteOfDay % 60, timeOfDay, dayNumber };
  if (cal) {
    const yearDays = cal.months.reduce((sum, m) => sum + m.days, 0);
    const year = Math.floor(dayNumber / yearDays) + 1;
    const dayOfYear = (dayNumber % yearDays) + 1;
    let start = 1;
    let monthIndex = 0;
    for (let i = 0; i < cal.months.length; i++) {
      const m = cal.months[i]!;
      if (dayOfYear < start + m.days) {
        monthIndex = i;
        break;
      }
      start += m.days;
      monthIndex = i;
    }
    const month = cal.months[monthIndex]!;
    const festival = festivalsOn(cal, dayOfYear)[0];
    return {
      year,
      month: monthIndex + 1,
      monthName: month.name,
      day: dayOfYear - start + 1,
      season: month.season,
      dayOfYear,
      weekday: cal.days[dayNumber % cal.days.length] ?? "",
      ...(festival ? { festival: festival.name } : {}),
      ...time,
    };
  }
  const daysPerYear = t.daysPerMonth * t.monthNames.length;
  const dayOfYear = (dayNumber % daysPerYear) + 1;
  const month = Math.floor((dayOfYear - 1) / t.daysPerMonth);
  return {
    year: Math.floor(dayNumber / daysPerYear) + 1,
    month: month + 1,
    monthName: t.monthNames[month] ?? `Month ${month + 1}`,
    day: ((dayOfYear - 1) % t.daysPerMonth) + 1,
    season: t.seasons[month] ?? "",
    dayOfYear,
    weekday: "",
    ...time,
  };
}

/** "the 3rd of Harvest, evening" style, for prompts and the journal. */
export function describeDate(gameTime: number, t: Tuning["world"], cal?: CalendarDef): string {
  const c = calendarOf(gameTime, t, cal);
  const n = c.day;
  const suffix =
    n % 10 === 1 && n !== 11
      ? "st"
      : n % 10 === 2 && n !== 12
        ? "nd"
        : n % 10 === 3 && n !== 13
          ? "rd"
          : "th";
  return `${n}${suffix} of ${c.monthName}, year ${c.year}, ${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")} (${c.timeOfDay})`;
}

/**
 * Who first carries news (spec 06 world events → rumours): the faction's members, or, failing
 * that, a few people the world places somewhere, so the news can travel and reach the PC.
 */
function seedHolders(state: GameState, factionId?: string): Rumor["holders"] {
  const at = state.campaign.gameTime;
  const members = factionId
    ? state.edges.filter((e) => e.type === "memberOf" && e.to === factionId).map((e) => e.from)
    : [];
  const locals = state.edges
    .filter((e) => e.type === "locatedIn" && e.from.startsWith("npc:"))
    .map((e) => e.from);
  const ids = (members.length ? members : locals).slice(0, 4);
  return Object.fromEntries(ids.map((id) => [id, { content: "", at }]));
}

const withContent = (h: Rumor["holders"], content: string) =>
  Object.fromEntries(Object.entries(h).map(([id, v]) => [id, { ...v, content }]));

const SOCIAL = new Set(["family", "friend", "employs", "reportsTo", "knows", "memberOf"]);

/** People a holder passes rumours to, with the edge strength and type (memberOf links co-members). */
function contacts(state: GameState, id: ActorId): Array<{ to: string; strength: number; type: string }> {
  const out: Array<{ to: string; strength: number; type: string }> = [];
  for (const e of state.edges) {
    if (!SOCIAL.has(e.type)) continue;
    if (e.type === "memberOf") {
      if (e.from !== id) continue;
      for (const m of state.edges)
        if (m.type === "memberOf" && m.to === e.to && m.from !== id)
          out.push({ to: m.from, strength: Math.min(e.strength, m.strength) * 0.5, type: "memberOf" });
      continue;
    }
    if (e.from === id) out.push({ to: e.to, strength: e.strength, type: e.type });
    else if (e.to === id) out.push({ to: e.from, strength: e.strength, type: e.type });
  }
  return out;
}

/** LLM-free degradation of a rumour as it passes on (spec 07): names dropped, numbers inflated. */
function distort(content: string, rng: Rng, about: string[], nameOf: (id: string) => string): string {
  const roll = rng.int(1, 3);
  if (roll === 1) {
    for (const id of about) content = content.replaceAll(nameOf(id), "someone");
    return content;
  }
  if (roll === 2) return content.replace(/\b(\d+)\b/g, (n) => String(Number(n) * 2 + 1));
  return `${content.replace(/\.$/, "")}, or so they say.`;
}

function spreadRumours(w: Working, rng: Rng, ctx: WorldContext) {
  const t = ctx.tuning.world;
  for (const r of Object.values(w.state.rumors)) {
    if (r.heat < 0.05) continue;
    for (const [holder, version] of Object.entries(r.holders)) {
      for (const c of contacts(w.state, holder)) {
        if (w.state.rumors[r.id]!.holders[c.to]) continue;
        const fast = r.urgent && c.type === "reportsTo" ? t.urgentReportsToFactor : 1;
        const p = Math.min(0.95, r.heat * c.strength * (1 - r.secrecy) * fast);
        if (rng.int(1, 1000) > p * 1000) continue;
        const distorted = rng.int(1, 1000) <= t.rumourDistortChance * 1000;
        const content = distorted ? distort(version.content, rng, r.about, ctx.nameOf) : version.content;
        const trust = w.state.minds[c.to]?.dispositions[holder]?.trust ?? 50;
        w.apply([
          draft("RumorHeard", { rumorId: r.id, holderId: c.to, content, fromId: holder }, "engine"),
          draft(
            "MemoryRecorded",
            {
              memory: {
                id: `mem:${r.id}:${c.to}`,
                npcId: c.to,
                gameTime: w.state.campaign.gameTime,
                kind: "heard",
                content: `${ctx.nameOf(holder)} told me: ${content}`,
                about: r.about,
                importance: r.urgent ? 4 : 2,
                feeling: 0,
                belief: Math.round((trust / 100) * 100) / 100,
                sourceId: holder,
                ...(r.truth.accuracy === "false" ? { false: true } : {}),
              },
            },
            "engine",
          ),
        ]);
      }
    }
    const cooled: Rumor = {
      ...w.state.rumors[r.id]!,
      heat: Math.round(r.heat * t.rumourDailyHeatDecay * 1000) / 1000,
    };
    w.apply([draft("RumorCreated", { rumor: cooled }, "engine")]);
  }
}

function factionGoals(w: Working, rng: Rng, ctx: WorldContext) {
  for (const f of Object.values(w.state.factions)) {
    const power = (f.resources.wealth + f.resources.military + f.resources.influence) / 3;
    for (const clockId of f.goalClockIds) {
      const c = w.state.clocks[clockId];
      if (!c || c.filled >= c.segments) continue;
      if (rng.int(1, 1000) <= ctx.tuning.world.factionGoalChancePerResource * power * 1000)
        w.apply([
          draft(
            "ClockAdvanced",
            { clockId, by: 1, reason: `${ctx.nameOf(f.id)} works toward its goal` },
            "engine",
          ),
        ]);
    }
  }
}

/** The Threat Clock advances with time (spec 06); each stage changes the world and spawns news. */
function threatPace(w: Working, dayNumber: number, ctx: WorldContext) {
  const threat = w.state.threat;
  if (!threat || threat.defeated || w.state.campaign.settings.story.mode !== "threatClock") return;
  const clock = w.state.clocks[threat.clockId];
  if (!clock || clock.filled >= clock.segments) return;
  const pace = clock.paceDays ?? ctx.tuning.world.threatPaceDays;
  if (dayNumber % pace !== 0) return;
  w.apply([
    draft("ClockAdvanced", { clockId: clock.id, by: 1, reason: `${threat.name} advances` }, "engine"),
  ]);
  const filled = w.state.clocks[clock.id]!.filled;
  const stage = Math.floor((filled * threat.stages) / clock.segments);
  if (stage > threat.stage) {
    const summary = `${threat.name} reaches stage ${stage} of ${threat.stages}.`;
    w.apply([draft("ThreatAdvanced", { stage, defeated: false, summary }, "engine")]);
    w.apply([
      draft(
        "RumorCreated",
        {
          rumor: {
            id: `rumor:threat-${stage}`,
            content: `Word is spreading: ${threat.name} grows stronger.`,
            about: threat.agentFactionId ? [threat.agentFactionId] : [],
            truth: { accuracy: "true" },
            heat: 0.8,
            secrecy: 0,
            createdAt: w.state.campaign.gameTime,
            urgent: true,
            holders: withContent(
              seedHolders(w.state, threat.agentFactionId),
              `Word is spreading: ${threat.name} grows stronger.`,
            ),
          },
        },
        "engine",
      ),
    ]);
  }
}

function weather(w: Working, rng: Rng, ctx: WorldContext) {
  for (const r of ctx.regions?.() ?? []) {
    const options =
      ctx.tuning.world.weatherByClimate[r.climate] ?? ctx.tuning.world.weatherByClimate.temperate!;
    const pick = options[rng.int(0, options.length - 1)]!;
    w.apply([draft("WeatherSet", { regionId: r.id, weather: pick }, "engine")]);
    if (r.current) w.apply([draft("WeatherSet", { regionId: "scene", weather: pick }, "engine")]);
  }
}

/** Weekly: finished faction goals become news and the clock starts over (spec 06, World simulation). */
function weekly(w: Working, ctx: WorldContext) {
  for (const f of Object.values(w.state.factions)) {
    for (const clockId of f.goalClockIds) {
      const c = w.state.clocks[clockId];
      if (!c || c.filled < c.segments) continue;
      w.apply([
        draft(
          "ClockAdvanced",
          { clockId, by: -c.segments, reason: "goal achieved; a new one begins" },
          "engine",
        ),
        draft(
          "RumorCreated",
          {
            rumor: {
              id: `rumor:${clockId}:${w.state.campaign.gameTime}`,
              content: `${ctx.nameOf(f.id)} has achieved its aim: ${c.name}.`,
              about: [f.id],
              truth: { accuracy: "true" },
              heat: 0.6,
              secrecy: 0.1,
              createdAt: w.state.campaign.gameTime,
              urgent: false,
              holders: withContent(
                seedHolders(w.state, f.id),
                `${ctx.nameOf(f.id)} has achieved its aim: ${c.name}.`,
              ),
            },
          },
          "engine",
        ),
      ]);
    }
  }
}

type NewsKind = "faction" | "festival" | "life" | "downtime" | "threat" | "world";

/**
 * Publishes one news item (spec 06): an event, plus the rumour that carries it so the player can
 * hear it from an NPC or while carousing. News is public; the journal shows what the PC has heard.
 */
function publishNews(
  w: Working,
  ctx: WorldContext,
  input: { headline: string; body: string; kind: NewsKind; about?: string[] },
) {
  const at = w.state.campaign.gameTime;
  const about = input.about ?? [];
  const n = Object.keys(w.state.living?.news ?? {}).length + 1;
  const id = `news:${at}:${input.kind}:${n}`;
  const rumorId = `rumor:${id}`;
  const holders = withContent(
    seedHolders(
      w.state,
      about.find((x) => w.state.factions[x]),
    ),
    input.body,
  );
  w.apply([
    draft(
      "RumorCreated",
      {
        rumor: {
          id: rumorId,
          content: input.body,
          about,
          truth: { accuracy: "true" },
          heat: input.kind === "threat" ? 0.8 : 0.6,
          secrecy: 0,
          createdAt: at,
          urgent: input.kind === "threat",
          holders,
        },
      },
      "engine",
    ),
    draft(
      "NewsPublished",
      {
        item: {
          id,
          headline: input.headline,
          body: input.body,
          at,
          kind: input.kind,
          about,
          rumorId,
        },
        keep: ctx.tuning.living.maxNews,
      },
      "engine",
    ),
  ]);
}

/** Calendar festivals fire on their day (Living World and Threat Clock alike, spec 06). */
function festivals(w: Working, ctx: WorldContext, dayNumber: number) {
  const cal = ctx.calendar;
  if (!cal) return;
  const date = calendarOf(dayNumber * MINUTES.day, ctx.tuning.world, cal);
  const held = new Set(w.state.living?.festivalsHeld ?? []);
  for (const f of festivalsOn(cal, date.dayOfYear)) {
    const key = `${f.id}:${date.year}`;
    if (held.has(key)) continue;
    held.add(key);
    w.apply([
      draft(
        "FestivalStarted",
        {
          festivalId: f.id,
          name: f.name,
          key,
          at: dayNumber * MINUTES.day,
          summary: f.description,
        },
        "engine",
      ),
    ]);
    publishNews(w, ctx, {
      headline: `${f.name} begins`,
      body: f.description || `${f.name} is held today.`,
      kind: "festival",
    });
  }
}

/** A name for a newborn from the pack's naming styles, avoiding exact duplicates in canon. */
function birthName(ctx: WorldContext, rng: Rng): string {
  const styles = ctx.naming ?? [];
  const taken = new Set((ctx.namesTaken?.() ?? []).map((n) => n.toLowerCase()));
  if (!styles.length) return "Newborn";
  for (let attempt = 0; attempt < 10; attempt++) {
    const style = styles[rng.int(0, styles.length - 1)]!;
    const given = style.given[rng.int(0, style.given.length - 1)]!;
    const family = style.family.length ? style.family[rng.int(0, style.family.length - 1)]! : "";
    const pattern = style.patterns[rng.int(0, style.patterns.length - 1)] ?? "{given} {family}";
    const name = pattern
      .replaceAll("{given}", given)
      .replaceAll("{family}", family)
      .replaceAll("{place}", "")
      .replace(/\s+/g, " ")
      .trim();
    if (name && !taken.has(name.toLowerCase())) return name;
  }
  return "The Younger";
}

/** A faction's goal progress for a week: its resources against the rivals it is feuding with. */
/**
 * A completed faction goal becomes news, and the faction gets a fresh aim (spec 06, World
 * simulation). Completion is noticed weekly; daily ticks only move the clock.
 */
function completeGoal(
  w: Working,
  rng: Rng,
  ctx: WorldContext,
  factionId: string,
  clockId: string,
  dayNumber: number,
) {
  const done = w.state.clocks[clockId];
  const faction = w.state.factions[factionId];
  if (!done || !faction) return;
  publishNews(w, ctx, {
    headline: `${ctx.nameOf(factionId)} completes "${done.name}"`,
    body: `${ctx.nameOf(factionId)} has achieved its aim: ${done.name}.`,
    kind: "faction",
    about: [factionId],
  });
  const t = ctx.tuning.living;
  const week = Math.floor(dayNumber / 7);
  const segments = rng.int(t.goalSegments.min, t.goalSegments.max);
  const name = t.goalNames[rng.int(0, t.goalNames.length - 1)] ?? "a new aim";
  const newId = `clock:goal:${factionId}:${week}:${rng.int(1, 9999)}`;
  w.apply([
    draft(
      "ClockCreated",
      {
        clock: { id: newId, name, kind: "faction", segments, filled: 0, ownerId: factionId, visible: false },
      },
      "engine",
    ),
    draft(
      "FactionUpdated",
      {
        faction: {
          ...faction,
          goalClockIds: [...faction.goalClockIds.filter((id) => id !== clockId), newId],
        },
      },
      "engine",
    ),
  ]);
}

function livingFactionGoals(w: Working, rng: Rng, ctx: WorldContext, dayNumber: number) {
  const t = ctx.tuning.living;
  const factions = Object.values(w.state.factions);
  for (const f of factions) {
    const power = (f.resources.wealth + f.resources.military + f.resources.influence) / 3;
    const rivals = factions.filter((o) => o.id !== f.id && (f.relations[o.id] ?? 0) < 0);
    const opposition = rivals.length
      ? rivals.reduce(
          (sum, o) => sum + (o.resources.wealth + o.resources.military + o.resources.influence) / 3,
          0,
        ) / rivals.length
      : t.oppositionBaseline;
    const chance = Math.min(0.95, t.goalChance * (power / (power + opposition)));
    for (const clockId of [...f.goalClockIds]) {
      const c = w.state.clocks[clockId];
      if (!c) continue;
      // Daily ticks move clocks; the weekly pass completes the full ones.
      if (c.filled >= c.segments) {
        completeGoal(w, rng, ctx, f.id, clockId, dayNumber);
        continue;
      }
      // A weekly nudge also covers long skips, where daily ticks were capped.
      if (rng.int(1, 1000) > chance * 1000) continue;
      w.apply([
        draft(
          "ClockAdvanced",
          { clockId, by: 1, reason: `${ctx.nameOf(f.id)} works toward its goal` },
          "engine",
        ),
      ]);
      const done = w.state.clocks[clockId]!;
      if (done.filled >= done.segments) completeGoal(w, rng, ctx, f.id, clockId, dayNumber);
    }
  }
}

/** One marriage, birth, retirement or death of old age a week (Living World, spec 06). */
function livingNpcEvents(w: Working, rng: Rng, ctx: WorldContext) {
  const canonActors = (w.state.flags.canonActors ?? {}) as Record<string, unknown>;
  const npcs = (ctx.npcs?.() ?? []).filter((n) => !canonActors[n.id]);
  if (!npcs.length) return;
  if (rng.int(1, 1000) > ctx.tuning.living.lifeEventChance * 1000) return;
  const at = w.state.campaign.gameTime;
  const lives = w.state.living?.lives ?? {};
  const alive = npcs.filter((n) => !lives[n.id]?.dead);
  if (!alive.length) return;
  const ageOf = (n: WorldNpc) => n.age ?? 30;
  const old = alive.filter((n) => ageOf(n) >= ctx.tuning.living.oldAge);
  const unmarried = alive.filter((n) => !lives[n.id]?.marriedTo && !lives[n.id]?.retired);
  const married = alive.filter((n) => lives[n.id]?.marriedTo);

  const news = (headline: string, body: string, about: string[]) =>
    publishNews(w, ctx, { headline, body, kind: "life", about });

  if (old.length && rng.int(1, 1000) <= 700) {
    const npc = old[rng.int(0, old.length - 1)]!;
    const age = ageOf(npc);
    w.apply([
      draft(
        "NpcLifeEvent",
        { kind: "death", npcId: npc.id, age, at, summary: `${npc.name} dies of old age, aged ${age}.` },
        "engine",
      ),
      draft("EntityUpdated", { entityId: npc.id, patch: { status: "dead" } }, "engine"),
    ]);
    news(`${npc.name} dies`, `${npc.name} has died of old age, aged ${age}.`, [npc.id]);
    return;
  }
  if (unmarried.length >= 2 && rng.int(1, 1000) <= 600) {
    const a = unmarried[rng.int(0, unmarried.length - 1)]!;
    const rest = unmarried.filter((n) => n.id !== a.id);
    const b = rest[rng.int(0, rest.length - 1)]!;
    const summary = `${a.name} and ${b.name} are married.`;
    w.apply([
      draft("NpcLifeEvent", { kind: "marriage", npcId: a.id, otherId: b.id, at, summary }, "engine"),
      draft(
        "FactAsserted",
        {
          fact: {
            id: `fact:${a.id}:married:${at}`,
            entityId: a.id,
            predicate: "marriedTo",
            value: b.id,
            source: "engine",
            visibility: "public",
            importance: 2,
          },
        },
        "engine",
      ),
      draft(
        "FactAsserted",
        {
          fact: {
            id: `fact:${b.id}:married:${at}`,
            entityId: b.id,
            predicate: "marriedTo",
            value: a.id,
            source: "engine",
            visibility: "public",
            importance: 2,
          },
        },
        "engine",
      ),
    ]);
    news(`${a.name} and ${b.name} wed`, summary, [a.id, b.id]);
    return;
  }
  if (married.length && rng.int(1, 1000) <= 500) {
    const parent = married[rng.int(0, married.length - 1)]!;
    const otherId = lives[parent.id]?.marriedTo;
    const other = otherId ? alive.find((n) => n.id === otherId) : undefined;
    if (other) {
      const childId = `npc:born:${at}`;
      const name = birthName(ctx, rng);
      const summary = `${parent.name} and ${other.name} have a child, ${name}.`;
      w.apply([
        draft(
          "EntityCreated",
          {
            entity: Entity.parse({
              id: childId,
              kind: "npc",
              name,
              detail: "stub",
              summary: `The newborn child of ${parent.name} and ${other.name}.`,
              data: { age: 0, bornTo: [parent.id, other.id] },
              importance: 1,
            }),
          },
          "engine",
        ),
        draft(
          "NpcLifeEvent",
          { kind: "birth", npcId: parent.id, otherId: other.id, childId, at, summary },
          "engine",
        ),
      ]);
      news(`${name} is born`, summary, [parent.id, other.id, childId]);
      return;
    }
  }
  const working = alive.filter((n) => n.role && !lives[n.id]?.retired);
  if (working.length && rng.int(1, 1000) <= 500) {
    const npc = working[rng.int(0, working.length - 1)]!;
    const age = ageOf(npc);
    const summary = `${npc.name} retires from ${npc.role}.`;
    w.apply([
      draft("NpcLifeEvent", { kind: "retirement", npcId: npc.id, age, at, summary }, "engine"),
      draft(
        "FactAsserted",
        {
          fact: {
            id: `fact:${npc.id}:retired:${at}`,
            entityId: npc.id,
            predicate: "retired",
            value: true,
            source: "engine",
            visibility: "public",
            importance: 1,
          },
        },
        "engine",
      ),
    ]);
    news(`${npc.name} retires`, summary, [npc.id]);
  }
}

/** Weekly job board refresh (Living World): a few optional leads, no obligation to take them. */
function livingJobBoard(w: Working, rng: Rng, ctx: WorldContext, dayNumber: number) {
  const t = ctx.tuning.living;
  const at = w.state.campaign.gameTime;
  const week = Math.floor(dayNumber / 7);
  const factions = Object.values(w.state.factions);
  const count = rng.int(t.jobBoard.min, t.jobBoard.max);
  const jobs = Array.from({ length: count }, (_, i) => {
    const title = t.jobTitles[rng.int(0, t.jobTitles.length - 1)] ?? "A job on the board";
    const faction = factions.length ? factions[rng.int(0, factions.length - 1)] : undefined;
    return {
      id: `job:${week}:${i}`,
      title,
      summary: faction
        ? `${faction.id ? ctx.nameOf(faction.id) : "Someone"} is hiring: ${title.toLowerCase()}.`
        : `Posted on the board: ${title.toLowerCase()}.`,
      ...(faction ? { factionId: faction.id } : {}),
      postedAt: at,
      rewardCoins: rng.int(2, 12),
    };
  });
  w.apply([draft("JobBoardRefreshed", { jobs: jobs.slice(0, t.maxJobBoard) }, "engine")]);
}

/** The Living World weekly tick: goals, life events and the job board (spec 06). */
function livingWeekly(w: Working, rng: Rng, ctx: WorldContext, dayNumber: number) {
  livingFactionGoals(w, rng, ctx, dayNumber);
  livingNpcEvents(w, rng, ctx);
  livingJobBoard(w, rng, ctx, dayNumber);
}

/**
 * Runs every hourly, daily and weekly boundary crossed since the last tick (spec 06). Long skips
 * run at most `maxDailyTicks` daily ticks. Seeded choices store `rngAfter` in TickCompleted.
 */
export function runTicks(state: GameState, ctx: WorldContext): EventDraft[] {
  const w = new Working(state);
  const now = state.campaign.gameTime;
  const last = state.calendar.lastTick;
  const days = Math.floor(now / MINUTES.day) - Math.floor(last.day / MINUTES.day);
  if (days > 0) {
    const first = Math.floor(now / MINUTES.day) - Math.min(days, ctx.tuning.world.maxDailyTicks) + 1;
    for (let d = first; d <= Math.floor(now / MINUTES.day); d++) {
      w.apply(advanceDelegations(w.state, ctx, d * MINUTES.day));
      const rng = new Rng(w.state.campaign.rngState);
      spreadRumours(w, rng, ctx);
      factionGoals(w, rng, ctx);
      threatPace(w, d, ctx);
      w.apply(advanceCanon(w.state, d * MINUTES.day, ctx.factsAbout, ctx.entityActive));
      weather(w, rng, ctx);
      festivals(w, ctx, d);
      survivalDaily(w, ctx, d);
      healingDaily(w, ctx, rng, d);
      w.apply([
        draft("TickCompleted", { kind: "day", at: d * MINUTES.day, rngAfter: [...rng.state] }, "engine"),
      ]);
      if (d % 7 === 0) {
        // Living World completes goals (and publishes news) before the generic weekly pass.
        if (w.state.campaign.settings.story.mode === "livingWorld") livingWeekly(w, rng, ctx, d);
        weekly(w, ctx);
        w.apply([draft("TickCompleted", { kind: "week", at: d * MINUTES.day }, "engine")]);
      }
    }
  }
  w.apply(advanceDelegations(w.state, ctx));
  if (Math.floor(now / MINUTES.hour) > Math.floor(w.state.calendar.lastTick.hour / MINUTES.hour))
    w.apply([draft("TickCompleted", { kind: "hour", at: now }, "engine")]);
  return w.events;
}

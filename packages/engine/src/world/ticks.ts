import { type ActorId, draft, type EventDraft, Rng, type Rumor, type Tuning } from "@wyrd/core";
import type { GameState, RulesContext } from "../state.ts";
import { Working } from "../working.ts";

/** What world ticks need from canon (the caller supplies it; the engine never reads storage). */
export type WorldContext = RulesContext & {
  nameOf: (id: string) => string;
  /** Regions with their climate; `current` marks the open scene's region (its weather shows in the scene). */
  regions?: () => Array<{ id: string; climate: string; current?: boolean }>;
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
};

/** Calendar view of game time (spec 06, Time and calendar). Day 1, month 1, year 1 is minute 0. */
export function calendarOf(gameTime: number, t: Tuning["world"]): CalendarDate {
  const dayNumber = Math.floor(gameTime / MINUTES.day);
  const minuteOfDay = gameTime % MINUTES.day;
  const hour = Math.floor(minuteOfDay / 60);
  const daysPerYear = t.daysPerMonth * t.monthNames.length;
  const dayOfYear = dayNumber % daysPerYear;
  const month = Math.floor(dayOfYear / t.daysPerMonth);
  const timeOfDay =
    hour === t.dawn ? "dawn" : hour === t.dusk ? "dusk" : hour > t.dawn && hour < t.dusk ? "day" : "night";
  return {
    year: Math.floor(dayNumber / daysPerYear) + 1,
    month: month + 1,
    monthName: t.monthNames[month] ?? `Month ${month + 1}`,
    day: (dayOfYear % t.daysPerMonth) + 1,
    hour,
    minute: minuteOfDay % 60,
    season: t.seasons[month] ?? "",
    timeOfDay,
    dayNumber,
  };
}

/** "the 3rd of Harvest, evening" style, for prompts and the journal. */
export function describeDate(gameTime: number, t: Tuning["world"]): string {
  const c = calendarOf(gameTime, t);
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
  return content.replace(/\.$/, "") + ", or so they say.";
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
            holders: {},
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
              holders: {},
            },
          },
          "engine",
        ),
      ]);
    }
  }
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
      const rng = new Rng(w.state.campaign.rngState);
      spreadRumours(w, rng, ctx);
      factionGoals(w, rng, ctx);
      threatPace(w, d, ctx);
      weather(w, rng, ctx);
      w.apply([
        draft("TickCompleted", { kind: "day", at: d * MINUTES.day, rngAfter: [...rng.state] }, "engine"),
      ]);
      if (d % 7 === 0) {
        weekly(w, ctx);
        w.apply([draft("TickCompleted", { kind: "week", at: d * MINUTES.day }, "engine")]);
      }
    }
  }
  if (Math.floor(now / MINUTES.hour) > Math.floor(w.state.calendar.lastTick.hour / MINUTES.hour))
    w.apply([draft("TickCompleted", { kind: "hour", at: now }, "engine")]);
  return w.events;
}

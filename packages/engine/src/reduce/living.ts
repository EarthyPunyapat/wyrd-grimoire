import { type LivingState, LivingState as LivingStateSchema, NpcLifeState } from "@wyrd/core";
import type { Handlers } from "./types.ts";

const livingOf = (s: { living?: LivingState }): LivingState => s.living ?? LivingStateSchema.parse({});

/** Living World, downtime and news event handlers (M7). */
export const livingHandlers: Pick<
  Handlers,
  "NewsPublished" | "FestivalStarted" | "NpcLifeEvent" | "JobBoardRefreshed" | "DowntimeResolved"
> = {
  NewsPublished: (s, e) => {
    const living = livingOf(s);
    const news = { ...living.news, [e.payload.item.id]: e.payload.item };
    const keep = e.payload.keep;
    const trimmed = keep
      ? Object.fromEntries(
          Object.entries(news)
            .sort(([, a], [, b]) => a.at - b.at || a.id.localeCompare(b.id))
            .slice(-keep),
        )
      : news;
    return { ...s, living: { ...living, news: trimmed } };
  },

  FestivalStarted: (s, e) => {
    const living = livingOf(s);
    if (living.festivalsHeld.includes(e.payload.key)) return s;
    return { ...s, living: { ...living, festivalsHeld: [...living.festivalsHeld, e.payload.key] } };
  },

  NpcLifeEvent: (s, e) => {
    const living = livingOf(s);
    const p = e.payload;
    const prev = living.lives[p.npcId] ?? NpcLifeState.parse({});
    const next = {
      ...prev,
      lastEventAt: p.at,
      ...(p.kind === "marriage" ? { marriedTo: p.otherId } : {}),
      ...(p.kind === "retirement" ? { retired: true } : {}),
      ...(p.kind === "death" ? { dead: true } : {}),
    };
    const lives = { ...living.lives, [p.npcId]: next };
    if (p.kind === "marriage" && p.otherId) {
      const other = living.lives[p.otherId] ?? NpcLifeState.parse({});
      lives[p.otherId] = { ...other, marriedTo: p.npcId, lastEventAt: p.at };
    }
    return { ...s, living: { ...living, lives } };
  },

  JobBoardRefreshed: (s, e) => ({
    ...s,
    living: { ...livingOf(s), jobBoard: e.payload.jobs },
  }),

  // The event is the record of the outcome; no extra projection is needed yet.
  DowntimeResolved: (s) => s,
};

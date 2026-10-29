import { z } from "zod";
import { Degree } from "../common.ts";
import { DowntimeActionType, DowntimeResult } from "../downtime.ts";

/**
 * Event payloads for Living World, downtime and news (M7). `events.ts` spreads this object.
 * Everything the weekly tick and a downtime activity changes is one of these events, so the
 * event log stays the truth and a replay recreates the same news, lives and job board.
 */

const Id = z.string().min(1);

export const NewsKind = z.enum(["faction", "festival", "life", "downtime", "threat", "world"]);
export type NewsKind = z.infer<typeof NewsKind>;

/** One public news item: a headline, a sentence of detail, and the rumour that carries it. */
export const NewsItem = z.object({
  id: Id,
  headline: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(1000),
  at: z.number().int().nonnegative(),
  kind: NewsKind.default("world"),
  about: z.array(Id).default([]),
  /** The rumour the item travels as; the PC hears it through an NPC or by carousing. */
  rumorId: Id.optional(),
});
export type NewsItem = z.infer<typeof NewsItem>;

export const NpcLifeEventKind = z.enum(["marriage", "birth", "retirement", "death"]);
export type NpcLifeEventKind = z.infer<typeof NpcLifeEventKind>;

/** A marriage, birth, retirement or death of old age among the world's NPCs (Living World). */
export const NpcLifeEventPayload = z.object({
  kind: NpcLifeEventKind,
  npcId: Id,
  /** The spouse for a marriage, or the other parent for a birth. */
  otherId: Id.optional(),
  /** The child for a birth (also committed as an `EntityCreated`). */
  childId: Id.optional(),
  age: z.number().int().nonnegative().optional(),
  at: z.number().int().nonnegative(),
  summary: z.string().min(1),
});
export type NpcLifeEventPayload = z.infer<typeof NpcLifeEventPayload>;

export const JobPosting = z.object({
  id: Id,
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(400),
  factionId: Id.optional(),
  postedAt: z.number().int().nonnegative(),
  rewardCoins: z.number().int().nonnegative().optional(),
});
export type JobPosting = z.infer<typeof JobPosting>;

/** Per-NPC life state the living tick keeps (never canon; canon facts/entities carry the story). */
export const NpcLifeState = z.object({
  marriedTo: Id.optional(),
  retired: z.boolean().default(false),
  dead: z.boolean().default(false),
  lastEventAt: z.number().int().nonnegative().optional(),
});
export type NpcLifeState = z.infer<typeof NpcLifeState>;

/** The Living World projection kept in `GameState.living` (optional so older states still load). */
export const LivingState = z.object({
  news: z.record(Id, NewsItem).default({}),
  lives: z.record(Id, NpcLifeState).default({}),
  jobBoard: z.array(JobPosting).default([]),
  /** `${festivalId}:${year}` keys already held, so a festival fires once a year. */
  festivalsHeld: z.array(z.string()).default([]),
});
export type LivingState = z.infer<typeof LivingState>;

export const livingEventSchemas = {
  /** A significant off-screen change, published as news and carried as a rumour (spec 06). */
  NewsPublished: z.object({
    item: NewsItem,
    /** Trim the news list to this many newest items (tuning.living.maxNews). */
    keep: z.number().int().positive().optional(),
  }),
  /** A calendar festival begins; `key` is `${festivalId}:${year}`. */
  FestivalStarted: z.object({
    festivalId: Id,
    name: z.string().min(1),
    key: z.string().min(1),
    at: z.number().int().nonnegative(),
    summary: z.string().default(""),
  }),
  /** An NPC's life changed off-screen (Living World, weekly tick). */
  NpcLifeEvent: NpcLifeEventPayload,
  /** The weekly job board refresh (Living World). */
  JobBoardRefreshed: z.object({ jobs: z.array(JobPosting).max(12) }),
  /** One downtime activity resolved: its time cost, check, outcome and rewards (spec 06). */
  DowntimeResolved: z.object({
    id: Id,
    actorId: Id,
    action: DowntimeActionType,
    minutes: z.number().int().nonnegative(),
    degree: Degree.optional(),
    summary: z.string().min(1),
    rewards: DowntimeResult.shape.rewards,
  }),
} as const;

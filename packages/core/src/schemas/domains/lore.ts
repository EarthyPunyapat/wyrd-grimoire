import { z } from "zod";
import { MAIN_WORLD, WorldId } from "../common.ts";

/** Campaign research provenance; downloaded page text never enters the event log. */
export const LoreRecord = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  worldId: WorldId.default(MAIN_WORLD),
  query: z.string().min(1),
  wiki: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.enum(["high", "low"]),
  url: z.url().optional(),
});
export type LoreRecord = z.infer<typeof LoreRecord>;

export const loreEventSchemas = { LoreRecorded: z.object({ record: LoreRecord }) } as const;

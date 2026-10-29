import { z } from "zod";
import { Light } from "../canon.ts";
import { ActorId, ContentId } from "../common.ts";
import { BurningLight, DiseaseInstance, NeedState, SurvivalNotice } from "../survival.ts";

/**
 * Event payloads for survival, disease, weather effects, lighting and language barriers (M7).
 * `events.ts` spreads this object.
 */
export const survivalEventSchemas = {
  /** The daily tick's record of one actor's needs; `rngAfter` persists seeded rolls made in it. */
  SurvivalNeedsUpdated: z.object({
    actorId: ActorId,
    needs: NeedState,
    reason: z.string(),
    rngAfter: z
      .tuple([
        z.number().int().nonnegative(),
        z.number().int().nonnegative(),
        z.number().int().nonnegative(),
        z.number().int().nonnegative(),
      ])
      .optional(),
  }),
  /** A ration or a waterskin's worth of water left the inventory (auto-consumption). */
  SuppliesConsumed: z.object({
    actorId: ActorId,
    itemId: ContentId,
    kind: z.enum(["food", "water"]),
    qty: z.number().int().positive(),
    notice: z.string(),
  }),
  /** Foraged or hunted supplies entered the inventory. */
  SuppliesGained: z.object({
    actorId: ActorId,
    itemId: ContentId,
    kind: z.enum(["food", "water"]),
    qty: z.number().int().positive(),
    notice: z.string(),
  }),
  SurvivalNotice: z.object({ notice: SurvivalNotice }),
  DiseaseInfected: z.object({ actorId: ActorId, disease: DiseaseInstance }),
  DiseaseProgressed: z.object({
    actorId: ActorId,
    instanceId: z.string(),
    stage: z.number().int().nonnegative(),
    symptoms: z.array(z.string()),
    nextCheckAt: z.number().int().nonnegative(),
  }),
  DiseaseCured: z.object({ actorId: ActorId, instanceId: z.string(), cure: z.string() }),
  /** The clock or a lamp changed the light in the open scene (spec 11, Time detail). */
  SceneLightChanged: z.object({ sceneId: z.string(), light: Light, reason: z.string() }),
  /** A torch or lantern was lit; its burn time comes from tuning. */
  LightLit: z.object({ actorId: ActorId, light: BurningLight }),
  /** Burn time ticked down; at zero the light goes out. */
  LightBurned: z.object({ actorId: ActorId, itemId: ContentId, minutesLeft: z.number().int().nonnegative() }),
} as const;

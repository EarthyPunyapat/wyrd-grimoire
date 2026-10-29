import { MAX_NOTICES, type SurvivalNotice, type SurvivalState, survivalOf } from "@wyrd/core";
import type { GameState } from "../state.ts";
import type { Handlers } from "./types.ts";

const slice = (s: GameState): SurvivalState => survivalOf(s.flags);
const withSlice = (s: GameState, survival: SurvivalState): GameState => ({
  ...s,
  flags: { ...s.flags, survival },
});

function addNotice(s: GameState, notice: SurvivalNotice): GameState {
  const survival = slice(s);
  return withSlice(s, { ...survival, notices: [...survival.notices, notice].slice(-MAX_NOTICES) });
}

const notice = (
  s: GameState,
  kind: SurvivalNotice["kind"],
  text: string,
  id = `notice:${s.campaign.gameTime}:${slice(s).notices.length}`,
): SurvivalNotice => ({ id, at: s.campaign.gameTime, kind, text });

/** Survival, disease, weather, lighting and language event handlers (M7). */
export const survivalHandlers: Pick<
  Handlers,
  | "SurvivalNeedsUpdated"
  | "SuppliesConsumed"
  | "SuppliesGained"
  | "SurvivalNotice"
  | "DiseaseInfected"
  | "DiseaseProgressed"
  | "DiseaseCured"
  | "SceneLightChanged"
  | "LightLit"
  | "LightBurned"
> = {
  SurvivalNeedsUpdated: (s, e) => {
    const survival = slice(s);
    return withSlice(s, {
      ...survival,
      needs: { ...survival.needs, [e.payload.actorId]: e.payload.needs },
    });
  },

  SuppliesConsumed: (s, e) => addNotice(s, notice(s, "supply", e.payload.notice)),
  SuppliesGained: (s, e) => addNotice(s, notice(s, "supply", e.payload.notice)),
  SurvivalNotice: (s, e) => addNotice(s, e.payload.notice),

  DiseaseInfected: (s, e) => {
    const survival = slice(s);
    const list = survival.diseases[e.payload.actorId] ?? [];
    if (list.some((d) => d.id === e.payload.disease.id)) return s;
    return withSlice(s, {
      ...survival,
      diseases: { ...survival.diseases, [e.payload.actorId]: [...list, e.payload.disease] },
    });
  },

  DiseaseProgressed: (s, e) => {
    const survival = slice(s);
    const list = survival.diseases[e.payload.actorId] ?? [];
    return withSlice(s, {
      ...survival,
      diseases: {
        ...survival.diseases,
        [e.payload.actorId]: list.map((d) =>
          d.id === e.payload.instanceId
            ? {
                ...d,
                stage: e.payload.stage,
                symptoms: e.payload.symptoms,
                nextCheckAt: e.payload.nextCheckAt,
              }
            : d,
        ),
      },
    });
  },

  DiseaseCured: (s, e) => {
    const survival = slice(s);
    const list = survival.diseases[e.payload.actorId] ?? [];
    return withSlice(s, {
      ...survival,
      diseases: {
        ...survival.diseases,
        [e.payload.actorId]: list.map((d) => (d.id === e.payload.instanceId ? { ...d, cured: true } : d)),
      },
    });
  },

  SceneLightChanged: (s, e) =>
    s.scene && s.scene.id === e.payload.sceneId ? { ...s, scene: { ...s.scene, light: e.payload.light } } : s,

  LightLit: (s, e) => {
    const survival = slice(s);
    const list = survival.lights[e.payload.actorId] ?? [];
    return withSlice(s, {
      ...survival,
      lights: { ...survival.lights, [e.payload.actorId]: [...list, e.payload.light] },
    });
  },

  LightBurned: (s, e) => {
    const survival = slice(s);
    const list = survival.lights[e.payload.actorId] ?? [];
    const next = list
      .map((l) => (l.itemId === e.payload.itemId ? { ...l, minutesLeft: e.payload.minutesLeft } : l))
      .filter((l) => l.minutesLeft > 0);
    return withSlice(s, { ...survival, lights: { ...survival.lights, [e.payload.actorId]: next } });
  },
};

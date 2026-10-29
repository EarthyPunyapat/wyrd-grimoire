import { updateSheet } from "./helpers.ts";
import type { Handlers } from "./types.ts";

/** Injury completion handlers (M7): healing, infection, treatment and lasting injuries. */
export const injuryHandlers: Pick<
  Handlers,
  "WoundProgressed" | "WoundHealed" | "WoundInfected" | "WoundTreated" | "PermanentInjuryGained"
> = {
  WoundProgressed: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => ({
      ...sheet,
      status: {
        ...sheet.status,
        wounds: sheet.status.wounds.map((w) =>
          w.id === e.payload.woundId ? { ...w, healingDays: e.payload.healingDays } : w,
        ),
      },
    })),

  WoundHealed: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => ({
      ...sheet,
      status: {
        ...sheet.status,
        wounds: sheet.status.wounds.filter((w) => w.id !== e.payload.woundId),
      },
    })),

  WoundInfected: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => ({
      ...sheet,
      status: {
        ...sheet.status,
        wounds: sheet.status.wounds.map((w) => (w.id === e.payload.woundId ? { ...w, infected: true } : w)),
      },
    })),

  WoundTreated: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) => ({
      ...sheet,
      status: {
        ...sheet.status,
        wounds: sheet.status.wounds.map((w) =>
          w.id === e.payload.woundId ? { ...w, treated: true, fracture: false } : w,
        ),
      },
    })),

  PermanentInjuryGained: (s, e) =>
    updateSheet(s, e.payload.actorId, (sheet) =>
      sheet.status.permanentInjuries.some((i) => i.id === e.payload.injury.id)
        ? sheet
        : {
            ...sheet,
            status: {
              ...sheet.status,
              permanentInjuries: [...sheet.status.permanentInjuries, e.payload.injury],
            },
          },
    ),
};

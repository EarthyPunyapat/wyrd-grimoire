import { CURRENT_EVENT_SCHEMA_VERSION, type EventEnvelope } from "@wyrd/core";

/**
 * Upcasters convert stored events from older schema versions to the current shape on read.
 * Keyed by `${type}@${fromVersion}`; each returns the event at fromVersion + 1. After adding one,
 * run `wyrd rebuild` so projections and snapshots reflect the new shape.
 */
type Upcaster = (e: EventEnvelope) => EventEnvelope;
const UPCASTERS: Record<string, Upcaster> = {};

export function upcast(e: EventEnvelope): EventEnvelope {
  let out = e;
  while (out.schemaVersion < CURRENT_EVENT_SCHEMA_VERSION) {
    const up = UPCASTERS[`${out.type}@${out.schemaVersion}`];
    out = up ? up(out) : { ...out, schemaVersion: out.schemaVersion + 1 };
  }
  return out;
}

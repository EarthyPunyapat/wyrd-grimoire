import { expect, test } from "bun:test";
import { eventPayloadSchemas } from "@wyrd/core";
import { avatarEventSchemas } from "../../core/src/schemas/domains/avatars.ts";
import { canonEventSchemas } from "../../core/src/schemas/domains/canon-clocks.ts";
import { delegationEventSchemas } from "../../core/src/schemas/domains/delegation.ts";
import { levelEventSchemas } from "../../core/src/schemas/domains/levels.ts";
import { loreEventSchemas } from "../../core/src/schemas/domains/lore.ts";
import { skipEventSchemas } from "../../core/src/schemas/domains/skips.ts";
import { HANDLED_EVENT_TYPES } from "../src/reduce.ts";

// Wyrd 2.0 step 3: one schema module and one handler module per workstream, registered once (roadmap spine).
const domains = {
  levels: levelEventSchemas,
  avatars: avatarEventSchemas,
  lore: loreEventSchemas,
  canon: canonEventSchemas,
  skips: skipEventSchemas,
  delegation: delegationEventSchemas,
};

test("every W2 domain's events are in the registry and handled", () => {
  for (const [name, schemas] of Object.entries(domains)) {
    for (const type of Object.keys(schemas)) {
      expect(Object.keys(eventPayloadSchemas), `${name}: ${type}`).toContain(type);
      expect(HANDLED_EVENT_TYPES as readonly string[], `${name}: ${type}`).toContain(type);
    }
  }
});

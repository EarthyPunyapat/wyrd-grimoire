import { expect, test } from "bun:test";
import { LocationProposal } from "@wyrd/core";
import { locationEvents } from "../src/world-bible.ts";

const place = {
  name: "Public parlor",
  description: "A room open to visitors.",
  arrival: "Two people look up from a table.",
  weather: "rain",
  light: "bright",
  zones: [
    { name: "Floor", description: "An open floor." },
    { name: "Door", description: "The way out." },
  ],
  people: [
    {
      name: "Ilsa",
      description: "The host.",
      zone: 0,
      secret: "PRIVATE_HOST_SECRET",
      reactionProfile: { temperament: "protective", speechStyle: "firm and concise", canSpeak: true },
    },
  ],
};

test("generated locations retain validated behavior profiles separately from private facts", () => {
  const p = LocationProposal.parse(place);
  const { events } = locationEvents(p, "site:parlor", {}, []);
  const host = events.find((e) => e.type === "EntityCreated" && e.payload.entity.kind === "npc");
  expect(host?.type === "EntityCreated" && host.payload.entity.data.reactionProfile).toEqual(
    place.people[0]!.reactionProfile,
  );
  expect(host?.type === "EntityCreated" && JSON.stringify(host.payload.entity.data)).not.toContain(
    "PRIVATE_HOST_SECRET",
  );
  expect(
    events.some(
      (e) =>
        e.type === "FactAsserted" &&
        e.payload.fact.value === "PRIVATE_HOST_SECRET" &&
        e.payload.fact.visibility === "secret",
    ),
  ).toBe(true);
});

test("legacy proposals need no profile, but unknown behavior categories are rejected", () => {
  const legacy = { ...place, people: [{ name: "Ilsa", description: "The host.", zone: 0, secret: null }] };
  expect(LocationProposal.safeParse(legacy).success).toBe(true);
  expect(
    LocationProposal.safeParse({
      ...place,
      people: [{ ...place.people[0], reactionProfile: { temperament: "invent-new-rules" } }],
    }).success,
  ).toBe(false);
});

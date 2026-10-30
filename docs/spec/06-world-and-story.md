# 06 — World and story

## The canon rule

> **Nothing exists until it is written into state. Once written, it is canon.**

- Anything that is **named or interacted with** becomes a canon entity before (or as) it is narrated.
- Unnamed background colour ("a few patrons murmur at the bar") may stay uncanonised. The moment the player addresses one of them, it gets canonised.
- The model always reads canon to describe the world. It never treats its own earlier prose as the record.

## World structure

```
World
 └─ Regions (3–6 at generation; more can be discovered)
     └─ Sites: settlements, wilds, dungeons, ruins, landmarks
         └─ Locations: buildings, rooms, clearings, streets
             └─ Zones (only when a scene needs positioning; see 03)
```

- **Routes** connect sites with travel time, terrain, danger level and requirements (boat, permit, climbing gear). The route graph is the world map ([13](13-ui.md#map)).
- Every entity has a **detail level**: `stub` (name plus one line), `sketch` (key facts), `full` (everything). World generation creates many stubs; lazy generation upgrades them on first contact.

## Campaign creation flow

1. **Setup:** genre pack (+ addons), a free-text **pitch** ("grimdark pirate archipelago, low magic, plague spreading"), story mode, settings preset, rules options, content dials.
2. **World bible (stage 1):** the `worldGen` role generates the world's skeleton (below).
3. **Character creation:** session zero, form or quick start ([04](04-characters.md#character-creation)). Session zero sees a short world summary so the character can come *from* this world. Backstory hooks are created here.
4. **Integration (stage 2):** the world generator places every backstory hook, details the starting site and its key NPCs, and writes the opening situation.
5. **Opening scene:** the narrator opens the campaign.

Progress is shown step by step in the UI; each stage can be regenerated before the campaign starts.

## World generation

Generation is split into small structured calls (M5 uses the opening call plus one world-bible call, D93) so each can be validated, retried and regenerated independently. All outputs are zod-validated; the engine assigns IDs and commits them as `EntityCreated`, `FactAsserted`, `RelationshipChanged` and `ClockCreated` events.

### Stage 1: world bible

| Call | Produces |
|---|---|
| Premise | World name, premise, tone, themes, magic/tech level, a short history (3–5 defining events) |
| Regions | 3–6 regions: name, archetype (from `worldgen.yaml`), climate, culture, dominant faction, 2–4 site stubs each, and routes between sites |
| Factions | 4–8 factions: name, archetype, goals, methods, resources (wealth/military/influence 1–5), territory, leader stub, a secret, and a relations matrix between factions |
| Threat | Threat Clock mode only. See [Threat Clock](#threat-clock-default) |
| Key NPCs | 10–20 stubs: name, role, faction, location, want, secret |
| Hooks | 5–10 seeded hooks spread across regions, each tied to an NPC, faction or site |

### Stage 2: integration

- **Place every backstory hook.** The rival gets a faction and a location; a missing sibling gets a far-off location and a **trail of clues** (3+ clue facts placed at sites and in NPCs' knowledge); a debt gets a creditor and a clock; a secret gets a list of who knows it.
- Upgrade the **starting site** to `full`: locations, services, 4–8 named NPCs with `sketch` detail, local rumours.
- Write the **opening situation**: where the PC is, why, and an immediate choice.

### Names

- Each culture or region has a naming style from `naming.yaml`.
- A **name registry** prevents duplicates and near-duplicates (normalised edit distance) across canon; the generator is told which names are taken and retries on collision.

## Lazy generation

When play reaches something that doesn't exist yet, it is generated **before** narration:

| Trigger | Tool |
|---|---|
| Entering an unvisited site or location | `generate_location(parentId, kind, constraints)` |
| Asking about or addressing an unknown person ("who runs this inn?") | `generate_npc(locationId, role, constraints)` |
| Searching, looting or examining something unknown | `generate_item` / `generate_detail` |
| Needing a zone map for a scene | `propose_zone_map` ([03](03-combat-and-injury.md#scenes-and-zones)) (later; D94) |
| Upgrading a stub on first contact | `elaborate_entity(entityId)` |

Constraints come from the parent's canon (a dwarven hold's smith is a dwarf; a poor district's inn is cheap) and from pack data. Generated content is validated against canon (e.g. it can't place a second leader at the head of a faction that already has one) and committed as events before the narrator sees it.

## Story modes

The story mode can be switched at any time ([12](12-campaign-settings.md)).

### Threat Clock (default)

A main threat gives the campaign direction without railroading.

- **The threat:** name, nature, agent faction, motive, and **2–3 distinct paths to stop it** (for example military, diplomatic, secret or arcane), each seeded as hooks and clues across regions.
- **The clock:** 12 segments in 4 stages by default.
- **What advances it:** in-game time (by the threat's pace, e.g. 1 segment per 10 days), the agent faction's successes in the world simulation, and failed or ignored threat-related quests.
- **What sets it back:** completed quests on a path, sabotage, killing or turning key agents (engine-checkable quest outcomes).
- **Each stage** triggers world events that change canon (a town falls, refugees arrive, prices rise, a faction switches sides) plus new hooks and rumours.
- **The final stage** is a dramatic world change, not a game-over: the world gets darker and the campaign goes on.
- **Defeating the threat** triggers an epilogue and a choice: end the campaign, or continue in Living World mode.

### Living World

No doom clock; the player simply lives in the world.

- Factions pursue everyday goals on their own clocks (trade deals, feuds, elections, construction).
- Seasonal events and festivals from the calendar; NPC life events (marriages, births, retirements, deaths of old age); prices that drift with seasons and events.
- Optional hooks appear on job boards and through rumours, with no consequences for ignoring them.
- Switching from Threat Clock to Living World freezes the threat clock; switching back unfreezes it.

## Quests

```ts
type Quest = {
  id: QuestId; title: string;
  kind: "main" | "side" | "personal" | "companion" | "faction" | "job";
  giverId?: EntityId;
  stages: Array<{
    id: string; summary: string;
    objectives: Array<
      | { kind: "reach"; locationId: EntityId }
      | { kind: "obtain"; itemId: EntityId; qty?: number }
      | { kind: "npcState"; npcId: EntityId; state: "dead" | "alive" | "recruited" | "persuaded" | "captured" }
      | { kind: "flag"; key: string; value: unknown }
      | { kind: "narrative"; description: string }        // judged by the guard with cited evidence
    >;
  }>;
  status: "active" | "completed" | "failed" | "abandoned";
  rewards: RewardSpec;            // bounded by the economy tier of the region and quest kind
  deadline?: ClockId;             // a clock; failing it fails the stage
  pathOf?: ThreatPathId;          // links a quest to a threat path
};
```

- Engine-checkable objectives advance automatically from events.
- **Narrative objectives** ("convince the council the threat is real") are judged by the `guard` role after each turn: it may propose `objective_met` with evidence (event IDs and quotes); the engine accepts it only if the evidence references real events in the current scene.
- Rewards are bounded by tables (no model-invented legendary loot).

## Factions

- **Reputation** with the player: −100 to +100, shown as tiers (Hated, Hostile, Unfriendly, Neutral, Friendly, Honoured, Exalted). Affects prices, access, guards' behaviour and NPC disposition baselines.
- **Relations** with each other (same scale), changed by world events.
- **Resources:** wealth, military, influence (1–5 each).
- **Goals** as clocks, chosen from the faction archetype's goal list.
- **Members:** NPCs linked by `memberOf` edges; leaders by `leads`.

## Time and calendar

- In-game time is minutes since the campaign epoch, held in state. Only engine events advance it (`TimeAdvanced`).
- Time costs: a combat round is 6 seconds; checks and actions carry default durations by type; travel uses route time × modifiers (terrain, weather, mount, encumbrance); rests and downtime are explicit.
- The **calendar** (pack data) names days, months, seasons and festivals.
- **Day and night** set lighting tags, shop hours, guard patrols and encounter tables.
- **Weather** is rolled daily per region from its climate and season (seeded) and affects travel, checks and exposure.

## World simulation

When time advances past a boundary, the engine runs ticks. Long time skips run the daily tick repeatedly in fast mode.

| Tick | What happens |
|---|---|
| Hourly | NPC schedules (who is where; shops open and close); light level |
| Daily | Faction goal progress (checks using resources vs opposition); threat clock; rumour spread ([07](07-memory.md#rumours-and-information-spread)); weather; price drift; healing and infection checks; survival needs |
| Weekly | Faction goal completion and new goals; NPC life events (Living World); job board refresh |

- Every off-screen change is an **event**, so it is canon and consistent.
- Significant off-screen events are batched and turned into **news items** (rumours the player can hear) by the `worldGen` role, at most once per in-game day and only when something notable happened.

## Travel and encounters

- Travel along a route advances time and rolls for encounters by route danger, region and time of day (pack encounter tables).
- Encounters can be combat, social, discovery or hazard. They are generated from tables plus region canon, then narrated.
- The player can choose travel pace (careful, normal, fast) which trades time for encounter odds and Survival/Navigation checks (one Navigation check per leg, D95).

## Downtime

When time passes in a safe place, the player can choose activities: **train** (with a teacher: an improvement opportunity or reduced XP cost), **craft**, **work** (earn money with a skill check), **research** (an extended task: one clock per topic, continued by researching it again, abandonable; D162), **carouse** (gather rumours, risk trouble), **recover** (healing with care). The engine resolves the outcomes; the narrator summarises them in a short passage.

## Time skips and observation (W2 E, D161)

`time_skip` takes exactly one of `duration`, `until`, or legacy `minutes`, plus an optional reason. Numeric durations are game minutes; strings accept an amount or “a/an” and minute/hour/day/week/month/year (the default month is 30 days). `until` is an engine-checkable `{taskIds: [...]}`, `{clockId}`, or `{entityId, predicate, value}` condition. Tasks must exist and finish as done or failed; blocked tasks need help. Unknown clocks/tasks and invalid or excessive durations are rejected. Conditions are checked before advancing and after each step, with a configured maximum span when unmet.

The engine advances one daily boundary at a time through `runTicks`, preserving daily simulation beyond the older catch-up cap and processing weekly ticks on every seventh calendar day. Canon clocks and delegated tasks use D/F's existing rules. Earlier task due times and a final partial day are also processed so a short skip cannot step over a blocked task. Combat and ended/dead player campaigns cannot skip.

The skip stops at the first watched event meeting `tuning.skips.interruptSeverity` (major by default), a blocked task, a death, or a pending canon clock with only its final segment left. A clock already there stops the skip immediately. A valid recorded intervention allows the clock to resolve as averted; ordinary explicit time advances can still let canon occur. Event and news-kind severity mappings are configurable; faction goal completion is major, routine activity is minor. A digest and one safe report per watched entity (including quiet periods) are recorded by `SkipCompleted` and shown as report cards. Reports use typed event summaries rather than copying private payloads.

`WatchAdded`/`WatchRemoved` maintain a replayable watch list. The GM's `watch`/`unwatch` tools and the Codex controls edit it; Cockpit's rail shows these entities even when they are outside the scene. The GM receives watch IDs and recent task IDs/statuses for future conditional skips.

An effective Level-∞ character can `observe` any existing entity by ID and learns its existence and public facts. Finite/sealed characters observe known entities. Missing IDs do not invent canon. Observation exposes only safe identity, public facts, position and actor level/HP/death fields; NPC minds, secret facts and arbitrary entity data stay server-side. An infinite observer can establish a new watch through observation; direct Codex/API watches require an already-known target.

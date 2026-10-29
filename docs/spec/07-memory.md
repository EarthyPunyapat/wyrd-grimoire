# 07 — Memory

The memory system is the heart of the engine. It is what lets a campaign run for hundreds of sessions without the world drifting, NPCs forgetting, or the model inventing contradictions.

## Layers at a glance

```
                ┌───────────────────────────────────────────────┐
  truth         │ EVENT LOG  (append-only, the only source of truth)
                └───────────────┬───────────────────────────────┘
                                │ projections (rebuildable)
        ┌───────────────────────┼───────────────────────────────┬──────────────────────┐
        ▼                       ▼                               ▼                      ▼
  CANON GRAPH            MEMORY PYRAMID                    NPC MINDS              PC KNOWLEDGE
  entities, facts,       turns → scenes →                  per-NPC memories,      what the player
  edges, provenance      chapters → arcs                   disposition, rumours   character knows
        └───────────────────────┴───────────────┬───────────────┴──────────────────────┘
                                                ▼
                                       RETRIEVAL INDEX (hybrid: vectors + full-text)
                                                ▼
                                       CONTEXT ASSEMBLER  → prompts per role, within token budgets
                                                ▲
                                       CANON GUARD  ← checks every narration against the above
```

## Three kinds of knowledge

Keeping these separate is what stops NPCs from knowing things they shouldn't and the narrator from leaking secrets.

| Layer | Contains | Who sees it |
|---|---|---|
| **World truth** | All canon: every entity and fact, including secrets | The engine. The narrator sees only what is perceivable in the scene plus what the PC knows. |
| **PC knowledge** | Facts the PC has learned, each with how they learned it (witnessed, told by X, rumour, read) | The player (codex, journal) and the narrator |
| **NPC knowledge** | Each NPC's own memories and beliefs | That NPC's dialogue prompts only |

A secret reaches the player only through an engine-validated reveal: a check succeeds, an NPC chooses to tell (validated by the `reveal_fact` tool against that NPC's knowledge and disposition), or the PC finds evidence.

## Canon graph

Stored as projection tables in `campaign.db`, written only by events.

```ts
type Entity = {
  id: EntityId; kind: "npc" | "location" | "site" | "region" | "faction" | "item" | "quest" | "creature" | "concept";
  name: string; aliases: string[];
  detail: "stub" | "sketch" | "full";
  data: unknown;              // kind-specific structured record (statblock, services, prices…)
  createdSeq: number; status: "active" | "destroyed" | "dead" | "lost";
  importance: 1 | 2 | 3 | 4 | 5;
};

type Fact = {
  id: FactId; entityId: EntityId;
  predicate: string;          // controlled vocabulary ("appearance.hair", "location", "owes", "secret", "personality", …) plus "note"
  value: string | number | boolean | EntityId | object;
  source: "engine" | "model" | "player" | "pack";
  evidence?: { eventIds: string[]; quote?: string };
  visibility: "public" | "secret";
  importance: 1 | 2 | 3 | 4 | 5;
  assertedSeq: number; supersededBy?: FactId; retracted?: boolean;
  pinned?: boolean;
};

type Edge = {
  from: EntityId; to: EntityId;
  type: "memberOf" | "leads" | "knows" | "family" | "friend" | "rival" | "owes" | "employs" | "reportsTo"
      | "locatedIn" | "owns" | "routeTo" | string;
  strength: number;           // 0–1, used by rumour spread
  data?: object; seq: number;
};
```

- Facts are never deleted. Changes create a new fact that `supersedes` the old one; retcons mark facts `retracted`.
- **Appearance facts** are structured so portraits stay consistent ([10](10-media.md)).
- Players can **pin** up to 20 facts; pinned facts are always in narrator context.

## Memory pyramid

| Level | Unit | Written when | Length (default) |
|---|---|---|---|
| 0 | **Turn**: player input, resolution, narration, verbatim | Every turn | — |
| 1 | **Scene summary** | A scene closes | ~150 words |
| 2 | **Chapter summary** | A chapter closes | ~300 words |
| 3 | **Arc summary** | An arc closes | ~400 words |

**Boundaries** (engine-detected):

- **Scene closes on:** location change, combat start or end, a time skip over 1 hour, a rest, the end of a conversation with a major NPC, or 25 turns.
- **Chapter closes on:** a major quest stage, arriving in a new region, 8–12 scenes, or the player pressing **End session**.
- **Arc closes on:** a threat stage change, a main or personal quest completing, or 5–8 chapters.

**Summaries** are written by the `summarizer` role right after the boundary turn (D99) from the events and narration in their range. Each records the entity IDs, locations, quests and facts involved, emotional beats, and an importance score. They are memory, not canon: the summarizer may not introduce facts, and any entity name it uses must resolve to a canon ID (validated). If a retcon changes facts used by a summary, the summary is flagged stale and regenerated.

**Session recap:** when the player returns, a short "Previously…" recap is generated from the latest arc, chapter and scene summaries.

## NPC minds

Every NPC with at least `sketch` detail has a mind.

```ts
type NpcMemory = {
  npcId: EntityId; seq: number; gameTime: number;
  kind: "witnessed" | "told" | "heard";       // heard = rumour
  content: string;                            // one sentence from the NPC's point of view
  about: EntityId[];
  importance: 1 | 2 | 3 | 4 | 5;
  feeling: -3 | -2 | -1 | 0 | 1 | 2 | 3;      // how it made them feel
  belief: number;                             // 0–1: how much they believe it (told/heard)
  sourceNpcId?: EntityId;
};

type NpcDisposition = {
  npcId: EntityId; towardId: EntityId;        // usually the PC
  attitude: number;                           // −100..+100
  trust: number; fear: number; respect: number; // 0–100 each
};
```

- **Witnessing:** after each turn the engine computes who perceived each event: present, conscious, with line of sight or within hearing (same or adjacent zone, not deafened). The `guard` role writes one observational sentence per witness cluster ("The stranger knifed Harl in the alley and ran"). The engine records it for each witness.
- **Being told:** what the PC says to an NPC is recorded as `told`. If the PC lies, the Deception vs Insight check sets `belief`. Later contradictions can expose the lie and hurt trust.
- **Forgetting:** memories are never deleted, but low-importance ones lose retrieval weight over in-game time.
- **Using a mind:** when an NPC speaks, the `npcDialogue` prompt gets their personality, goals, secrets (marked as theirs to guard), disposition, and their top relevant memories, **not** world truth they don't know. Anything they do that changes state (give, attack, flee, reveal) is a tool call the engine validates.

## Rumours and information spread

```ts
type Rumor = {
  id: string; content: string; about: EntityId[];
  truth: { factId?: FactId; accuracy: "true" | "distorted" | "false" };
  originNpcId?: EntityId; originEventId?: string;
  heat: number;            // 0–1, how juicy; drives spread
  secrecy: number;         // 0–1, how hard people try to keep it quiet
  createdAt: number;       // game time
};
```

- On each **daily tick**, every rumour can hop along social edges (`family`, `friend`, `memberOf`, `employs`, `reportsTo`, and co-location in the same settlement) with probability ≈ heat × edge strength × (1 − secrecy) × proximity. `reportsTo` edges are fast for crimes and threats.
- Each hop may **distort**: a deterministic, LLM-free degradation (names dropped, numbers inflated, the culprit swapped for a similar person) chosen by seeded roll.
- Receiving a rumour creates a `heard` memory with `belief` based on the source's trust.
- **Example:** lie to a guard on Tuesday → the guard has a `told` memory → his `reportsTo` edge to the captain → the captain may hear it by Friday.
- The PC hears rumours in taverns (carousing), from NPCs who know them, and from news items ([06](06-world-and-story.md#world-simulation)).

## Retrieval index

Everything that can be recalled is indexed in one table with a **namespace**:

| Namespace | Items |
|---|---|
| `summaries` | Scene, chapter and arc summaries |
| `facts` | Canon facts rendered as sentences |
| `pc` | PC-known facts and codex entries |
| `npc:<id>` | Each NPC's memories |
| `rumors` | Rumours |

Each item has text, entity IDs, game time, seq, importance, visibility, and an embedding.

- **Full-text:** SQLite FTS5 (BM25). If FTS5 is unavailable in the runtime's SQLite, a small TF-IDF index in TypeScript is used instead.
- **Vectors:** stored as BLOBs with the embedding model ID. Search uses `sqlite-vec` if it loads; otherwise a brute-force cosine scan over a pre-filtered candidate set (by namespace and entity), which is fast enough for campaign-sized data.
- **Embeddings** come from the `embeddings` role ([09](09-models-and-providers.md)); until one is configured, a local hashed embedder is used (D98). If the embedding model changes, a background job re-embeds everything; until it finishes, retrieval falls back to full-text plus entity lookup.

## Context assembler

Builds each model prompt from sections in priority order, within a **token budget per role**. Stable sections come first so providers can cache the prefix.

### Narrator prompt (budget default 24k tokens)

| # | Section | Cached | Notes |
|---|---|---|---|
| 1 | Role instructions, output format, content dials, lines and veils, narration language | ✔ | |
| 2 | Rules digest for the current mode | ✔ | One per mode |
| 3 | Genre tone guide (`tone.md`) | ✔ | |
| 4 | World bible summary | ✔ | Regenerated when an arc closes |
| 5 | Arc summaries + current chapter summary | | Top of the pyramid |
| 6 | PC and party, compact | | |
| 7 | Scene: location record, time, weather, light, present actors (appearance + state), zone map in combat | | |
| 8 | **Focus entities**, exact lookup: everything named in the input or resolution and everyone present; full records filtered to PC-perceivable and PC-known facts | | |
| 9 | One-hop neighbours of focus entities, compact | | |
| 10 | **Retrieved memories** (hybrid search, below) | | |
| 11 | Relevant active quests and visible clocks | | |
| 12 | Recent turns, verbatim (as many as fit, at least 6) | | |
| 13 | This turn: player input, structured resolution, **required beats** (e.g. "wound to left arm; the archer flees"), **forbidden reveals** | | Always included in full |

**Trimming when over budget:** retrieved memories first, then neighbours, then older verbatim turns (down to 6), then compress the scene section. Sections 1–4 and 13 are never trimmed.

### Other roles

| Role | Budget | Main contents |
|---|---|---|
| `parser` | 8k | Action catalog for the current mode, scene state, PC/party compact, present entities, last 4 turns, player input |
| `npcDialogue` | 10k | NPC personality, goals, secrets, disposition, NPC-mind retrieval, scene, last 6 turns |
| `guard` | 12k | Narration draft, resolution, focus entities with all their facts (including secrets, to detect leaks), PC knowledge, content lines |
| `summarizer` | 16k | Events and narration in the range, entity list |
| `worldGen` | 16k | Pack worldgen data, world bible, the parent entity, constraints, taken names |

### Retrieval scoring

1. **Query** = player input + current scene summary + names of focus entities. Speaking NPCs get an extra query against their own `npc:<id>` namespace.
2. **Candidates:** top 30 from vectors and top 30 from full-text, fused with **reciprocal rank fusion** (k = 60).
3. **Visibility filter:** the narrator sees only `public` items the PC can perceive and items in `pc`; NPC prompts see only their own namespace plus public facts about what's in front of them.
4. **Rerank:** score = 0.5 × relevance (normalised RRF) + 0.25 × recency + 0.2 × importance + 1.0 if pinned. Recency decays exponentially with in-game time (half-life 30 days).
5. **Dedupe** against what's already in the prompt (e.g. a scene summary whose turns are present verbatim).
6. Fill the budget in score order.

## Canon guard

Runs after the narrator drafts a passage and before it is committed.

**Input:** the draft, the structured resolution, the scene's canon, the PC's knowledge, all facts about focus entities (including secrets), and content lines.

**Output (zod-validated JSON):**

```ts
type GuardReport = {
  newEntities: Array<{ name: string; kind: Entity["kind"]; description: string; linkTo?: EntityId }>;
  newFacts: Array<{ entityId: EntityId; predicate: string; value: unknown; quote: string }>;
  contradictions: Array<{ quote: string; conflictsWith: { factId?: FactId; resolution?: string }; severity: "minor" | "major" }>;
  stateClaims: Array<{ quote: string; claim: string }>;     // narration implies a state change the engine didn't make
  secretsRevealed: Array<{ quote: string; factId: FactId }>;
  linesCrossed: Array<{ quote: string; line: string }>;
  witnessObservations: Array<{ witnessIds: EntityId[]; content: string; importance: number; feeling: number }>;
  objectiveMet: Array<{ questId: QuestId; objectiveIndex: number; evidence: string }>;
  approvalDeltas: Array<{ companionId: EntityId; delta: number; reason: string }>;
};
```

**Policy:**

- `stateClaims`, `secretsRevealed`, `linesCrossed` and major `contradictions` are **blocking**. The narration is regenerated **once** with corrective notes ("the archer was hit, not killed"; "do not reveal X"). If the second draft still has blocking issues, the passage is shown with the problem highlighted and three choices: **keep canon and regenerate**, **accept as retcon** (allowed only for minor descriptive facts, never for engine state like HP, items or deaths), or **edit**.
- Minor contradictions don't block: canon wins, and the conflict is logged.
- Non-conflicting new facts and named new entities are committed (as `stub` entities if new).
- The other outputs feed NPC minds, quests and companion approval through engine validation.
- **Timing:** by default the guard runs **before** narration is shown (the mechanics log and a typing indicator appear immediately). A setting allows "show first, check after", in which case blocking issues replace the passage in place.

## Journal and codex

- **Codex:** every entity the PC knows, with the facts they know and how they learned each one, portraits, and relationship standing.
- **Journal:** the pyramid (arcs → chapters → scenes), active and finished quests, a timeline, and the player's own notes.
- **Pin, edit, retcon:** the player can pin facts, or edit a fact (creates `Retconned` events; affected summaries are regenerated). Engine state (HP, items, wounds, deaths, money) can't be retconned from the codex. Rewind is the tool for that.

## Rebuild and caching

- All memory tables are projections and can be rebuilt from the event log. Embeddings are a cache and can be regenerated.
- Prompt-cache-friendly ordering is part of the assembler's contract: sections 1–4 must be byte-identical across turns unless their inputs change.

## Quality targets (measured by evals in [15](15-testing.md))

- Retrieval recall@10 ≥ 0.9 on the campaign memory eval set.
- Blocking contradictions reaching the player (after regeneration): < 1 per 100 turns.
- NPC knowledge leaks (an NPC referencing something it never learned): < 1 per 200 NPC lines.

## Incident responses and narrator knowledge

The engine can attach optional structured `response` metadata to an NPC’s witnessed memory: incident, round, acting character, response stage and observable result. This provides replayable reaction history without a wall-clock timer or a new parallel companion-approval system. The first witnessed assault changes applicable ordinary-NPC disposition; repeated warnings do not reset the incident or stack the same initial penalty every round.

An engine-recorded incident observation is not duplicated by the guard for the same turn. Rerolling narration does not add witness memories. The narrator’s selected-speaker context contains relevant shared incidents and things the PC told that NPC, plus public characterization; it does not retrieve private NPC memory namespaces. Private NPC reasoning/disclosures require the isolated, validated dialogue path described above.

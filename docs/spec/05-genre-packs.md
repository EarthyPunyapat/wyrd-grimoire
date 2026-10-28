# 05 — Genre packs and plugins

The engine is genre-agnostic. A **genre pack** is data that turns it into fantasy, cyberpunk, cosmic horror, space opera or anything else. A **plugin** is a small code module for a subsystem that data alone can't express.

## Pack layout

```
packs/fantasy-core/
  pack.yaml            # manifest
  tone.md              # narrator style guide for this genre
  skills.yaml          # pack skills (in addition to core skills)
  talents.yaml
  ancestries.yaml
  archetypes.yaml
  classes.yaml         # optional; enables class mode
  bodyplans.yaml       # extra body plans (humanoid is built in)
  conditions.yaml      # extra conditions
  items/
    weapons.yaml  armor.yaml  gear.yaml  consumables.yaml  materials.yaml
  creatures/*.yaml     # statblocks
  loot-tables.yaml
  economy.yaml         # currency denominations, base prices, regional modifiers, wealth levels
  calendar.yaml        # days, months, seasons, festivals
  naming.yaml          # naming styles per culture/region
  worldgen.yaml        # region, faction, settlement and threat archetypes; hook templates
  recipes.yaml         # crafting
  pregens.yaml         # quick-start characters
  theme.yaml           # UI theme tokens
  voices.yaml          # optional: preferred TTS voice tags per culture/archetype
  plugins/             # per-plugin config, e.g. spellcasting.yaml
  worlds/              # optional hand-authored worlds (see below)
```

All files are validated with zod schemas exported from `packages/core`. YAML is the authoring format; packs are compiled to a single JSON blob at load time.

### Manifest

```yaml
id: fantasy-core
name: "Fantasy Core"
version: 1.0.0
engine: ">=1.0.0 <2.0.0"
description: "Grounded, low-to-mid magic medieval fantasy."
tags: [fantasy, medieval, low-magic]
kind: genre            # genre | addon
requires: []           # other packs (for addons)
plugins:
  - id: spellcasting
    config: plugins/spellcasting.yaml
supports:
  progression: [classless, useBased, hybrid, classes]
  bodyPlans: [humanoid, quadruped, avian, serpentine]
```

### IDs and mixing packs

- A campaign uses **one genre pack** plus any number of **addon packs** (e.g. `fantasy-core` + `horror-addon`).
- Every content ID is namespaced `packId:localId`. Pack files use local IDs (`arcana`); references may be local or qualified (`core:melee`, `other-pack:thing`). A local skill reference resolves to the pack's own skill first, then to the core skills (`core:`). Field skills append the specialisation: `core:lore/history`. Addons may override entries by ID; load order decides. Conflicts are reported at campaign creation.
- **Freezing:** when a campaign is created, the compiled pack content and its hash are stored inside `campaign.db`. Updating or deleting a pack never changes an existing campaign. A campaign can be explicitly migrated to a newer pack version from Settings (with a diff preview).

### tone.md

The narrator's genre style guide, injected (cached) into narration prompts: prose register, vocabulary, sensory palette, anachronisms to avoid, how magic or technology should feel, naming conventions, and 2–3 short example passages written for the pack. Keep under ~800 tokens.

### worldgen.yaml

Gives the world generator structure instead of a blank page: region archetypes, settlement sizes and services, faction archetypes (with goals and methods), threat archetypes (with clock stages), hook templates, and naming styles per culture. See [06](06-world-and-story.md).

### theme.yaml

UI theme tokens for the genre: palette (light and dark), display and body fonts, optional background texture, accent for critical results, map node style, icon set. Fantasy: parchment and ink; cyberpunk: neon on black terminal. See [13](13-ui.md#themes).

### Hand-authored worlds

`worlds/<worldId>/` contains a `world.yaml` (premise, regions, locations, factions, NPCs, items, quests, threat) in the same shapes the world generator produces. Loading a hand-authored world commits it as canon events at campaign start; lazy generation still fills gaps during play.

## Plugins

Plugins are TypeScript modules **inside the repo** (`packages/engine/src/plugins/<id>`) and are referenced by ID from pack manifests. Third-party code plugins loaded at runtime are out of scope for v1.

```ts
interface Plugin<Config, PState> {
  id: string;
  version: string;
  configSchema: ZodType<Config>;            // validated from the pack's plugin config
  stateSchema?: ZodType<PState>;            // lives at state.flags[pluginId]
  events?: Record<string, ZodType>;         // namespaced "pluginId/EventName"
  reducers?: Record<string, (s: GameState, e: EventEnvelope) => GameState>;
  actions?: ActionDefinition[];             // new action types for the parser catalog
  hooks?: {
    onCheck?(ctx: HookCtx, req: CheckRequest): CheckRequest;
    onDamage?(ctx: HookCtx, dmg: DamageEvent): DamageEvent;
    onTurnStart?(ctx: HookCtx, actorId: ActorId): EventDraft[];
    onTimeAdvanced?(ctx: HookCtx, minutes: number): EventDraft[];
    onRest?(ctx: HookCtx, kind: "short" | "long"): EventDraft[];
    onSceneOpened?(ctx: HookCtx, scene: SceneState): EventDraft[];
  };
  prompt?: { parser?: string; narrator?: string };   // compact rules summaries for the model
  ui?: { sheetSections?: SheetSectionDef[]; actionHints?: ActionHintDef[] }; // declarative, rendered by generic components
}
```

Rules for plugins: same purity rules as the engine (no IO, seeded RNG only), all state changes through events, every action validated by the engine's AP/range/legality checks.

```ts
type ActionDefinition = {
  type: string;                                      // e.g. "spellcasting/cast"
  paramsSchema: ZodType;                             // becomes part of the parser's tool schema
  apCost: (params, state) => number;
  modes: Array<"exploration" | "dialogue" | "combat" | "downtime">;
  validate: (params, state, actorId) => ValidationResult;
  resolve: (params, state, actorId, rng) => EventDraft[];
  describeForParser: string;                         // one line, used in the action catalog prompt
};
```

### Planned plugins

| Plugin | Used by | Summary |
|---|---|---|
| `spellcasting` | fantasy | Spells as data; casting costs strain; miscasts on critFailure |
| `faith` | fantasy | Prayers and miracles tied to devotion and a deity's tenets |
| `firearms` | modern, sci-fi | Fire modes (single, burst, auto), recoil, suppression |
| `hacking` | cyberpunk, sci-fi | Network nodes as zones; ICE as combatants; intrusion clock |
| `cyberware` | cyberpunk | Implants with humanity/composure cost |
| `vehicles` | modern, sci-fi | Vehicle statblocks, chases, vehicle combat in zones |
| `psionics` | sci-fi | Like spellcasting with composure strain |
| `composure` | horror addon | Mental HP, fear checks, lasting traumas |

Only `spellcasting` is required for the first pack.

## The `spellcasting` plugin (fantasy-core)

- **Spells are data:** `{ id, name, school, tier (1–3), apCost (1–3), range, target, check: "Spellcasting (school)", difficulty, effects[], strain, components?, duration?, concentration? }`.
- **Effects** reuse the engine's vocabulary: `damage`, `heal`, `applyCondition`, `removeCondition`, `createZoneTag` (fog, fire, ice), `moveTarget`, `ward` (armour-like protection), `summon` (creates a combatant from a statblock), `detect`, `illusion` (opposed by Insight/Perception).
- **Strain:** casting costs strain points (tier 1: 1, tier 2: 2, tier 3: 4) that reduce HP and, past a threshold, give Exhausted levels. Magic is costly in a gritty world.
- **critFailure → miscast** from a school-specific table (backlash damage, wild effect, attracting attention, lost spell for the day).
- Learning spells: each spell is a talent purchase (classless/hybrid), a class feature (classes), or learned from a teacher or grimoire with study time (all modes).

## The starter pack: `fantasy-core`

Grounded, low-to-mid magic, roughly late-medieval. Minimum content for milestone 4–7:

| Content | Minimum |
|---|---|
| Ancestries | Human, Dwarf, Elf, Halfling (generic folklore versions) |
| Archetypes | Sellsword, Hedge Wizard, Cutpurse, Pilgrim, Hunter, Scholar |
| Classes (for class mode) | Fighter, Rogue, Mage, Priest, Ranger, Bard |
| Pack skills | Arcana, Spellcasting (Elemental, Healing, Illusion, Warding), Faith |
| Talents | ~40 across three tiers |
| Weapons / armour / gear | ~25 / ~10 / ~60 |
| Spells | ~30 across four schools |
| Creatures | ~30 statblocks (bandits, wolves, undead, cultists, beasts, a troll, a wyvern) |
| Loot tables, economy, calendar, naming | Complete |
| Pregens | 4 |
| Hand-authored world | Optional: one small starter region for testing |

Content must be **original**. Use generic folklore concepts; do not copy text, stat blocks, names or mechanics verbatim from any published game.

## Pack tooling

- `bun run wyrd pack validate <path>` — schema errors, broken references (an item that names a missing material), and balance lints (weapon damage outliers, prices out of range).
- `bun run wyrd pack new <id>` — scaffold an empty pack.
- Packs in the user's `WYRD_HOME/packs/` are discovered at startup and listed in the campaign creation wizard.

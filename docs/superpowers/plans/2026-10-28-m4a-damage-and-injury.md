# M4 Step A — Damage and Injury Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given "this attack hit with degree X", the engine rolls location and damage, applies worn armour, reduces HP, inflicts wounds with their effects, handles Down, bleeding ticks and lethal checks, all as replayable events.

**Architecture:** Pure functions in `packages/engine/src/injury/` produce `EventDraft[]` against a working state (the same draft-chaining pattern `resolvePlan` uses, extracted into a shared helper). Every number lives in `tuning.combat`; body plans and armour come from pack data. Attack checks, defence and combat state are steps B and C (see the [roadmap](2026-10-28-m4-roadmap.md)); this step starts at "the hit landed".

**Tech Stack:** Bun 1.4 workspace, TypeScript strict, zod 4, `bun:test`, Biome.

**Spec:** `docs/spec/03-combat-and-injury.md` (Attacks, Hit locations, Damage types, Armour, Hit points, Wounds, Lethal wounds, Bleeding), `docs/spec/11-subsystems.md#injuries`.

## Global Constraints

- `packages/engine` stays pure: randomness only via `Rng` from `@wyrd/core` seeded from `state.campaign.rngState`; any event that consumes RNG stores `rngAfter` and the reducer writes it back (as `CheckResolved` does).
- Every rules number goes in `Tuning`/`defaultTuning` (`packages/core/src/tuning.ts`); never hard-code it.
- New events: payload schema in `eventPayloadSchemas` (`core/src/schemas/events.ts`) + handler in `engine/src/reduce.ts`. Never edit storage migration v1.
- Rule failures return `fail(CODE, message)` from `engine/src/result.ts`; codes are stable and tested.
- Spec deviations update the spec in the same commit and add a row to `docs/decisions.md` (next free: D71).
- Run everything from the repo root. `bun run check` (typecheck → lint → tests → pack validate) must pass before each commit.
- Commit messages end with the session attribution lines from the system reminder.

## Review Focus

1. **Max HP shrinking below current HP.** A Critical wound (−10 max) on a 20-HP actor at 18 HP must leave HP ≤ 10, not 18. Test in Task 6.
2. **Damage fully absorbed by armour.** `HitResolved` is still logged (the mechanics log says it glanced off) but there's no `HpChanged` and no wound. Test in Task 7.
3. **Worn or held item ids missing from the catalog** (the pack changed under a campaign). Return `ITEM_UNKNOWN`, don't throw. Test in Task 7.
4. **Repeated hits on a downed or lethal actor.** Severity steps up but caps at critical. A second critical at the same location is lethal. HP stays at 0 and never goes negative. Test in Task 7.
5. **Replay determinism.** Folding the committed events from the log reproduces the same state and `rngState` as the live run. Test in Task 7.

---

### Task 1: Dice expressions in core

**Files:**
- Create: `packages/core/src/dice.ts`
- Modify: `packages/core/src/index.ts` (export), `packages/core/src/schemas/pack.ts:107` (use `DiceExpr` from dice.ts and export it), `packages/packs/src/lints.ts:10-15` (`averageDamage` delegates to `averageDice`)
- Test: `packages/core/test/dice.test.ts`

**Interfaces:**
- Produces: `parseDice(expr: string): { count: number; sides: number; bonus: number } | null`; `rollDice(expr: string, rng: Rng, opts?: { maximise?: boolean }): { rolls: number[]; total: number }` (throws on an unparseable expr, which pack validation has already excluded); `averageDice(expr: string): number`; `DiceExpr` zod schema (`/^\d+d\d+([+-]\d+)?$/`, plus a refine that count ≥ 1 and sides ≥ 2).

- [ ] **Step 1: Write the failing tests:** `parseDice("2d6+1")` → `{count:2,sides:6,bonus:1}`, `parseDice("1d10")` → bonus 0, `parseDice("1d0")` and `parseDice("d6")` → null. `rollDice("2d6+1", rng, {maximise:true})` → `{rolls:[6,6], total:13}` and doesn't advance the rng state. `rollDice("1d10", new Rng(seedRng(7)))` returns one roll in 1–10 and total = roll; the same seed gives the same roll twice. `averageDice("1d10")` → 5.5, `averageDice("2d6+1")` → 8.
- [ ] **Step 2:** `bun test packages/core/test/dice.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** with `rng.die(sides)` per die, and the total floored at 0 (`1d4-3` can't go negative).
- [ ] **Step 4:** Run the test → PASS, then `bun run check` → green (the lints still pass through `averageDamage`).
- [ ] **Step 5: Commit** `feat(core): dice expressions with seeded rolls`.

### Task 2: Combat tuning and the wound-effects table

**Files:**
- Modify: `packages/core/src/tuning.ts` (add `combat` to `Tuning` and `defaultTuning`)
- Test: `packages/core/test/tuning.test.ts` (create if absent)

**Interfaces:**
- Produces, in `packages/core/src/tuning.ts`:

```ts
export type LocationKind = "head" | "torso" | "arm" | "leg";
export type WoundEffect = {
  penalty?: { scope: "physical" | "movement" | "sameArm" | "all"; value: number };
  conditions?: Array<{ id: string; level?: number }>; // applied when the wound is inflicted
  bleeding?: number;                                  // Bleeding levels the wound adds
  bleedingIf?: Record<string, number>;                // by damage type; replaces bleeding and the cut bonus
  fractureIf?: string[];                              // damage types that fracture
  lethalCheck?: boolean;
  moveCost?: number; dropHeld?: boolean; armUseless?: boolean; cantStand?: boolean; // read in steps B/C
  severAtWtMultiple?: number;                         // cut only
  permanentRisk?: boolean;
  beat?: string;                                      // required narration beat, e.g. "internal injury"
};
Tuning["combat"] = {
  woundThresholdMultiples: { minor: 1; serious: 2; critical: 3 };
  hpMaxReduction: { minor: 2; serious: 5; critical: 10 };
  strBonusBase: 5; strBonusDivisor: 2;   // floor((STR − 5) / 2)
  maxArmourLayers: 2;
  critArmourDivisor: 2;
  cutBleedingBonus: 1; maxBleeding: 3;
  downCheck: "normal"; lethalCheck: "hard";
  unarmed: { damage: "1d3"; damageType: "blunt" };
  woundEffects: Record<LocationKind, Record<"minor" | "serious" | "critical", WoundEffect>>;
  simpleWoundPenalty: { minor: -10; serious: -20; critical: -30 };
};
```

`woundEffects` encodes the spec 03 humanoid table exactly:
- **head.** minor: Dazed, Bleeding 1. serious: Stunned, Concussed, Bleeding 1. critical: Unconscious, Concussed, Bleeding 2, lethalCheck, permanentRisk.
- **torso.** minor: Bleeding 1, physical −10. serious: Bleeding 2, physical −20, fractureIf [blunt]. critical: Bleeding 3, conditions [core:down], lethalCheck, beat "internal injury".
- **arm.** minor: sameArm −10. serious: dropHeld, sameArm −20, fractureIf [blunt], bleedingIf {cut: 2}. critical: armUseless, Bleeding 3, severAtWtMultiple 4.
- **leg.** minor: movement −10. serious: conditions [core:prone], moveCost 2, fractureIf [blunt]. critical: cantStand, Bleeding 3, permanentRisk.

- [ ] **Step 1: Write the failing test:** `defaultTuning.combat.woundEffects.head.critical` has `lethalCheck: true` and `bleeding: 2`; `torso.critical.conditions` contains `{id:"core:down"}`; `arm.serious.bleedingIf.cut === 2`; `defaultTuning.combat.hpMaxReduction.critical === 10`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Add the type and defaults. **Step 4:** Run → PASS; `bun run check` green.
- [ ] **Step 5: Commit** `feat(core): combat tuning and humanoid wound-effects table`.

### Task 3: Body plans in packs

**Files:**
- Modify: `packages/core/src/schemas/pack.ts` (add `BodyPlanDef`, `bodyPlans` on `CompiledPack`), `packages/packs/src/loader.ts` (load `bodyplans.yaml`, namespace ids like other content), `packages/core/src/schemas/sheet.ts` (add `bodyPlan: ContentId` defaulting to the plain id `"humanoid"` resolved at creation), `packages/engine/src/creation.ts` (copy `ancestry.bodyPlan`)
- Create: `packs/fantasy-core/bodyplans.yaml`, `packages/engine/test/fixtures.ts` addition `humanoidPlan`
- Test: `packages/packs/test/bodyplans.test.ts`

**Interfaces:**
- Produces: `BodyPlanDef = { id; name; locations: Array<{ id: string; name: string; kind: LocationKind; side?: "left" | "right"; from: number; to: number; multiplier: number /* default 1 */ }> }`. The loader rejects a plan whose `from`/`to` ranges don't cover 1–100 exactly once (issue code `BODYPLAN_RANGES`). `CompiledPack.bodyPlans: Record<string, BodyPlanDef>`.
- `fantasy-core` humanoid locations use the ids `head, torso, right-arm, left-arm, right-leg, left-leg` (they match `armor.yaml` `covers`) and the spec ranges 1–10, 11–50, 51–60, 61–70, 71–85, 86–100. The head multiplier is 1.5.

- [ ] **Step 1: Write the failing tests:** loading `packs/fantasy-core` yields a humanoid plan with 6 locations and a head multiplier of 1.5. A plan with ranges 1–10 and 12–100 fails with `BODYPLAN_RANGES`. A sheet built for a humanoid ancestry has its `bodyPlan` set.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `bun run check` green (pack validate included).
- [ ] **Step 5: Commit** `feat(packs): body plans with validated hit-location tables`.

### Task 4: Equipment on the sheet

**Files:**
- Modify: `packages/core/src/schemas/sheet.ts` (add `equipment`), `packages/core/src/schemas/events.ts` (add `EquipmentChanged`), `packages/engine/src/reduce.ts`, `packages/engine/src/creation.ts`, plus every path that turns an archetype or a generated background into a sheet (grep `suggestedAttributes` and `kit`; at least `apps/cli` sheet build and `packages/packs/src/generated.ts`)
- Create: `packages/engine/src/equipment.ts`
- Test: `packages/engine/test/equipment.test.ts`

**Interfaces:**
- Produces: `Equipment = { held: { main: ContentId | null; off: ContentId | null }; worn: ContentId[]; carried: Array<{ item: ContentId; qty: number }> }`, defaulting to empty. Invariant: held and worn items also appear in `carried`.
- `ItemCatalog = Pick<CompiledPack, "weapons" | "armor" | "gear">`. Use the real `CompiledPack` key names, which may be `items.weapons` and so on; check pack.ts:154.
- `startingEquipment(kit: KitEntry[], items: ItemCatalog): Equipment`: every kit entry goes into carried; the first weapon is held in main; all armour is worn.
- `validateEquipment(eq: Equipment, items: ItemCatalog): Result<Equipment>`. Its error codes are `ITEM_UNKNOWN`, `ITEM_NOT_CARRIED`, `TWO_HANDED_OCCUPIED` (a two-handed main weapon with a non-null off hand) and `NOT_ARMOUR` (a worn id that isn't armour).
- Event `EquipmentChanged { actorId: ActorId; equipment: Equipment }`. The reducer replaces `sheet.equipment`.

- [ ] **Step 1: Write the failing tests:** the cutpurse kit gives `held.main` = the namespaced dagger and lockpicks in carried. A kit with mail-hauberk and open-helmet wears both. A light crossbow in main with a dagger in off fails with `TWO_HANDED_OCCUPIED`. A worn id that's absent from the catalog fails with `ITEM_UNKNOWN`. Committing `EquipmentChanged` through `Sim` updates the sheet.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and wire the kit into the sheet-building paths. **Step 4:** Run → PASS; `bun run check` green (the CLI and server tests still pass).
- [ ] **Step 5: Commit** `feat(engine): equipment on the sheet from archetype kits`.

### Task 5: Shared working-state helper

**Files:**
- Create: `packages/engine/src/working.ts`
- Modify: `packages/engine/src/exploration.ts:313-340` (use it; no behaviour change)
- Test: `packages/engine/test/working.test.ts`

**Interfaces:**
- Produces: `class Working { constructor(state: GameState); state: GameState; readonly events: EventDraft[]; apply(drafts: EventDraft[]): void }`. `apply` reduces each draft into `state` with throwaway envelope fields, exactly as the current `resolvePlan` closure does, and pushes it onto `events`.

- [ ] **Step 1: Write the failing test:** applying a `ConditionApplied` draft updates `w.state` and `w.events.length === 1`, and the original state object is untouched.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and switch `resolvePlan` over to it. **Step 4:** Run the new test and `packages/engine/test/exploration.test.ts` → PASS.
- [ ] **Step 5: Commit** `refactor(engine): share the working-state draft helper`.

### Task 6: Injury events, Down condition and effective max HP

**Files:**
- Modify: `packages/core/src/schemas/events.ts`, `packages/core/src/schemas/sheet.ts` (Wound: add `locationKind: LocationKind`, `fracture: boolean` (default false), `severed: boolean` (default false)), `packages/engine/src/reduce.ts`, `packages/engine/src/conditions.ts` (add `core:down`, no `onCheck`)
- Create: `packages/engine/src/injury/hp.ts`
- Test: `packages/engine/test/injury-events.test.ts`

**Interfaces:**
- Produces these events:
  - `HitResolved { attackerId: ActorId | null; targetId: ActorId; weaponId: ContentId | null; location: string; locationRoll: number | null; damageRolls: number[]; raw: number; protection: number; final: number; crit: boolean; rngAfter: RngState }`. The reducer writes `rngAfter` to `campaign.rngState`.
  - `HpChanged { actorId; hp: int ≥ 0; delta: int; cause: "damage" | "bleeding" | "healing" }`. The reducer sets `status.hp = min(hp, effectiveHpMax(sheet))`.
  - `WoundInflicted { actorId; wound: Wound }`. The reducer appends the wound, then clamps `status.hp` to the new effective max.
  - `WoundWorsened { actorId; woundId: string; severity: WoundSeverity }`.
- `effectiveHpMax(sheet: CharacterSheet): number` = `derived.hpMax − Σ wounds.hpMaxReduction`, floored at 0.

- [ ] **Step 1: Write the failing tests:** an actor with default attrs has hpMax 20. Committing `HpChanged {hp: 18}` and then a critical `WoundInflicted` with `hpMaxReduction: 10` leaves hp 10 (Review Focus 1). `WoundWorsened` changes the severity. `HitResolved` updates `campaign.rngState`. `applyCondition(state, "pc", {id: "core:down"})` succeeds.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `bun run check` green (the registry/reducer parity test covers the new events).
- [ ] **Step 5: Commit** `feat(engine): HP, wound and hit events with effective max HP`.

### Task 7: Resolve a hit

**Files:**
- Create: `packages/engine/src/injury/damage.ts` (pure math), `packages/engine/src/injury/hit.ts`, `packages/engine/src/injury/index.ts`; export from `packages/engine/src/index.ts`
- Test: `packages/engine/test/injury-damage.test.ts`, `packages/engine/test/injury-hit.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  - `type InjuryContext = RulesContext & { items: ItemCatalog; bodyPlans: Record<string, BodyPlanDef> }`.
  - `locationFor(plan: BodyPlanDef, roll: number): BodyPlanDef["locations"][number]`.
  - `protectionAt(worn: ArmorDef[], locationId: string, damageType: string, maxLayers: number): number`. This is the sum of the best `maxLayers` protections among the pieces that cover the location.
  - `computeDamage(i: { raw: number; protection: number; armorPiercing: number; crit: boolean; multiplier: number }, t: Tuning["combat"]): { protection: number; final: number }`. If crit, protection is `floor(protection / critArmourDivisor)`. Then effective = `max(0, protection − AP)`, and final = `floor(max(0, raw − effective) × multiplier)`.
  - `woundSeverity(final: number, wt: number, wasDown: boolean, t): WoundSeverity | null`. It returns null below WT unless the actor `wasDown && final > 0` (then minor); a down actor's severity steps up once, capped at critical.
  - `resolveHit(state: GameState, hit: HitInput, ctx: InjuryContext): Result<HitOutcome>` with

```ts
type HitInput = { attackerId: ActorId | null; targetId: ActorId; weaponId: ContentId | null /* null = unarmed */;
                  degree: "success" | "critSuccess"; calledLocation?: string };
type HitOutcome = { events: EventDraft[]; location: string; final: number; wound: Wound | null;
                    downed: "down" | "unconscious" | null;
                    lethal: { woundId: string; fate: "defeated" | "dying"; immediate: boolean; deathInRounds: number } | null;
                    beats: string[] };
```

- `lethalFate(state, actorId): "defeated" | "dying"` follows the spec 03 table. PC: hardcore → dying, otherwise defeated. Companion: `structural.hardcore || companionDeath` → dying, otherwise defeated. NPC: dying.

`resolveHit` runs in this order on a `Working`:
1. Location: the called location, or `rng.die(100)` against the target's body plan.
2. Damage: roll the weapon dice (maximised on a crit) plus the STR bonus. The STR bonus applies only when the weapon's `strengthBonus` is true. Add a `strengthBonus?: boolean` field to `WeaponDef`; the loader defaults it to true unless the weapon's skill local id is `ranged`.
3. Armour: `computeDamage` against the target's worn armour.
4. Emit `HitResolved`.
5. If final > 0, emit `HpChanged`.
6. If HP went from above 0 to 0, roll an END check at `downCheck` via `resolveCheck`. Success applies `core:down`; failure applies `core:unconscious`.
7. Wound: severity comes from `woundSeverity`, with `wasDown` true when HP was 0 before this hit. Build the wound from `woundEffects[kind][severity]`, honouring the settings:
   - `injuries: "simple"` applies only the flat `simpleWoundPenalty`, with Down on a critical.
   - `bleeding` off skips bleeding.
   - `fractures` off skips the fracture flag.
   - Cut damage adds `cutBleedingBonus` up to `maxBleeding`, unless `bleedingIf` applies. Burn never bleeds.
   - The added bleeding sums onto the existing `core:bleeding` level, capped at `maxBleeding`.
   - Sever when a cut's `final ≥ severAtWtMultiple × WT`.
8. Emit `WoundInflicted` and `ConditionApplied` events.
9. Lethal: a second critical at the same location is lethal outright. Otherwise, when the effect has `lethalCheck`, roll END at `lethalCheck`: failure means lethal, and critFailure means lethal and immediate. A lethal wound emits `WoundWorsened → lethal`, applies Unconscious, and sets Bleeding to `maxBleeding` (if bleeding is on). Its `deathInRounds` = the END attribute.
10. Collect `beats` from each effect's `beat`.

Error codes: `ACTOR_UNKNOWN`, `ITEM_UNKNOWN` (weapon or worn armour), `BODYPLAN_UNKNOWN`, `LOCATION_UNKNOWN` (bad `calledLocation`).

- [ ] **Step 1: Write the failing pure-math tests (`injury-damage.test.ts`), using the spec's numbers:**
  - `locationFor` for the rolls 1, 10, 11, 50, 51, 60, 61, 70, 71, 85, 86 and 100 returns head, head, torso, torso, right-arm, right-arm, left-arm, left-arm, right-leg, right-leg, left-leg, left-leg.
  - `protectionAt([padded, leather, mail], "torso", "cut", 2)` = 9.
  - `computeDamage({raw:9, protection:9, armorPiercing:2, crit:false, multiplier:1})` → final 2. With `crit:true` → protection 4, final 7.
  - Head: `{raw:12, protection:4, armorPiercing:2, multiplier:1.5}` → final 15.
  - `woundSeverity` with WT 7: 6 → null, 7 → minor, 14 → serious, 21 → critical. `(3, 7, wasDown: true)` → minor; `(14, 7, true)` → critical; `(21, 7, true)` → critical.
- [ ] **Step 2: Write the failing integration tests (`injury-hit.test.ts`).** Use `Sim` with a default-attribute target (HP 20, WT 7) and the `seedWhere` pattern from `checks.test.ts` to force rolls:
  - Called torso, unarmed, an unarmoured target, with damage forced to 3 (use a test-only weapon `1d1+2` in a fixture catalog): HP 17, no wound.
  - A 7-damage cut to the torso: a minor wound, `core:bleeding` level 2 (1 + the cut bonus), hpMax 18, and a physical −10 penalty recorded on the wound.
  - A blunt torso hit of ≥14: serious, with `fracture: true`. The same hit with `fractures: false` gives `fracture: false`.
  - **Review Focus 2.** A torso hit fully absorbed by armour gives `final: 0`, a `HitResolved` event, and no `HpChanged` or `WoundInflicted`.
  - **Review Focus 3.** A worn id that's not in the catalog gives `ITEM_UNKNOWN`.
  - **Review Focus 4.** A target at 0 HP takes a 3-damage hit and gets a minor wound with HP still 0. Two critical torso wounds produce `lethal` on the second without rolling.
  - A hit to 0 HP where the END check succeeds applies `core:down`; one where it fails applies `core:unconscious`.
  - A critical head wound whose lethal check fails, on a PC in a normal campaign: `lethal.fate === "defeated"`, `deathInRounds === 5`. In hardcore it's `"dying"`.
  - `injuries: "simple"`: a critical wound has a penalty of −30 on `all`, applies `core:down`, and no bleeding.
  - **Review Focus 5.** Committing the outcome's events via `Sim`, then `fold(sim.events)`, gives a state deep-equal to `sim.state`, including `rngState`.
- [ ] **Step 3:** Run both test files → FAIL.
- [ ] **Step 4: Implement** `damage.ts`, then `hit.ts`.
- [ ] **Step 5:** Run → PASS; `bun run check` green.
- [ ] **Step 6: Commit** `feat(engine): resolve hits into damage, wounds, Down and lethal checks`.

### Task 8: Wound penalties on checks

**Files:**
- Modify: `packages/engine/src/checks.ts:48` (`prepareCheck` adds wound modifiers next to `conditionEffects`)
- Create: `packages/engine/src/injury/penalties.ts`
- Test: `packages/engine/test/injury-penalties.test.ts`

**Interfaces:**
- Produces: `woundModifiers(sheet: CharacterSheet, ctx: CheckContext, t: Tuning["combat"], injuries: "simple" | "realistic"): Modifier[]`. Each wound gives one modifier labelled like `"Serious torso wound"`:
  - Realistic mode uses the wound's `penalty` scope. `physical` applies when `ctx.attribute` ∈ {str, agi, end}. `movement` applies when `ctx.tags` includes `"movement"`. `sameArm` applies when `ctx.tags` includes `"hand:<side>"` for that arm. `all` always applies.
  - Simple mode always applies `simpleWoundPenalty[severity]`.
  - A lethal wound counts as critical.
  - The existing modifier cap still applies.

- [ ] **Step 1: Write the failing tests:**
  - A minor torso wound gives −10 on an Athletics check (str) and nothing on a Perception check (awa).
  - A serious right-arm wound gives −20 on a check tagged `hand:right` and nothing on one tagged `hand:left`.
  - A minor leg wound gives −10 on a check tagged `movement`.
  - In simple mode, a critical wound gives −30 on Perception.
  - `prepareCheck` includes the wound modifier in `prepared.modifiers`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run the new tests plus `checks.test.ts` → PASS; `bun run check` green.
- [ ] **Step 5: Commit** `feat(engine): wound penalties on checks`.

### Task 9: Bleeding ticks

**Files:**
- Create: `packages/engine/src/injury/bleeding.ts`
- Test: `packages/engine/test/injury-bleeding.test.ts`

**Interfaces:**
- Produces: `bleedTick(state: GameState, actorId: ActorId, ctx: InjuryContext): Result<{ events: EventDraft[]; worsened: "unconscious" | "lethal" | null }>`.
  - Bleeding N with HP > 0 emits `HpChanged` for −N with cause `bleeding`, floored at 0. Reaching 0 triggers the same Down check as Task 7; extract that check into a shared helper in `hit.ts`.
  - At 0 HP it rolls END at `downCheck` instead. On failure, Down becomes Unconscious (remove `core:down`, apply `core:unconscious`). An actor already Unconscious instead has their most severe wound worsened to lethal (`WoundWorsened`, plus Bleeding set to max).
  - With no bleeding, or with the `bleeding` setting off, it returns no events.
  - Steps B and C call it at the end of the bleeder's turn. Out-of-combat per-minute bleeding hooks into `TimeAdvanced` in step B.

- [ ] **Step 1: Write the failing tests:**
  - Bleeding 2 at 10 HP → HP 8.
  - Bleeding 3 at 2 HP → HP 0, then a Down check.
  - At 0 HP and Down with a failed END check → Unconscious, and `core:down` removed.
  - At 0 HP and Unconscious with a failed END check → the most severe wound becomes lethal.
  - `bleeding: false` → no events.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `bun run check` green.
- [ ] **Step 5: Commit** `feat(engine): bleeding ticks and worsening at 0 HP`.

### Task 10: Record the decisions and update the handoff

**Files:**
- Modify: `docs/decisions.md` (D71–D74), `docs/spec/03-combat-and-injury.md` (only where behaviour was pinned down), `HANDOFF.md` (add an M4 section: step A done, what B needs), `docs/superpowers/plans/2026-10-28-m4-roadmap.md` (mark A done)

Decisions to record:
- **D71.** M4 is built in steps A–G. Infection, fracture setting and healing, healing over days, rests and permanent injuries move to M5, because they need the calendar and world ticks. Chases also move to M5, because they need clocks.
- **D72.** Wound effects are keyed by location *kind* (head/torso/arm/leg) in `tuning.combat.woundEffects`. Pack body plans map each location to a kind. Other plans (quadruped and so on) reuse the kinds in step D.
- **D73.** Cut damage adds +1 Bleeding even to wounds that otherwise don't bleed (leg minor). Arm-serious `bleedingIf` replaces the bonus. A wound's bleeding sums onto the current level, capped at 3.
- **D74.** `HpChanged` stores the resulting HP, and the reducer clamps it to the effective max. Weapons get `strengthBonus`, which defaults to true except for skill `ranged`. Unarmed is `1d3 blunt` from tuning.

- [ ] **Step 1:** Write the docs. **Step 2:** `bun run check` and `bun run test:e2e` → green.
- [ ] **Step 3: Commit** `docs: record M4 step A decisions and handoff`.

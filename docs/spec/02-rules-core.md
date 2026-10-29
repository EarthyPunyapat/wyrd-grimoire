# 02 — Rules core

The universal rules every genre shares. Genre packs add skills, abilities, items and creatures as data; plugins add subsystems. Nothing in this file is genre-specific.

All numbers below are tuning defaults (see [01-architecture.md](01-architecture.md#configuration)).

## Attributes

Seven attributes, rated **1–10**. Human average 5, trained/fit 6–7, peak human 8. 9–10 are exceptional and usually need a pack ability, species or cybernetics.

| Attribute | Abbr | Covers |
|---|---|---|
| Strength | STR | Lifting, hitting hard, carrying |
| Agility | AGI | Speed, balance, precision, reflexes |
| Endurance | END | Toughness, stamina, resisting poison and disease |
| Intellect | INT | Reasoning, memory, learning, technical skill |
| Awareness | AWA | Senses, intuition, reading people and places |
| Willpower | WIL | Grit, focus, resisting fear and magic |
| Presence | PRE | Force of personality, charm, leadership |

**Attribute check:** target = attribute × 10 (as a 0–100 skill value).

### Derived stats

| Stat | Formula (default) | Notes |
|---|---|---|
| Hit points (HP) | 10 + END × 2 | Average human 20. Stamina and near-misses, not flesh. |
| Wound threshold (WT) | END + floor(STR / 2) | Average 7. Damage in one hit ≥ WT causes a wound. See [03](03-combat-and-injury.md#wounds). |
| Carry capacity | STR × 5 kg unencumbered | Encumbrance levels in [11](11-subsystems.md#inventory-and-encumbrance) |
| Initiative | AGI × 5 + AWA × 5 (as a skill value) | Rolled at combat start |
| Luck (max) | From the lethality dial; Gritty default 3 | See [Luck](#luck) |
| Composure | 10 + WIL × 2 | Mental HP for fear, stress and horror plugins; only used if a plugin enables it |

## Skills

Skills are stored on one canonical scale: **0–100**, representing percent chance of success at Normal difficulty. The d20 module converts this for display and rolling. Skills never exceed 99 effective.

- **Untrained value** = governing attribute × 3 (average 15).
- **Trained value** = untrained value + trained points.
- Each skill has a **governing attribute**. Some skills list two; use the higher.
- **Field skills** take a specialisation and are separate skills: `Lore (History)`, `Craft (Smithing)`, `Language (Elvish)`.

### Core skills (every pack)

| Group | Skill | Attribute |
|---|---|---|
| Combat | Melee | STR or AGI |
| | Ranged | AGI |
| | Unarmed | STR or AGI |
| | Dodge | AGI |
| | Throwing | AGI |
| Physical | Athletics | STR |
| | Acrobatics | AGI |
| | Stealth | AGI |
| | Sleight of Hand | AGI |
| | Riding / Driving (field) | AGI |
| Senses | Perception | AWA |
| | Insight | AWA |
| | Survival | AWA |
| | Navigation | INT or AWA |
| Social | Persuasion | PRE |
| | Deception | PRE |
| | Intimidation | PRE or STR |
| | Performance (field) | PRE |
| | Streetwise | PRE or AWA |
| Knowledge | Lore (field) | INT |
| | Investigation | INT |
| | Medicine | INT |
| | Mechanics | INT |
| | Craft (field) | INT or AGI |
| | Language (field) | INT |

Packs add skills (e.g. fantasy: `Arcana`, `Spellcasting (school)`, `Faith`; cyberpunk: `Firearms`, `Hacking`, `Electronics`, `Cybernetics`, `Piloting`). Pack skills declare a governing attribute and optional plugin bindings.

## Checks

A check is the engine's only way to decide an uncertain outcome.

### When to roll

- **Roll only when the outcome is uncertain and failure would be interesting.** The parser is instructed accordingly.
- **Trivial** tasks succeed without a roll. **Impossible** tasks fail without a roll, and the engine explains why.
- Each check costs in-game time (a few seconds in combat, minutes or hours for research, crafting, searching).

### Check request

```ts
type CheckRequest = {
  actorId: ActorId;
  skill: SkillId | { attribute: AttributeId };
  difficulty: "easy" | "normal" | "hard" | "extreme" | "heroic"; // trivial/impossible never reach resolution
  modifiers: Array<{ source: string; value: number }>;            // in percent, e.g. { source: "darkness", value: -20 }
  boons: number;   // 0..2, from advantages
  banes: number;   // 0..2, from disadvantages; net = boons - banes
  opposedBy?: { actorId: ActorId; skill: SkillId | { attribute: AttributeId } };
  purpose: string; // short human-readable reason, shown in the mechanics log
  pushed?: boolean;
  tags: string[];  // what kind of check, for conditions: "sight", "hearing", "attack", "escape", "resist", "fear"…
};

type CheckResult = {
  degree: "critSuccess" | "success" | "failure" | "critFailure";
  margin: number;            // module-specific, positive = by how much it passed
  rolls: number[];           // every die rolled, recorded in the event
  display: MechanicsLine;    // pre-rendered text for the mechanics log
};
```

### Difficulty ladder

| Difficulty | Shift (percent) | d20 DC |
|---|---|---|
| Easy | +20 | 7 |
| Normal | 0 | 11 |
| Hard | −20 | 15 |
| Extreme | −40 | 19 |
| Heroic | −60 | 23 |

**Who sets difficulty:** first, engine rule tables when the situation is tagged (lock quality, climbing surface, a creature's stats, a pack's item data). Otherwise the parser proposes a difficulty with a one-line reason; the engine clamps it to the range allowed for that check type and logs the reason. The campaign difficulty setting adds a global modifier to the player side (Story +10, Standard 0, Hard −10).

### Modifiers

Modifiers are in percent (the d20 module divides by 5). They come from conditions, wounds, equipment, environment, and help from others. They **sum**, with the total clamped to **±40**. The campaign difficulty modifier counts towards that sum. Anything beyond that should be expressed as a difficulty step or as boons/banes.

Common situational modifiers (pack-extensible):

| Situation | Modifier |
|---|---|
| Dim light / heavy rain | −20 |
| Darkness without sight aid | −40 (or bane) |
| Good tools / ideal conditions | +20 |
| Improvised tools | −20 |
| Assisted by a capable ally | +10 (once) |
| Rushed (half the normal time) | −20 |
| Taking ten times the normal time | +20 (not in combat) |

### Boons and banes

Net boons (−2 to +2) represent clear advantages or disadvantages that shouldn't be a flat modifier (high ground in a duel, attacking someone who can't see you). They change the dice, not the target.

## Resolution modules

The dice system is chosen per campaign at creation and then locked. Both modules implement:

```ts
interface ResolutionModule {
  id: "d100" | "d20";
  resolve(req: CheckRequest, actor: ActorView, rng: Rng): CheckResult;
  resolveOpposed(a: CheckRequest, b: CheckRequest, rng: Rng): OpposedResult;
  displaySkill(value: number): string;    // "65%" or "+3"
  describe(result: CheckResult): MechanicsLine;
}
```

Everything downstream — damage, conditions, narration — only consumes the **degree** and **margin**.

### d100 (default)

Target **T** = skill + modifiers + difficulty shift, clamped to **1–99**.

Roll 1d100 (01–100):

| Result | Degree |
|---|---|
| roll ≤ max(1, floor(T / 5)) | **critSuccess** (01 is always critSuccess) |
| roll ≤ T | **success** |
| roll = 100, or roll ≥ 96 when T < 50 | **critFailure** |
| otherwise | **failure** |

- **Margin** = T − roll.
- **Boons/banes:** roll the units die once and the tens die 1 + |net| times; keep the **lowest** tens result for boons, the **highest** for banes.
- **Display:** `Stealth 65% · Hard (−20) → 45% · rolled 38 · Success`.

### d20 (option)

- **Modifier** m = round((skill − 50) / 5) + round(Σ modifiers / 5), rounding halves away from zero so the conversion is symmetric around 50.
- **DC** from the difficulty ladder (Normal 11).
- Roll d20 + m against DC.

| Result | Degree |
|---|---|
| total ≥ DC + 10 | **critSuccess** |
| total ≥ DC | **success** |
| total ≤ DC − 10 | **critFailure** |
| otherwise | **failure** |

- A natural 20 moves the result one degree up; a natural 1 moves it one degree down.
- **Boons/banes:** net +1 = roll 2d20 keep highest (advantage); net +2 = advantage and +2. Mirrored for banes.
- **Margin** = total − DC.
- **Display:** `Stealth +3 vs DC 15 (Hard) · rolled 14 + 3 = 17 · Success`.

**Equivalence check (must be a unit test):** with no modifiers at Normal difficulty, P(d20 success) = (10 + m) / 20 = skill / 100, i.e. identical base odds to d100 at every multiple of 5. The modules differ in swinginess and critical rates, not in average competence.

### Opposed checks

Both sides roll with their own modules' rules (always the campaign's module). Higher degree wins. Equal degrees → higher margin wins. Still tied → the defender (status quo) wins.

### Extended tasks

Long or complex tasks (research a cult, crack a vault, build a boat) use a **progress clock** of N segments (4, 6, 8 or 12). Each attempt is a check that takes a set amount of in-game time: critSuccess +3 segments, success +2, failure +0, critFailure +0 and a complication. Clocks are engine state, visible in the UI.

## Pushing a roll

After a failed non-combat check, the player may **push** it once: describe how they try harder or take a risk, and reroll. If the pushed roll also fails, the result becomes a **critFailure** and the narrator must apply a real consequence (an alarm, an injury, a broken tool, lost time, a burned bridge). Pushing is free; it is about raising the stakes, not resources. Only a plain **failure** can be pushed: not a critFailure, an automatic failure (e.g. a sight check while Blinded), or an opposed check.

## Luck

A small pool the player spends to bend fate.

| Lethality dial | Luck max | Notes |
|---|---|---|
| Gritty (default) | 3 | |
| Brutal | 1 | |
| Hardcore campaign | max − 1 (minimum 1) | Applied on top of the dial |

- **Spend 1 Luck:** reroll any one of the PC's checks (including attacks and resistance checks) and keep the better result. Not usable on a pushed roll, and once per check. (Luck on opposed checks, e.g. attack vs Dodge, arrives with combat in M4.)
- **Spend 2 Luck:** downgrade a **lethal** wound to **critical** (see [03](03-combat-and-injury.md#wounds)). This is what keeps one bad roll from ending a 50-hour campaign.
- **Regain:** 1 point when a chapter closes ([07](07-memory.md#memory-pyramid)); refill to max when an arc closes. Pack abilities may grant more.
- Companions do not have Luck.

## Conditions

Conditions are engine-tracked effects with a defined mechanical meaning. Packs and plugins may add more.

| Condition | Effect | Ends |
|---|---|---|
| Prone | −20 to melee and Dodge; melee attackers +20; ranged attackers from far −20; standing up costs 1 AP | Stand up |
| Grappled | Can't move zones; −20 to actions except escaping | Escape (opposed Athletics/Acrobatics) |
| Restrained | Can't move; banes on attacks and Dodge; attackers gain a boon | Freed |
| Stunned | Lose 2 AP next turn; no reactions | Next turn ends |
| Dazed | Lose 1 AP next turn | Next turn ends |
| Blinded | Sight-based checks fail; attacks −40; attackers gain a boon | Cause removed |
| Deafened | Hearing-based checks fail | Cause removed |
| Frightened | Can't willingly approach the source; −20 to actions while it is in view | WIL check at end of each turn, or leaving its presence |
| Concussed | −20 to INT and AWA checks; risk of unconsciousness on further head hits | Rest and treatment, days |
| Bleeding (1–3) | Loses HP each round (see [03](03-combat-and-injury.md#bleeding)) | Treated |
| Burning | 1d6 fire damage per round | Spend 1 AP to put out, or water |
| Poisoned | Per poison | Per poison |
| Exhausted (1–5) | −10 per level to all checks; at 5, unconscious | Rest |
| Unconscious | Can't act (only resistance checks, tagged `resist`, are allowed); attacks against them are critical on success | Woken or recovers |
| Hidden | Attacks against it need Perception first; its first attack gains a boon | Revealed |
| In Cover (partial/full) | −20 / −40 to ranged attacks against it | Leaves cover |
| Intoxicated (1–3) | −10 per level to AGI/INT/AWA checks; +10 to resist fear | Time |
| Inspired | One boon on the next check | Used |

Survival conditions (hungry, thirsty, cold, overheated) live in the survival subsystem ([11](11-subsystems.md#survival)).

## The mechanics log

Every resolution produces a `MechanicsLine` shown in the collapsible mechanics log under the narration when "Show the math" is on. Lines are pre-rendered by the resolution module so the UI never re-implements rules. The narrator receives the same structured result (not the rendered line) and MUST narrate an outcome consistent with it.


## Cosmic Levels (W2, D130/D131)

Characters carry `level` (positive integer, open beyond 20, or `"infinite"`), optional `effectiveLevel`, and ranked abilities. Existing sheets default to `tuning.levels.start` and no abilities. Effective levels determine resolution; the underlying level determines cosmetic power rating. Class progression remains separate.

In d20 campaigns the actor's effective level minus the opposition's gives Δ. Equal levels use the ordinary d20 skill/situational modifiers plus `ceil(selected ability rank / tuning.levels.rankBonus.divisor)`. At ±1, use ±`oneStepBonus` instead of the rank bonus. At a gap of `autoGap` or more, the higher side succeeds without dice; the lower side fails without dice unless a tool call cites an exploit, in which case it rolls at −`oneStepBonus`. An unopposed check defaults to an equal-level challenge. Opposed checks and combat strikes compare the actual opposing actors.

Infinity never rolls, including in legacy d100 campaigns. Finite opposition cannot overcome infinity by citing an exploit; infinite-vs-infinite is a no-roll stalemate (failure/ties retain the defender's position). A seal's finite effective level allows ordinary resolution. Finite d100 resolution is unchanged.

The power rating is `floor(base^(exponent × level) × (1 + sum(ranks)/rankDivisor))`, using `tuning.levels.powerRating`; infinity displays ∞. Beyond JavaScript's numeric range, finite ratings display a magnitude label such as `10^451+`, distinct from infinity.

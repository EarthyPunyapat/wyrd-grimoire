# 03 — Combat and injury

Combat is gritty and realistic by design: hit locations, armour that covers specific body parts, bleeding, fractures, infection, and healing measured in days and weeks. A small Luck pool and the defeat-not-death default keep one bad roll from ending a long campaign. Hardcore mode removes the safety net.

All numbers are tuning defaults.

## Scenes and zones

Positioning is abstract. A combat scene is a **zone graph**.

```ts
type Zone = {
  id: ZoneId;
  name: string;                       // "the bar", "the doorway", "behind the altar"
  tags: Array<"coverPartial" | "coverFull" | "difficult" | "elevated" | "dim" | "dark"
             | "hazard:fire" | "hazard:water" | "narrow" | "aerial" | string>;
  props: Prop[];                       // tables, barrels, chandelier, crates…
  capacity?: number;                   // narrow places
};
type ZoneEdge = { a: ZoneId; b: ZoneId; moveCost: 1 | 2; blocksSight?: boolean; requires?: string }; // e.g. requires "climb"
type Prop = { id: string; name: string; affordances: Array<"cover" | "climb" | "throw" | "flammable"
             | "topple" | "hide" | "breakable" | "light" | string> };
```

- When combat starts at a location that already has a zone map in canon, the engine reuses it. Otherwise the narrator role is asked to generate one via the `propose_zone_map` tool (3–7 zones, tags, props, edges). The engine validates it (connected graph, sane tags) and commits it to canon for that location. The same tavern always has the same layout.
- Initial positions are proposed by the model from the fiction and validated by the engine.
- Props give free-text stunts something real to act on ("kick the table over" needs a table with `topple`).

### Range bands

| Band | Meaning |
|---|---|
| Engaged | In melee with the target (a relationship inside a zone) |
| Close | Same zone, not engaged |
| Near | 1 zone away |
| Far | 2–3 zones away |
| Distant | 4+ zones away |

Weapons list the bands they work in, with penalties outside their best band (data in packs). Example: bows are best at Near–Far, −20 at Distant, and −20 when firing while engaged. Line of sight exists between zones unless an edge or zone blocks sight.

### Engagement

- Moving within your zone to engage someone is part of a Move.
- Leaving an engagement without the **Disengage** action lets each engaged enemy spend its reaction on an **opportunity attack**.

## Turn order

- **Surprise:** if one side is unaware, resolve Stealth vs Perception (opposed). Surprised combatants lose 2 AP in round 1 and have no reaction until their first turn.
- **Initiative:** every combatant makes an Initiative check (AGI × 5 + AWA × 5). Order by degree, then margin; ties go to higher AGI, then to the PC. Order is fixed for the fight; arrivals roll when they enter.
- **Groups:** identical minions may share one initiative slot to speed play.
- **Delay:** a combatant may delay to a later point in the round.

## Action points

Every combatant gets **3 AP** per turn and **1 reaction** per round.

| Action | AP | Notes |
|---|---|---|
| Move | 1 | To an adjacent zone (2 AP if `difficult`/climb), or within your zone to engage or withdraw |
| Strike | 1 | Melee, ranged, unarmed or thrown attack. 2nd attack in a turn −20, 3rd −40 (agile weapons −10/−20) |
| Aim | 1 | +20 to your next ranged attack; stacks twice (+40) |
| Defend | 1 | +20 to Dodge/Parry until your next turn and one extra defence-only reaction |
| Take Cover | 1 | Requires a zone or prop with cover |
| Draw / stow / swap | 1 | Talents can make this free |
| Reload | weapon data | Bow 0 (part of the shot), pistol 1, crossbow 2, musket 3 |
| Use item | 1 | Potion, grenade, tool |
| First aid | 2 | Medicine check; see [Bleeding](#bleeding) |
| Grapple | 1 | Opposed Athletics/Unarmed vs Athletics/Acrobatics → Grappled |
| Shove / Trip | 1 | Opposed; push to an adjacent zone or knock Prone |
| Disarm | 1 | Attack at −20; success makes the target drop a held item |
| Disengage | 1 | Leave engagement without provoking |
| Hide | 1 | Stealth vs observers' Perception; needs cover or darkness |
| Interact | 1 | Open a door, pull a lever, topple a prop |
| Stand up | 1 | |
| Ready | 2 | Declare a trigger and an action; uses your reaction |
| Ability / spell | 1–3 | From pack data or plugins |
| Intimidate / Rally | 1 | Force an enemy morale check / remove Frightened from an ally |
| Speak | free | One short sentence. Longer talk costs AP or happens outside combat |
| Stunt | 1–3 | See [Stunts](#stunts) |

**Reactions:** Dodge, Parry, opportunity attack, or a Readied action.

Conditions and wounds reduce AP (Stunned −2, Dazed −1) or raise costs (a serious leg wound makes Move cost 2).

### Free text in combat

"I kick the table over, duck behind it, then shoot the archer" parses to:

```json
[
  { "type": "stunt", "propId": "table-2", "effect": "createCover", "skill": "athletics", "ap": 1 },
  { "type": "takeCover", "ap": 1 },
  { "type": "strike", "mode": "ranged", "targetId": "archer-1", "ap": 1 }
]
```

The engine checks AP, range, line of sight, equipment and props, then resolves in order. If something is illegal ("you need 2 AP to reload the crossbow first"), the plan is rejected with reasons and the player gets numbered alternatives (see [08-turn-pipeline.md](08-turn-pipeline.md#step-4-validation-and-clarification)).

### Stunts

Improvised actions map to a **limited vocabulary of effects** so free text stays crunchy:

`createCover`, `removeCover`, `knockProne`, `blind` (sand, smoke, light), `push`, `disarm`, `createHazard` (oil + fire), `extinguishLight`, `climb`, `swing`, `barricade`, `distract`, `bindTarget`.

Each effect lists the prop affordances it needs, the skill used, the default difficulty and the AP cost. The parser picks the effect and skill; the engine validates against the scene's props and tags. Anything not expressible this way is narrated colour with no mechanical effect, and the player is told so.

## Attacks

1. **Attack check** with the weapon's skill (Melee, Ranged, Unarmed, Throwing) at Normal difficulty plus modifiers (range band, cover, lighting, size, conditions, multi-attack penalty, aim).
2. **Defence.** If the target is aware and has its reaction, it may **Dodge** (Dodge skill) or **Parry** (Melee skill; melee attacks only; needs a weapon or shield). This becomes an opposed check: the defender wins on a higher degree, or equal degree and higher margin. Unaware or helpless targets get no defence and the attacker gains a boon.
3. **Hit location** (see below), unless it was a called shot.
4. **Damage** = weapon dice + damage bonus (melee and thrown: floor((STR − 5) / 2)).
   - **critSuccess:** damage dice are maximised and armour protection at the location is halved (round down): the blade found the gap.
5. **Armour** at that location subtracts its protection against the damage type, minus the weapon's armour-piercing value. Minimum 0.
6. **Location multiplier:** head × 1.5 (round down). Others × 1.
7. **Final damage** reduces HP. Then check for a [wound](#wounds).

### Hit locations

Body plans come from packs. The humanoid plan:

| d100 | Location |
|---|---|
| 01–10 | Head |
| 11–50 | Torso |
| 51–60 | Right arm |
| 61–70 | Left arm |
| 71–85 | Right leg |
| 86–100 | Left leg |

**Called shots:** torso −10, arm or leg −20, head −40. Other plans (quadruped, avian, serpentine, insectoid, construct, amorphous) are defined in pack data, each with its own table and wound effects.

### Damage types

`cut`, `pierce`, `blunt`, `burn`, `cold`, `shock`, `poison`, plus pack types (e.g. `energy`, `arcane`). Types matter for armour, bleeding, fractures and infection.

### Armour

Armour pieces cover specific locations and give protection per damage type:

| Example (fantasy pack) | Covers | Cut | Pierce | Blunt | Notes |
|---|---|---|---|---|---|
| Padded jack | torso, arms | 2 | 1 | 2 | |
| Leather | torso, arms | 3 | 2 | 1 | |
| Mail hauberk | torso, arms | 6 | 3 | 2 | −10 Stealth |
| Plate harness | all but head | 8 | 6 | 4 | −20 Stealth, −10 Acrobatics |
| Helmet (open) | head | 5 | 4 | 3 | −10 Perception (hearing) |

Layers stack, but only the best two layers count at a location. Armour has weight and, if durability is on, condition.

## Hit points

HP (10 + END × 2) is stamina, luck and near-misses. Losing HP means you are tiring and taking glancing blows.

- **At 0 HP** you are **Down**: make an END check (Normal). Failure → Unconscious. Success → you may keep acting, but every hit that deals damage now causes a wound one severity worse than normal (minimum Minor).
- HP cannot go below 0.

## Wounds

A wound is a lasting injury at a body location. It happens when **one hit's final damage ≥ wound threshold (WT)**, or on any damaging hit while Down.

| Final damage | Severity | Max HP reduction until healed |
|---|---|---|
| ≥ WT | Minor | −2 |
| ≥ 2 × WT | Serious | −5 |
| ≥ 3 × WT | Critical | −10 |

### Effects by location (humanoid)

| Location | Minor | Serious | Critical |
|---|---|---|---|
| Head | Dazed; Bleeding 1 | Stunned; Concussed; Bleeding 1 | Unconscious; Concussed; Bleeding 2; **lethal check**; permanent-injury risk |
| Torso | Bleeding 1; −10 physical checks | Bleeding 2; −20 physical; fractured ribs if `blunt` | Bleeding 3; Down; internal injury; **lethal check** |
| Arm | −10 to actions with that arm | Drop held item; −20; fracture if `blunt`, Bleeding 2 if `cut` | Arm useless; Bleeding 3; **severed** if `cut` and damage ≥ 4 × WT |
| Leg | −10 movement checks | Prone; Move costs 2 AP; fracture if `blunt` | Can't stand; Bleeding 3; permanent-limp risk |

Damage type adjustments: `cut` +1 bleeding level (max 3); `pierce` raises infection risk; `blunt` causes fractures and concussions; `burn` causes no bleeding, high infection risk and scarring.

### Lethal wounds

- A **critical wound to the head or torso** triggers a lethal check: END at Hard. Failure → **Lethal**. critFailure → **Lethal**, and the character dies immediately unless saved by Luck.
- A second critical wound to the same location is automatically **Lethal**.
- **Lethal** means dying: Unconscious, Bleeding 3, and death after a number of rounds equal to END unless stabilised (Medicine at Hard, 2 AP, needs supplies).
- **Luck:** the PC may spend 2 Luck to downgrade Lethal to Critical.

What "Lethal" means depends on who and which mode:

| Who | Normal campaign | Hardcore campaign |
|---|---|---|
| PC | **Defeated** (see [Defeat](#defeat-not-death)), never dead | Dies unless stabilised |
| Companions | Defeated; can die only if the "companion death" setting is on (default off) | Die unless stabilised |
| NPCs and enemies | Die unless stabilised | Die unless stabilised |

## Bleeding

- **In combat:** Bleeding N loses N HP at the end of the bleeder's turn. At 0 HP, each bleed tick instead forces an END check (Normal); failure worsens the most severe wound's state (Down → Unconscious → Lethal).
- **Out of combat:** Bleeding N loses N HP per minute of in-game time.
- **First aid** (2 AP, Medicine, needs bandages or improvised cloth at −20): success reduces bleeding by 1, critSuccess by 2. A **tourniquet** stops limb bleeding fully, but the limb takes a Serious wound if left on for more than 2 hours.
- **Bleeding 1** stops by itself after combat on a successful END check.

## Infection

- Every wound that isn't **cleaned and dressed** within 6 in-game hours (Medicine, Normal, with supplies) is at risk.
- Once per in-game day, each at-risk wound requires an END check. Difficulty: Normal for Minor, Hard for Serious and Critical. `pierce`, bites and `burn` are one step harder; filthy conditions add a bane.
- Failure → **Infected** stage 1 (fever, −10 to everything). Each further failed daily check advances the stage: stage 2 (−20, the wound can't heal), stage 3 (sepsis: daily END check at Hard; failure → Lethal).
- Treatment: a daily Medicine check with supplies; success halts progression, critSuccess reduces a stage. Packs define better medicine (antibiotics make it Easy; healing magic per pack rules).

## Fractures

A fractured limb gives the wound's penalties until it is **set** (Medicine at Hard) and splinted, then heals in 6 weeks (Serious) or 10 weeks (Critical). Unset fractures heal badly: on recovery, an END check; failure → permanent injury.

## Healing

| What | Short rest (1 h) | Long rest (8 h) |
|---|---|---|
| HP | Recover half of missing HP | Recover all HP, up to max HP reduced by unhealed wounds |
| Wounds | — | One day of healing progress |

Base wound healing time with care: **Minor 3 days, Serious 2 weeks, Critical 6 weeks.** A daily Medicine check by a carer: success shortens the remaining time by 10%, critSuccess by 20%; no care doubles the time. Packs may add magic or technology that heals faster or reduces severity, always at a cost.

### Permanent injuries

When a critical wound (or a badly healed fracture) finishes healing, the character makes an END check. Failure → a permanent injury from the location's table, for example: scar (cosmetic; may give +10 Intimidation), limp (Move costs 2 AP when sprinting; −10 Athletics), lost eye (−20 sight-based Perception, −10 Ranged), lost fingers (−10 fine manipulation), chronic pain (−10 when exhausted), hearing loss. Permanent injuries are written into canon as facts so NPCs notice and react.

## Other damage

- **Falls:** 1d6 `blunt` per 3 m, location rolled with legs first; Acrobatics check to halve.
- **Fire:** Burning condition, 1d6 per round.
- **Drowning and suffocation:** END checks each round after END rounds; failures cost HP, then Unconscious, then Lethal.
- **Poison and disease:** pack data (onset, checks, stages, effects, cure).

## Creatures and size

| Size | To be hit | HP multiplier | WT bonus |
|---|---|---|---|
| Tiny | −20 | × 0.25 | −4 |
| Small | −10 | × 0.5 | −2 |
| Medium | 0 | × 1 | 0 |
| Large | +10 | × 2 | +5 |
| Huge | +20 | × 4 | +10 |

Creatures may have natural armour per location, multiple attacks, special abilities (pack data), and their own body plan.

## Defeat, not death

In a normal campaign, when the PC is **Defeated** (lethal wound, the whole party down, or a surrender that is accepted), combat ends and the engine resolves a **defeat outcome**:

1. The engine derives eligible outcomes from the enemies' intents in canon (bandits rob; cultists capture for a ritual; guards arrest; beasts drag prey to a lair or leave it for dead; soldiers take prisoners; rivals humiliate).
2. It picks one by weighted roll (seeded) and commits it: time skip, location change, loss of items or money if appropriate, a persistent critical wound with permanent-injury risk, reputation changes, and a **new hook** (escape, debt to a rescuer, revenge).
3. The narrator narrates the aftermath.

Defeat is never "nothing happened". It always costs something and always opens a thread.

## Hardcore death

In a hardcore campaign the PC can die. When they do:

- The campaign's active branch ends. An **obituary and epilogue** is generated from canon.
- **Legacy:** the player may start a new character in the same world. The dead PC becomes canon history: their grave, their gear (lootable), their unfinished business and the people who remember them.

## Fleeing, surrender and chases

- **Flee:** Disengage, then Move out of the scene's exit zones.
- **Surrender:** a free declaration; enemies accept or refuse based on their intent and morale.
- **Chases:** an opposed extended task on a chase clock (Athletics, Riding, Driving, Stealth to break line of sight), with zone-based obstacles generated from the scene.

## Enemy and companion tactics

Tactics are **deterministic utility AI** in the engine; the model only writes spoken lines.

- Each NPC combatant has a **tactics profile** from canon or pack data (`aggressive`, `defensive`, `cowardly`, `cunning`, `berserk`, `protector`, `sniper`, `caster`), **goals** (kill, capture, rob, defend X, escape) and **morale**.
- Each turn the AI enumerates legal action sequences (≤ 3 AP), scores them (expected damage dealt, damage avoided, cover, goal progress, focus fire, protecting the leader, hazards, profile weights) and picks the best, with small seeded randomness.
- The campaign difficulty setting changes tactical depth: Story uses simple heuristics; Standard adds cover and focus fire; Hard adds flanking, interrupting casters and using stunts.
- **Morale:** a group makes a WIL-based morale check when its leader goes down, when half the group is down, or after a terrifying event (Intimidate can force one). Failure → flee or surrender; critFailure → panic.
- **Companions** use the same AI unless player-controlled, biased by standing **directives** from the player ("focus the archer", "protect me", "stay back", "save your healing").
- **Barks:** once per round at most, the `npcDialogue` role may write one-line barks for notable moments (batched, cheap, optional).

## After combat

1. Bleeding-1 checks, first-aid window, and wound cleaning prompts.
2. **Loot** computed by the engine from canon inventories and pack loot tables; nothing appears from nowhere.
3. XP or skill marks per the progression mode ([04](04-characters.md#progression)).
4. Witnesses get NPC-mind memories of what they saw ([07](07-memory.md#npc-minds)).
5. Reputation changes for factions involved.
6. The scene closes if combat ended it, which triggers a scene summary.

## Combat narration pacing

- The player's turn is resolved and narrated as one passage.
- Everything until the player's next turn (enemies, companions) is resolved, then narrated as one combined passage.
- A "fast combat" option narrates whole rounds in two or three sentences each and leaves detail to the mechanics log.

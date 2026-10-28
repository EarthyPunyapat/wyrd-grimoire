# 11 — Subsystems and toggles

Every subsystem is built, and every subsystem can be switched on or off per campaign at any time (only the structural rules in [12](12-campaign-settings.md#what-locks-when) are fixed). Turning a subsystem off makes the engine stop enforcing it and the prompts stop mentioning it; its state is kept, so turning it back on resumes where it left off.

## Presets

| Subsystem | Story | Standard | Simulation |
|---|---|---|---|
| Inventory | Abstract (notable items only) | Weight + encumbrance | Weight + encumbrance + slots and quick-access |
| Money | Wealth levels | Coins + shops | Coins + shops + haggling + price drift |
| Injuries | Simple | Realistic | Realistic |
| ↳ Bleeding / infection / fractures / permanent injuries | Off | On | On |
| Time detail (NPC schedules, shop hours) | Off | On | On |
| Faction reputation | On | On | On |
| Weather effects | Off (flavour only) | On | On |
| Travel encounters | Reduced | On | On |
| Lighting and vision | Off | On | On |
| Language barriers | Off | Off | On |
| Ammo | Off | Off | On |
| Durability | Off | Off | On |
| Crafting | Off | Off | On |
| Survival (food, water, sleep, exposure) | Off | Off | On |
| Disease | Off | Off | On |

**Custom** exposes every toggle. Changing any toggle after picking a preset shows the campaign as "Custom (from Standard)".

## Inventory and encumbrance

- Items have weight (kg), a location (worn slot, held, a container) and quantity.
- **Worn slots:** head, body, hands, feet, back, belt (4 quick-access slots), neck, rings (2). **Held:** two hands. **Containers** have capacity.
- In combat, drawing from a belt slot or holster costs 1 AP; digging something out of a pack costs 2 AP.
- **Encumbrance** (carry capacity = STR × 5 kg):

| Load | Effect |
|---|---|
| ≤ capacity | None |
| ≤ 1.5 × capacity | **Burdened:** −10 to AGI-based checks; travel time × 1.25 |
| ≤ 2 × capacity | **Heavily burdened:** −20; the first Move each turn costs 2 AP; travel × 1.5 |
| > 2 × capacity | **Overloaded:** at most one Move per turn; −40 |

- **Abstract mode:** only notable items are tracked, without weight.

## Money, shops and haggling

- Denominations, base prices and regional modifiers come from the pack's `economy.yaml`.
- **Shops** are canon entities with stock that refreshes weekly (game time) from pack tables, sized by settlement.
- **Selling** fetches 40–60% of value depending on merchant attitude and faction reputation.
- **Haggling** (when on): opposed Persuasion vs the merchant's Insight. Success ±10% in the PC's favour, critSuccess ±20%; critFailure offends the merchant (attitude −10, maybe refuses service).
- **Price drift** (Simulation): seasonal and event-driven multipliers (a siege doubles food prices).
- **Wealth levels** (Story): 1 Destitute · 2 Poor · 3 Comfortable · 4 Wealthy · 5 Rich. Purchases at or below your level just happen; above it needs a check or a plot reason; big purchases may lower the level.

## Time detail

When on: NPCs follow schedules (by archetype: shopkeepers keep hours, guards change shifts, taverns fill at night), shops open and close, and lighting follows the clock. When off, time still advances (it's core), but schedules don't constrain play.

## Faction reputation

Described in [06](06-world-and-story.md#factions). When off, reputation isn't tracked and has no effects.

## Injuries

- **Realistic:** the full system in [03](03-combat-and-injury.md), with separate toggles for bleeding, infection, fractures and permanent injuries.
- **Simple:** wounds still exist with flat penalties (Minor −10, Serious −20, Critical −30 and Down) but no bleeding, infection, fractures or permanent injuries; healing times are halved. Simple injuries still run lethal checks, and a repeat critical at one location is still lethal (D75).

## Weather effects

Weather is always rolled for description. When effects are on: rain and wind penalise ranged attacks and Perception; snow and mud slow travel; storms can block routes; temperature feeds Survival exposure.

## Travel encounters

On: rolled per [06](06-world-and-story.md#travel-and-encounters). Reduced: half the chance, and never lethal-tier encounters by surprise.

## Lighting and vision

Zones and locations carry light levels (bright, dim, dark). Dim gives −20 to sight-based actions; dark gives −40 or a bane without darkvision or a light source. Torches and lanterns are items with burn time; light makes you visible.

## Language barriers

NPCs speak languages from canon. If the PC doesn't share one, conversation needs an interpreter, a Language skill check, or gestures (Insight to get the gist). The narrator renders unknown speech as described tone, not words.

## Ammo

Ammunition is counted per type. After combat, arrows and bolts can be recovered (50% with a Search action); bullets cannot. Running out is shown in the action hints.

## Durability

Items have a condition: pristine → worn → damaged → broken.

- Weapons degrade one step on a critFailure while using them, or when parrying a hit with ≥ 2 × WT damage.
- Armour degrades one step when a single hit's raw damage exceeds its protection by 5 or more.
- Damaged items have −10 (weapons) or −1 protection (armour). Broken items don't work.
- Repair with Craft (field) and materials, or pay a smith.

## Crafting

- Recipes come from the pack (`recipes.yaml`): inputs, tools, skill, difficulty, time.
- Result quality by degree: critSuccess → fine (or masterwork with a talent), success → standard, failure → crude (or nothing for complex items), critFailure → materials lost.
- Quality gives small bonuses (fine weapon +10; masterwork +20 and +1 damage).
- Materials come from loot, shops and gathering (Survival checks by region).

## Survival

| Need | Requirement | Escalation |
|---|---|---|
| Food | 1 ration per day | Hungry (−10) → Starving (−20, no HP recovery) → END checks daily |
| Water | 2–4 L per day by climate and exertion | Thirsty (−10) → Dehydrated (−30) → END checks every 6 h |
| Sleep | 6–8 h per day | Tired (Exhausted 1) → more Exhausted levels |
| Exposure | Clothing warmth vs temperature | Cold/Hot (−10) → Hypothermic/Heatstroke (−20, END checks hourly) |

Rations and water are consumed automatically from inventory (with notices). Foraging and hunting are Survival checks by region and season.

## Disease

Diseases are pack data: vector, onset, END checks, stages, symptoms, contagion, cures. Infection from wounds is part of Injuries, not this toggle.

## Morale

Always on in combat ([03](03-combat-and-injury.md#enemy-and-companion-tactics)); not a toggle.

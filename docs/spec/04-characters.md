# 04 — Characters

Covers the character sheet, the three creation paths, the four progression modes, and companions.

## Character sheet

The same schema is used for the PC, companions and any NPC with full stats. Lightweight NPCs may use a **statblock** (a subset: attributes, a few skills, HP, WT, armour, attacks, tactics profile) defined in pack data.

```ts
type CharacterSheet = {
  id: ActorId;
  identity: {
    name: string; pronouns?: string; ancestry: string;        // ancestry/species from the pack
    age?: number; appearance: AppearanceFacts;                 // structured: build, hair, eyes, skin, marks, clothing style
    background: string; personality: string[];                 // short trait tags
    backstory: string;                                         // prose, player-owned
    hookIds: EntityId[];                                       // canon entities created from the backstory
  };
  archetypeId?: string;
  attributes: Record<AttributeId, number>;                     // 1–10
  skills: Record<SkillId, { trained: number }>;                // value = untrained + trained, computed
  talents: TalentId[];                                         // pack abilities
  languages: string[];
  derived: { hpMax: number; wt: number; carryKg: number; initiative: number; composure?: number };
  status: {
    hp: number; luck: number; conditions: ConditionInstance[];
    wounds: Wound[]; permanentInjuries: PermanentInjury[];
  };
  progression: ProgressionState;                               // XP, marks, class levels — depends on mode
  voiceId?: string; portraitAssetId?: string;
};
```

Wounds reduce `hpMax` while unhealed ([03](03-combat-and-injury.md#wounds)). **No progression mode adds HP from levels or XP**: toughness comes from END, talents and gear. This keeps combat gritty at every stage of a campaign.

## Character creation

Three entry points, one shared **sheet editor**, one validator.

### Point-buy budget (all paths)

| Item | Default |
|---|---|
| Attributes | Start at 3 each; 18 points to distribute; max 7 at creation (8 with an ancestry trait) |
| Skills | 200 **core** points (max +50 in one skill) and 100 **interest** points (max +30 in one skill) |
| Talents | 1 from the archetype + 1 free pick (prerequisites apply) |
| Gear | The archetype kit, or a starting budget in the pack's currency |
| Luck | Full pool |

The validator reports exactly which rule a sheet breaks. A sheet cannot be committed until valid.

### 1. Session zero (main path)

A conversation with the `sessionZero` role that builds the character and seeds the world.

1. The interviewer asks 6–10 short questions, adapting as it goes: concept, origin, what they're good at, what they want, what they fear, a person who matters, a rival or enemy, a debt or secret, a distinguishing mark.
2. As answers arrive it calls tools: `propose_attributes`, `propose_skills`, `propose_talents`, `propose_gear`, `propose_appearance`, and `propose_hooks`.
3. The engine validates every proposal against the budget and the UI shows a **live sheet preview** beside the chat.
4. `propose_hooks` creates **backstory hooks** as canon entities flagged `backstoryHook`: the rival (an NPC), the missing sibling (an NPC with an unknown location), the debt (a faction or NPC relationship with a clock), the secret (a fact with restricted knowledge). The world generator MUST place every hook in the world ([06](06-world-and-story.md#world-generation)).
5. The player can say "change X" at any time. When they approve, they land in the sheet editor for final tweaks.

### 2. Form / wizard

Archetype → attributes → skills → talents → gear → appearance and backstory. Each free-text field has an optional "suggest" button that calls the model for that field only. Hooks can be added by hand or generated from the backstory text.

### 3. Quick start

Each pack ships 3–6 **pregenerated characters** with portraits (or portrait prompts), hooks and gear. Pick one and go. Used for fast play and for testing.

### Sheet editor

Shows the full sheet with live validation. During creation everything is editable. After the campaign starts, the sheet changes only through events (progression, wounds, items). A **"cheat edit"** toggle in Settings allows direct edits for debugging and permanently marks the campaign as modified.

## Archetypes

Packs define archetypes (e.g. fantasy: Sellsword, Hedge Wizard, Cutpurse, Pilgrim, Hunter, Scholar) as **starting templates in every progression mode**: suggested attribute array, skill package, a starting talent, a gear kit, and backstory prompts for session zero. In class mode, archetypes map to classes.

## Progression

The progression mode is chosen at campaign creation and locked ([12](12-campaign-settings.md)).

### XP awards (classless, hybrid and classes modes)

XP is awarded **by the engine** on events, never by narration alone:

| Trigger | XP |
|---|---|
| Quest stage completed | minor 2, major 5, main-arc stage 8 |
| Notable encounter resolved (combat, social, exploration, by challenge) | 1–3 |
| Discovery (new region, secret, lost lore) | 1–2 |
| Personal goal or bond advanced | 2 |
| Chapter closed | 2 |

Optional setting (default **off**): the parser may call `suggest_xp` for exceptionally clever play, capped at 1 XP per scene, applied by the engine with the reason logged.

### Classless (default)

Spend XP freely:

| Purchase | Cost |
|---|---|
| Skill +5 | 1 XP below 25, 2 XP for 25–49, 3 XP for 50–74, 4 XP for 75–89. Raising past 90 requires a Mastery talent. |
| Attribute +1 | 4 × the new value (5→6 costs 24). Max 8 without a pack ability. |
| Talent | Tier 1: 8 XP · Tier 2: 15 XP · Tier 3: 25 XP, with prerequisites |
| New field skill (language, lore) | Gains +10 trained for 2 XP |

### Use-based

Skills improve by being used under pressure (Call of Cthulhu style):

- **Mark** a skill when a check with it succeeds (success or critSuccess) at Normal or harder, when the stakes are real (combat, danger, time pressure, social stakes) and the success didn't come from a Luck reroll. One mark per skill at a time.
- **Improvement opportunity:** a long rest in a safe place, or a chapter close. For each marked skill, roll d100 (in either dice mode). If the roll is higher than the current value, or 96+, the skill improves by 1d10. Then all marks clear.
- **Attributes:** +1 to one attribute when an arc closes.
- **Talents:** one new talent every 2 chapter closes.

### Hybrid

XP is earned at 50% of the normal rate and spent as in classless, **and** skills are marked and improved as in use-based.

### Classes

Packs that support class mode define classes with a level table (levels 1–10 by default):

- XP thresholds: level *n* needs 10 × n(n−1)/2 total XP (L2: 10, L3: 30, L4: 60, L5: 100 …).
- Each level: +20 trained points to class skills (max +10 per skill per level) and +5 to any skill.
- Class features (talents) at set levels; +1 attribute at levels 4 and 8.
- No HP from levels (see above).
- Multiclassing is a pack option.

Class mode needs class data in the pack; the campaign creation UI only offers it for packs that have it.

## Companions

Full party members with their own sheets, opinions and agency. **Maximum 3 active**; others can wait at a home base if the pack/world has one.

### Recruiting

NPCs become companions through play: completing their quest, persuading them, paying them, or a bond from the PC's backstory. Recruitment is an engine event (`CompanionJoined`) proposed by the model and validated (the NPC must exist, be present, and have a reason recorded in canon).

### Sheets, gear and control

- Companions use full character sheets and the same rules, wounds and progression mode as the PC (XP is shared; each companion spends their own using the same costs, chosen by the AI in their style unless the player manages it).
- The player can trade and equip companions' gear. Items given as gifts become theirs and leave with them.
- **Control** per companion: **AI** (utility tactics with the player's directives) or **Manual** (the player declares their actions in free text, e.g. "Mira shoots the archer").
- Out of combat, the player can ask a companion to act ("Mira, pick the lock"); the parser targets that actor.

### Approval

Each companion has **approval** from −100 to +100 toward the PC, driven by their **values, likes and dislikes** stored in canon.

- After each significant witnessed event, the `guard` role proposes approval deltas with reasons (e.g. `{companion: "mira", delta: -6, reason: "PC executed a surrendered prisoner; Mira values mercy"}`).
- The engine caps changes at ±10 per event and ±20 per scene, and logs them.
- Thresholds:
  - ≤ −50: confrontation scene.
  - ≤ −75: leaves the party (or betrays, if their traits allow).
  - ≥ +50: personal quest unlocks.
  - ≥ +75: loyal; stays through hardship. Romance becomes possible only if the content dials allow it (fade-to-black at most).
- Approval is visible in the Party tab (as a word and a bar; the number shows when "Show the math" is on).

### Personal quests and banter

- Each companion gets a **personal quest** generated at recruitment from their backstory, written into canon as a quest with stages.
- **Banter:** occasional short exchanges between companions or with the PC, triggered by places and events, at a configurable frequency (default: at most one per scene). Banter is flavour and never changes state except through validated approval deltas.

### Companion death

Off by default in normal campaigns (companions are Defeated like the PC). On in hardcore. A settings toggle allows it in normal campaigns too.

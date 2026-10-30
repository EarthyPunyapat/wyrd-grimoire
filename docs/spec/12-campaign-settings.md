# 12 — Campaign settings

Settings come in two scopes: **campaign settings** (stored in the campaign, changed through `SettingsChanged` events) and **app settings** (stored in `app.db`).

## Campaign settings schema

```ts
type CampaignSettings = {
  structural: {                                   // see "What locks when"
    resolution: "d100" | "d20";                   // default d100
    progression: "classless" | "useBased" | "hybrid" | "classes"; // default classless
    hardcore: boolean;                            // default false
  };
  story: { mode: "threatClock" | "livingWorld" }; // default threatClock
  difficulty: "story" | "standard" | "hard";      // default standard
  lethality: "gritty" | "brutal";                 // default gritty (Luck max 3; brutal 1)
  companionDeath: boolean;                        // default false (forced true in hardcore)
  subsystems: SubsystemToggles;                   // see 11
  preset: "story" | "standard" | "simulation" | "custom"; // default standard
  content: {
    violence: "mild" | "moderate" | "intense";    // default moderate
    horror: "off" | "light" | "moderate" | "intense"; // default light
    romance: "off" | "fadeToBlack";               // default fadeToBlack
    language: "clean" | "moderate" | "strong";    // default moderate
    lines: string[];                              // never appears
    veils: string[];                              // happens off-screen only
  };
  narration: {
    language: string;                             // BCP-47, default "en"
    person: "second" | "third";                   // default second
    length: "short" | "normal" | "long";          // default normal
    showMath: boolean;                            // default true
    canonCheck: "beforeShowing" | "afterShowing"; // default beforeShowing
    fastCombat: boolean;                          // default false
    suggestions: boolean;                         // default true
    banter: "off" | "low" | "normal";             // default low
  };
  xp: { modelSuggestedXp: boolean };              // default false
  media: {
    images: { portraits: boolean; sceneArt: boolean; combatShots: boolean; itemArt: boolean; cover: boolean };
    artStyle: string;                             // generated at creation, editable
    voice: { enabled: boolean; autoplay: boolean; dialogueOnly: boolean; narratorVoiceId?: string };
  };
  flags: { softcore?: boolean; cheatEdited?: boolean };
};
```

## Creation libraries (D167, D174)

New campaign opens with **Who are you playing?** (a character card or Create new),
then **Where?** (a world setup, saved world, or Create new). Continue opens the
existing pitch and review flow. **Begin with these** generates and starts directly
with the selected setup's rules and card. Without a card it uses the world's
suggested character name, first origin and first background. Generation keeps its
streamed progress and recoverable errors.

### World setups

A setup stores a name, pitch, optional source title/wiki, base preset, dice,
story mode, hardcore and progression, plus review overrides for starting Level,
subsystems, lethality, companion death, style and theme. Its overrides merge over
the GM's creation review; the player can change the result before starting.
**Vary it** proposes a fresh pitch in the same genre without changing the setup.

Eight original-text built-ins ship with illustrated banners: superhero inside DC,
cultivation inside Reverend Insanity, cosmic god-game (Level ∞), grimdark fantasy,
classic fantasy, space opera, cyberpunk noir and zombie survival. Built-ins are
read-only and offer Duplicate. Own setups can be renamed, duplicated or deleted
with confirmation. Save as world setup is available on creation review and in
campaign Settings → Keep this campaign.

The existing setting values apply: high lethality means `brutal`; survival and
scarcity use Simulation's inventory, money, survival and related toggles. A setup
never opens a shop when the campaign starts (D173).

### Character cards

Cards snapshot the PC's name, Level (including ∞), abilities with ranks, signature
creation gear, attributes, trained core skills, appearance, pronouns and
personality, plus loyal companions with their summaries, Levels and voice profiles.
They can be saved from creation review, a reviewed ChatGPT import, or campaign
Settings. Cards have initials avatars; media never blocks creation.

On world review, choose **Arrive as-is** or **Let the GM adapt**. An adaptation is
an editable proposal for that campaign's backstory, Level, powers and gear. The
name stays the same. The original card is unchanged. The selected card and edited
adaptation persist in the creation draft for resume, including from another device.
Temporarily incomplete edits keep the last valid autosaved proposal until the fields
are valid again.

Starting with a card uses the reviewed-import event path. Saved stats overlay a
validated new-world origin/background before ActorCreated, with derived stats
recomputed, so an experienced character does not have to repeat point buy. Unknown
skill IDs are dropped against the combined core and pack catalogue; abilities
remain free text and carry over. A missing card is a 404, never a silent replacement.

Rename, duplicate and delete are library actions. Character contents change only
through **Update card from this campaign** in Settings, with explicit confirmation;
that action keeps the card's title and origin while replacing its character,
companions and sheet snapshot.

### Saved worlds

**Save this world** in Settings copies the campaign's original generated creation
draft: proposal, world bible, sites, routes, NPCs, factions, canon clocks and kit
when present. It is the generated world, not a snapshot of subsequent play.
Campaign ID, sheet, interview and card/adaptation are stripped. Choosing it makes
a new draft with a new ID and follows the existing resume path; each new campaign
has its own event log. Library entries can be renamed, duplicated and deleted.

A campaign without a creation draft (including quick-start and older campaigns)
returns 409: “This campaign has no saved world to copy”.

### Storage and API

All three libraries live in `app.db`, shared across devices, in migration v4:
`world_setups`, `character_cards`, `saved_worlds`. Saves return the stored record
with an ISO `updatedAt`; edits are last write wins. Invalid stored records are
skipped. First Light's media tables do not use the version number.

Authenticated routes expose setup and card lists/creation, setup edits and
removal, card title edits/removal, campaign snapshot actions, saved-world metadata
and draft cloning. `POST /api/world-setups/vary` and
`POST /api/character-cards/:id/adapt` use validated worldGen proposals. Without a
connected model they return actionable 422 errors. Saved-world rename and duplicate
use `PATCH /api/worlds/:id` and `POST /api/worlds/:id/duplicate`.
`PUT /api/world-drafts/:id/card` persists a reviewed card selection or clears it
with null; completed drafts cannot be edited. No library action mutates a campaign's
engine state. Starting a campaign still records its character and companions as events.

## What locks when

| Setting | Rule | Why |
|---|---|---|
| `structural.resolution` | Chosen at creation, then **locked** | Changing dice mid-run means rescaling the whole sheet |
| `structural.progression` | Chosen at creation, then **locked** | Progression state isn't convertible between modes |
| `structural.hardcore` | Can only be turned **on at creation**. Can be turned **off** later; that is irreversible and sets `flags.softcore` | Hardcore must not be switchable after a lucky streak |
| Genre pack | Chosen at creation; addons can be added later only via an explicit migration with a diff preview | Content consistency |
| Everything else | Any time | Comfort and pacing settings |

The settings screen shows locked settings greyed out with the reason.

## Difficulty

| | Story | Standard | Hard |
|---|---|---|---|
| Player-side check modifier | +10 | 0 | −10 |
| Enemy tactics | Simple heuristics | Cover + focus fire | Flanking, caster interrupts, stunts |
| Enemy numbers (generated encounters) | −1 | baseline | +1 |
| XP rate | × 1.25 | × 1 | × 1 |

## Lethality

| | Gritty (default) | Brutal |
|---|---|---|
| Luck max | 3 | 1 |
| Lethal check difficulty | Hard | Hard, with a bane |

Hardcore reduces Luck max by 1 (minimum 1) on top of either.

## Content dials

Content settings are injected into every narrative prompt (narrator, npcDialogue, worldGen, summarizer) and enforced by the canon guard (`linesCrossed`).

- **Violence:** mild (injuries described without detail), moderate (clear but not lingering), intense (visceral detail).
- **Horror:** how dread, body horror and disturbing themes are handled.
- **Romance:** off, or fade-to-black at most.
- **Language:** profanity level in dialogue and narration.
- **Lines:** topics that never appear in any form. World generation must avoid them too.
- **Veils:** things that may happen but only off-screen; the narration cuts away.

Cloud providers' own content policies also apply and cap what their models will write, whatever the dials say.

## App settings (`app.db`)

| Area | Contents |
|---|---|
| Models | Providers, keys, ChatGPT connection, role routing, presets, fallbacks, prices, spending caps |
| Media | Image provider, ComfyUI URL and workflows, OpenAI image settings, TTS provider, voices, Deepgram key |
| Usage | The usage meter ([09](09-models-and-providers.md#usage-meter-settings--usage-only)) |
| Server | Bind address, port, passcode, allowed origins |
| Interface | Font size, reduce motion, theme override (follow pack / light / dark), mechanics log default |
| Defaults | Default settings for new campaigns |
| Packs | Installed packs, validation status |
| Advanced | Cheat edit, debug event viewer, export/import, rebuild projections |

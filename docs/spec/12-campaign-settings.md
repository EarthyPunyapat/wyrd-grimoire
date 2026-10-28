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

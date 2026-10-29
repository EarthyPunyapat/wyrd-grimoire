# NPC scene reactions: repair after M6

Branch: `fix/npc-reactions`, based on M6 `7747c38628c54198cb9ee0a7e456d4ad04505328`.

A public assault previously produced attack narration while its target and other people remained silent. This repair connects attempted violence to observable NPC responses, shared incident history and legal physical reactions. It keeps engine-owned outcomes and a single normal narrator call.

## Integration with M6

M6 remains the base; its branch is not rewritten. Creation, progression, recruitment, the Party tab, companion profiles, approval caps, manual control and standing directives retain their implementations. Shared turn/pipeline hooks preserve M6's progress awards and `afterGuard` approvals.

The scene response module excludes active companions from ordinary-NPC disposition/control policy. A combined pipeline regression checks a companion receiving its guard-proposed approval change while an ordinary witness reacts to the same assault. The scene tactics adapter delegates companions to the existing M6 tactics AI.

Flavor banter's once-per-scene cadence does not govern incident reactions. Directly affected NPCs and a bounded number of witnesses respond to an incident, independently of companion banter.

## Implemented sequence

1. Combat steps capture eligible witnesses at the action, before later movement changes who could perceive it. Failed attacks still count as attempted aggression.
2. At the scene phase before the next player input, the engine selects responses using a validated reaction profile, the incident's previous responses and normal capability checks.
3. Response memories and the first incident's disposition changes are emitted as ordinary events. The key includes incident, round, acting character and witness; combat's zero elapsed minutes do not reset or duplicate them.
4. Neutral witnesses can protest, call to a present person, step back along one legal edge, or join the victim's side after repeated aggression if protective. Joining rolls initiative, preserves the current actor and grants no free attack. Calls alone do not spawn or transport anyone.
5. A cautious target who chooses escape attempts it on their normal AI turn with ordinary AP, engagement and exit restrictions. They are not marked fled before the action succeeds.
6. The narrator receives resolved response beats, a short speech intent, safe public characterization and relevant shared incident/told memories. Private NPC retrieval namespaces are not dumped into the narrator. Creatures and people unable to speak retain nonverbal responses.
7. The narrator voices those intents naturally. Missing or malformed speech gets a safe engine-supplied fallback line before the guard checks the combined passage. Narration failure still commits the resolution and shows safe fallback reactions. Rerolling changes the telling without repeating incident effects or witness memories.

## Profiles and tuning

Optional canon `entity.data.reactionProfile`:

```json
{
  "temperament": "protective",
  "speechStyle": "firm and concise",
  "canSpeak": true
}
```

World-opening, world-bible and lazy-location generation now request optional typed profiles and preserve them in canon separately from secret facts. Legacy proposals remain valid.

Temperaments are `assertive`, `cautious`, `protective` and `hostile`. Existing actor personality tags and tactics provide a conservative fallback; old campaigns need no rewritten events or regenerated worlds. Creatures default to nonverbal unless explicitly given speech. This is a bounded response policy, not the deferred full private `npcDialogue` tool system.

`Tuning.sceneReactions` controls witness response budget, help/intervention thresholds, incident disposition deltas and shared-history context size. The optional field falls back to defaults for older tuning values. `NpcMemory.response`, `ResolvedStep.witnessIds` and `Resolution.responses` are optional additions, so old events and stored turns remain readable.

## Other corrections from the playtest

- Commoners without an explicit combat intent use `driveOff`, matching their existing commoner profile. Explicit NPC and creature intent still wins.
- Winning an opposed grapple/trip/shove reports the contest outcome, even if both raw checks failed. Both checks and the verdict reach the mechanics log. Hit/defence details are no longer silently dropped from combat mechanics.
- Routine exchanges have no forced minimum prose length. Prompts preserve action order, selected voices and actual outcomes, while discouraging recycled ambience and stale wager reminders.
- Parser instructions preserve implied approach movement and avoid inventing unrelated skill checks or called shots for generic attacks. Unsupported choking/mutilation effects are not silently granted.
- OOC instructions use ordinary language and explain capabilities without action JSON or telling a solo player to consult a separate human GM.

## Validation

Engine regressions cover missed assaults, witness eligibility, bounded responses, repeat suppression at zero game time, different profiles, legal retreat, restraint, existing help recipients, intervention initiative, civilian escape intentions, nonverbal creatures, replay and opposed-check outcomes.

Pipeline regressions cover named target/witness speech, private sentinel exclusion, a silent narrator, narrator outage, guard/engine observation deduplication, reroll stability and M6 approval integration. Browser regressions verify named target/bystander dialogue and reload persistence on desktop and phone alongside M6 creation/progression flows.

Current automated result: `bun run check` passes 463 tests; typecheck, lint and pack validation pass. Production build passes. The full desktop/phone browser run has 25 passing cases and one existing skipped phone XP case. Real-provider quality checks are pending.

Run `bun run check`, `bun run build` and `bun run test:e2e`. The onboarding machine uses its system Chromium via an external Playwright config; that machine-specific override is not committed.

Real-model narrative quality still needs the user's authenticated playtest: replay the parlor assault, try a noncombat refusal and check whether different NPCs sound like themselves. Offline fixtures and scripted providers establish mechanics and integration, not subjective prose quality. Prompt versions identify the changed parser, narrator and OOC contracts for future eval logs.

## Reference

Reviewed [abagames/narrative-engine](https://github.com/abagames/narrative-engine) at `030d8a0da075124cb500b1359d5f2678a081bba7`: `DIALOGUE_SYSTEM.md`, `NPC_PERSONALITIES.md`, `GM_CORE_MIND.md` and `CHARACTER_PERSONALITY_TEMPLATES.md`.

Adapted ideas: situation/relationship/personality-aware speech, behavioral differences, immediate motives and less repetitive pacing. This implementation uses Wyrd's typed rules, events, seeded decisions and knowledge filtering. No reference code or substantial prompt text was copied, and it is not a runtime dependency. The reference's generic state-path writes, unseeded examples and silent difficulty adjustment were not adopted.

Remaining separate work: full isolated private NPC dialogue/reveal tools; character cheat editing after campaign start; additional unsupported combat effects and wider balance changes. This repair does not change character stats or dice odds.

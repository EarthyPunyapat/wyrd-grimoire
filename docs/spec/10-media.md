# 10 — Media: images and voice

Media is optional, asynchronous and never blocks a turn. Both images and voice have a **local default** on the main PC's GPU and a **paid API option**. No ambient music.

## Images

### Adapter

```ts
interface ImageProvider {
  id: "comfyui" | "openai-images";
  generate(req: {
    mode: "t2i" | "edit";
    prompt: string; negativePrompt?: string;
    width: number; height: number; seed?: number;
    referenceAssetIds?: AssetId[];          // edit mode: keep a character's look
  }, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: string; seed?: number; meta: object }>;
}
```

### ComfyUI + Qwen-Image 2.1 (default, local)

The owner already runs **Qwen-Image 2.1** (a 7B text-to-image *and* editing model, supported natively in ComfyUI since September 2026) on the main PC.

- **Connection:** ComfyUI's HTTP API, default `http://127.0.0.1:8188` (VERIFY). Submit a workflow with `POST /prompt`; follow progress over the `/ws` WebSocket or poll `GET /history/{prompt_id}`; download outputs with `GET /view`; upload reference images with `POST /upload/image`. VERIFY endpoint details against the ComfyUI docs.
- **Workflows:** ComfyUI setups differ, so the app doesn't hardcode one. The owner exports their working Qwen-Image 2.1 text-to-image and edit workflows from ComfyUI in **API format** and drops them into `WYRD_HOME/media/workflows/`, with a small mapping file that says which node fields receive the prompt, negative prompt, seed, width, height and reference image. The repo ships example workflows and mappings (VERIFY them against ComfyUI's Qwen-Image 2.1 tutorial).
- Settings → Media has a **"Test generation"** button.

### OpenAI image API (option)

Pay-per-image via an OpenAI **API key** (the ChatGPT plan route can't generate images). Model and size configurable; VERIFY current model IDs and prices. Edit mode uses the portrait as a reference image.

### When images are made

| Job | Trigger | Default |
|---|---|---|
| PC portrait | Character creation | On |
| Companion portrait | Recruitment | On |
| NPC portrait | A named NPC with `sketch`+ detail first appears on stage | On |
| Scene art | First visit to a site or key location (not every room) | On |
| Combat establishing shot | Combat starts | Off |
| Item art | Rare or unique items | Off |
| Campaign cover | World generation | On |

Each type has its own toggle. Paid providers also get a per-session image budget.

### Prompts

- Built from **structured appearance facts** in canon (build, hair, eyes, skin, marks, clothing, gear) plus the **campaign art style** (generated at world creation from the pack theme and the pitch; editable in Settings → Media) plus a composition template per job type.
- A pack-level negative prompt; **no text** in images.
- Content dials apply (e.g. gore level). Never depict real people.

### Consistency

- Each entity's first portrait becomes its **canonical portrait** (the player can regenerate and choose).
- Later images featuring that character use **edit mode** with the canonical portrait as a reference, so faces stay the same.
- Seeds and prompts are stored with every asset.
- If the canon guard records a change to an appearance fact (a new scar, cut hair), the portrait is flagged for an optional refresh.

### Storage and events

- Files live in `campaigns/<id>/media/`. An `assets` table holds id, kind, entityId, path, prompt, seed, provider, model and createdSeq.
- `AssetRequested` and `AssetReady` events; the UI listens for `media.ready` over SSE.

### GPU sharing

When the routing preset uses a local LLM, image jobs wait while a local model call is running (a simple GPU mutex in the job queue), so the 16 GB card isn't overcommitted. The UI warns about this combination in Settings.

## Voice

### Adapter

```ts
interface TtsProvider {
  id: "local-tts" | "deepgram" | "openai-tts";
  listVoices(): Promise<Voice[]>;
  speak(req: { text: string; voiceId: string; format: "mp3" | "opus" | "wav"; speed?: number }, signal: AbortSignal)
    : Promise<ReadableStream<Uint8Array>>;
}
type Voice = { id: string; name: string; provider: string; gender?: string; age?: "young" | "adult" | "old"; accent?: string; tags: string[] };
```

### Local text-to-speech (default)

A local TTS server on the main PC that speaks the OpenAI-compatible `POST /v1/audio/speech` API (for example a Kokoro-based server), or an in-process TTS library. VERIFY the chosen server/library, its voice list and Bun compatibility at implementation time. Free, fast, many voices.

### Deepgram (option)

The owner has a Deepgram API key. Deepgram's text-to-speech REST API (`POST https://api.deepgram.com/v1/speak?model=<voice>` with `Authorization: Token <key>`, Aura voices, streaming audio). VERIFY the endpoint, voice IDs and pricing. Character counts go to the usage meter.

### OpenAI TTS (option)

Via an OpenAI API key, if configured.

### Voice casting

- A **narrator voice** is chosen in Settings.
- Each NPC gets a voice when it first speaks, chosen from the catalog by matching tags (gender presentation, age, accent from the pack's `voices.yaml` per culture), avoiding a voice already used by another NPC in the same scene. Recorded as a `VoiceAssigned` event, so the blacksmith always sounds like the blacksmith.
- Companions' voices are fixed at recruitment. The player can recast any voice from the codex.

### Playback

- Narration is split into **segments**: narrator text, and each `<say who="…">` line in that speaker's voice. Segments are synthesised in order with prefetch and played back to back.
- Audio is cached per (turn, segment, voice, provider) in the campaign media folder; each passage has a replay button.
- Controls: auto-play toggle, play/pause per passage, speed, volume, and **"dialogue only"** mode (NPCs voiced, narrator silent).
- Browsers on phones block auto-play until the first tap; the UI handles that gracefully.

### Speech input (later)

A hook for push-to-talk: speech-to-text (Deepgram streaming STT or a local Whisper-class model) fills the input box for the player to review and send. Not in v1.

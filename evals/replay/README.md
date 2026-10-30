# W2 replay eval

Replay the player's ChatGPT inputs through Wyrd's real GM-with-tools pipeline and compare
the resulting prose with ChatGPT's replies. This is a manual, real-provider eval, never a
CI command. Unit tests use FakeProvider and the invented fixture under `test/fixtures/`.

## Run on the host

1. Configure working models in Wyrd's **Settings → Models / Connection**, including a GM
   route. Existing provider ids, model ids, fallbacks and credentials are reused. ChatGPT
   sign-in must already be completed on the host; the eval never opens a sign-in browser.
2. Prepare a campaign **at the start of the replay**, with its PC, scene and reviewed import.
   Point to that campaign's `campaign.db`, normally under
   `$WYRD_HOME/campaigns/<id>/campaign.db` (`WYRD_HOME` defaults to `~/.wyrd`). Use a baseline
   prepared for these inputs, rather than one already containing the outcomes you intend
   to evaluate. Importing the whole future transcript would bias the comparison.
3. Leave the owner's transcript files in `~/Downloads/chatgpt-rpg/`. Start with a small limit
   to check the baseline and provider setup, then omit the limit to run every player input.

```sh
bun run eval:replay --help
bun run eval:replay --campaign ~/.wyrd/campaigns/BASELINE/campaign.db --limit 2
bun run eval:replay --campaign ~/.wyrd/campaigns/BASELINE/campaign.db
```

Options:

| Option | Meaning |
| --- | --- |
| `--input <directory>` | Transcript directory; defaults to `~/Downloads/chatgpt-rpg/` |
| `--file <filename>` | Select one file inside that directory; repeat for more |
| `--limit <N>` | First N player inputs **per transcript**; otherwise all |
| `--config <file>` | Explicit CLI-format provider config |
| `--home <directory>` | Override `WYRD_HOME` for models, secrets, usage, lore cache and style |
| `--out <directory>` | Output directory; defaults to `evals/replay/out/` |

Default settings prefer the web app's `app.db`; `config.json` is used only if web provider
settings are absent. `--config` takes precedence over both. Secrets remain in
`WYRD_HOME/secrets/`. A missing/placeholder GM route fails before any turn is run. No
offline-provider switch exists. The configured provider may itself be a local real model.
Usage is recorded in `WYRD_HOME/usage.jsonl` through the existing CLI usage sink.
Real calls consume plan usage or incur the configured API provider's charges, including
tool rounds, structural checks and any lore research; this eval does not set a cost cap.

## Supported transcript files

- Saved ChatGPT share **`.html` / `.htm`** pages, decoded by the existing
  `packages/llm/src/import/chatgpt-share.ts` turbo-stream decoder. Hidden thoughts,
  reasoning recaps, model-editable context and tool output are excluded by that decoder.
- Decoded **`.json`** matching its `SharedChat` shape:

  ```json
  {"title":"An invented ferry scene","turns":[{"role":"user","text":"I wave."},{"role":"assistant","text":"The ferryman waves back."}]}
  ```

Other JSON formats (including a raw turbo-stream array or ChatGPT account export), Markdown
and text files are not inferred. Convert them locally to the shape above. Scripts such as
`decode.py`, subdirectories and symlinks are ignored. Files are sorted by filename for a
repeatable order; `--file` selects from those files. Invalid supported files become labelled
errors in the report without echoing their contents or parser errors to the terminal.

Every player input is passed unmodified to `TurnPipeline.run`. Multiple assistant messages
following an input are joined as its ChatGPT reference; unanswered inputs still run.
Assistant-only opening material is ignored. Wyrd never receives the reference replies or
the chat title as instructions. Each transcript starts from the **same** read-only SQLite
snapshot (including committed WAL data and the active branch), and Wyrd accumulates its
own events across that transcript's turns. Separate transcripts are independent comparisons,
even when they represent successive chapters in the source conversation. Choose matching
baselines and run them separately if they need different starting states.

The frozen pack's rules/content, world bible, campaign style, local house-style examples
and lore research service are supplied to the GM pipeline. This eval calls the turn pipeline
directly; it does not run web-server job management or its between-turn companion profiling
and memory-summary jobs. The structural check is awaited before the next input so its
recorded changes participate in later turns.

## Read the report

Open `evals/replay/out/<UTC date>.html` manually. No browser is launched. Each row shows the
player input and ChatGPT/Wyrd prose side by side, with actual GM provider/model, prompt
version, elapsed time, backup status, recorded tools/cards/choices/mechanics and structural
flags. All text is escaped; the page has no scripts, remote resources or model-authored HTML.

The report checkpoints after each input and completes after all selected files. Rerunning
on the same UTC day **replaces** that day's report; use a separate `--out` directory to keep
multiple runs. An interrupted run leaves its latest checkpoint labelled “In progress”.
Ordinary completion or exceptions clean up temporary campaign copies; a force-killed process
may leave a private `wyrd-replay-*` directory in the system temp directory.

Provider/turn failures are labelled and later inputs are still attempted. Classic fallback
is explicitly marked and does not count as a successful GM replay; configured backup GM
models are valid but clearly labelled. Exit status is 1 if any selected transcript is invalid
or a turn fails/uses classic fallback; it is 0 for normal GM completion. Neither status judges
prose quality, tool correctness, structural flags or owner acceptance.

Review flat prose, ignored intent, refusals, incorrect changes and missing consequences.
Record only anonymised findings in the repo. Fix systematic losses, rerun, then do W2's
owner-only 20-turn playtest before marking step 4 / W2 accepted.

## Privacy and verification

Never commit transcripts, their text, real reports, runtime campaigns or style examples.
The default `out/` directory is gitignored; report files are created with owner-only file
permissions (0600), directories with 0700. Custom `--out` paths must also stay outside git
or be ignored. Console output is counts and generic setup/errors, never transcript or model
text. The playable campaign is never opened for writes; only disposable copies receive turns.

```sh
bun test evals/replay/test
bun run check
```

These commands stay offline. Only the explicit eval command uses real providers. No browser
tests are necessary for this static escaped report; the machine's one-browser limit still applies.

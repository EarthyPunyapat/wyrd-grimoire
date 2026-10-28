#!/usr/bin/env bun
import { getRandomValues } from "node:crypto";
/**
 * Dev CLI: `bun run wyrd <command>`. Roll checks, build and validate sheets, create campaign
 * files, append events, rewind, rebuild, and validate packs. Run with --help for usage.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type CampaignSettingsInput,
  type CharacterSheet,
  type CompiledPack,
  type Difficulty,
  defaultTuning,
  draft,
  Entity,
  type EventDraft,
  type EventEnvelope,
  isEventType,
  Rng,
  seedRng,
} from "@wyrd/core";
import {
  buildSheet,
  CORE_SKILL_CATALOG,
  createActor,
  createCampaign,
  type GameState,
  hasErrors,
  pushCheck,
  RESOLUTION_MODULES,
  type Result,
  type RulesContext,
  reduce,
  resolveCheck,
  spendLuckReroll,
  validateCreation,
} from "@wyrd/engine";
import {
  creationContent,
  listWorlds,
  loadPack,
  loadWorld,
  scaffoldPack,
  skillCatalog,
  worldEvents,
} from "@wyrd/packs";
import { CampaignStore, StorageError } from "@wyrd/storage";
import { parse as parseYaml } from "yaml";
import { browserCommand } from "./browser.ts";
import { CliError } from "./errors.ts";
import { playCommand, WORLD_BIBLE_ID } from "./play.ts";
import { buildProviders, chatGptAuth, configPath, initConfig, loadConfig, secretStore } from "./providers.ts";

const HELP = `wyrd — Wyrd Grimoire dev CLI

Usage: bun run wyrd <command> [options]

Dice
  roll <skill%> [--difficulty normal] [--mod source=value]... [--boons n] [--banes n]
                [--dice d100|d20] [--seed s] [--label text]
      Roll one check against a skill value and print the mechanics line.

Characters
  sheet build --archetype <id> --name <name> [--ancestry <id>] [--pack <dir>] [--out file.json]
      Build a sheet from an archetype's suggestions and validate it.
  sheet validate <sheet.json|.yaml> [--pack <dir>]
      Validate a sheet (derived stats and status are filled in if missing). Exit 1 on errors.

Campaigns (a campaign is one SQLite file)
  campaign create <file.db> --name <name> [--pack <dir>] [--dice d100|d20] [--hardcore]
                  [--seed s] [--pc sheet.json] [--world <id>]
      --world loads a hand-authored world from the pack (e.g. ashford-ferry) and opens its first scene.
  check <file.db> --actor <id> --skill <skillId | attr:end> [--difficulty normal] [--mod source=value]...
                  [--boons n] [--banes n] [--tag t]... [--purpose text]
      Resolve a check with the engine and append its events.
  push <file.db> --actor <id>          Push the actor's last failed check.
  luck <file.db> --actor <id>          Spend 1 Luck to reroll the PC's last check.
  events list <file.db> [--branch id] [--json]
  events export <file.db> [--from seq] [--branch id]      Print events as JSON-lines drafts.
  events append <file.db> <Type> <payload-json>           Append one event.
  events append <file.db> --file drafts.jsonl             Append every draft in a JSON-lines file.
  rewind <file.db> <seq>               Fork a new branch at seq and make it active (not in hardcore).
  branches <file.db>                   List branches; * marks the active one.
  activate <file.db> <branchId>        Switch the active branch.
  play <file.db> [--offline] [--input text]... [--config file]
      Play exploration turns in the terminal. --offline uses a keyword-matching stand-in for the
      models (no keys needed); --input runs scripted turns and exits. /help inside for commands.
  hash <file.db> [--branch id] [--seq n]

Models (config in WYRD_HOME/config.json, keys in WYRD_HOME/secrets/)
  config init | config path            Write an example provider config / print where it lives.
  secret set <name>                    Save a key from stdin: printf %s 'KEY' | bun run wyrd secret set deepseek.key
  connect chatgpt                      "Continue with ChatGPT" (run on the PC that hosts Wyrd).
  models <provider>                    List the models a configured provider offers.
  rebuild <file.db>                    Drop projections and snapshots, replay, print the state hash.

Packs
  pack validate <dir>                  Schema, references and balance lints. Exit 1 on errors.
  pack new <id> [--dir packs/<id>]     Scaffold an empty pack.
`;

const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

/** Production reducer: unknown future event types are skipped with a warning, not fatal. */
const productionReduce = (s: GameState | undefined, e: EventEnvelope) =>
  reduce(s, e, { onUnknown: "skip", warn: (m) => err(`warning: ${m}`) });

const randomSeed = () => getRandomValues(new Uint32Array(1))[0]!;

function unwrapOrFail<T>(r: Result<T>): T {
  if (r.ok) return r.value;
  throw new CliError(r.errors.map((e) => `${e.code}: ${e.message}`).join("\n"));
}

function readStructured(path: string): unknown {
  if (!existsSync(path)) throw new CliError(`No such file: ${path}`);
  const text = readFileSync(path, "utf8");
  return path.endsWith(".yaml") || path.endsWith(".yml") ? parseYaml(text) : JSON.parse(text);
}

function loadPackOrFail(dir: string): CompiledPack {
  const { pack, issues } = loadPack(resolve(dir));
  if (!pack) {
    for (const i of issues)
      err(`${i.severity} ${i.code} ${i.file}${i.path ? `:${i.path}` : ""} — ${i.message}`);
    throw new CliError(`Pack ${dir} has errors; run \`wyrd pack validate ${dir}\``);
  }
  return pack;
}

function openStore(file: string): CampaignStore<GameState> {
  if (!existsSync(file)) throw new CliError(`No such campaign file: ${file}`);
  return CampaignStore.open<GameState>(file, {
    reduce: productionReduce,
    snapshotEvery: defaultTuning.snapshotEvery,
  });
}

function rulesFor(store: CampaignStore<GameState>): RulesContext {
  const snap = store.packSnapshot();
  const skills = snap ? skillCatalog([snap.content as CompiledPack]) : CORE_SKILL_CATALOG;
  return { skills, tuning: defaultTuning };
}

function parseMods(mods: string[] | undefined) {
  return (mods ?? []).map((m) => {
    const eq = m.lastIndexOf("=");
    const value = Number(m.slice(eq + 1));
    if (eq < 1 || !Number.isInteger(value)) throw new CliError(`--mod expects source=value, got "${m}"`);
    return { source: m.slice(0, eq), value };
  });
}

function parseDifficulty(d: string | undefined): Difficulty {
  const v = d ?? "normal";
  if (!["easy", "normal", "hard", "extreme", "heroic"].includes(v))
    throw new CliError(`Unknown difficulty ${v}`);
  return v as Difficulty;
}

const int = (v: string | undefined, name: string, fallback: number) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new CliError(`${name} must be an integer`);
  return n;
};

function printEvents(events: EventEnvelope[], json: boolean): void {
  for (const e of events) {
    if (json) out(JSON.stringify(e));
    else {
      const detail =
        e.type === "CheckResolved"
          ? e.payload.effective.display.text
          : JSON.stringify(e.payload).slice(0, 100);
      out(
        `${String(e.seq).padStart(5)}  ${e.branchId.slice(0, 10).padEnd(10)}  ${e.type.padEnd(16)}  ${detail}`,
      );
    }
  }
}

function appendAndPrint(store: CampaignStore<GameState>, drafts: EventDraft[]): void {
  const written = store.append(drafts);
  printEvents(written, false);
}

const COMMON = {
  difficulty: { type: "string" },
  mod: { type: "string", multiple: true },
  boons: { type: "string" },
  banes: { type: "string" },
  dice: { type: "string" },
  seed: { type: "string" },
  label: { type: "string" },
  archetype: { type: "string" },
  name: { type: "string" },
  ancestry: { type: "string" },
  pack: { type: "string" },
  out: { type: "string" },
  hardcore: { type: "boolean" },
  pc: { type: "string" },
  actor: { type: "string" },
  skill: { type: "string" },
  tag: { type: "string", multiple: true },
  purpose: { type: "string" },
  branch: { type: "string" },
  json: { type: "boolean" },
  world: { type: "string" },
  offline: { type: "boolean" },
  input: { type: "string", multiple: true },
  config: { type: "string" },
  from: { type: "string" },
  seq: { type: "string" },
  file: { type: "string" },
  dir: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

async function main(argv: string[]): Promise<number> {
  const { values: o, positionals: p } = parseArgs({
    args: argv,
    options: COMMON,
    allowPositionals: true,
    strict: true,
  });
  const [cmd, sub, ...rest] = p;
  if (o.help || !cmd) {
    out(HELP);
    return 0;
  }

  switch (cmd) {
    case "roll": {
      const value = int(sub, "skill%", Number.NaN);
      if (!(value >= 0 && value <= 100)) throw new CliError("roll needs a skill value 0–100");
      const dice = (o.dice ?? "d100") as "d100" | "d20";
      const module = RESOLUTION_MODULES[dice];
      if (!module) throw new CliError(`Unknown dice ${o.dice}`);
      const modifiers = parseMods(o.mod);
      const raw = modifiers.reduce((s, m) => s + m.value, 0);
      const cap = defaultTuning.modifierCap;
      const net = Math.max(-2, Math.min(2, int(o.boons, "--boons", 0) - int(o.banes, "--banes", 0)));
      const rng = new Rng(seedRng(o.seed ?? randomSeed()));
      const result = module.resolve(
        {
          label: o.label ?? "Check",
          skillValue: value,
          difficulty: parseDifficulty(o.difficulty),
          modifiers,
          modifierTotal: Math.max(-cap, Math.min(cap, raw)),
          netBoons: net,
        },
        rng,
        defaultTuning,
      );
      out(result.display.text);
      return 0;
    }

    case "sheet": {
      const pack = loadPackOrFail(o.pack ?? "packs/fantasy-core");
      const content = creationContent([pack]);
      const settings = createCampaign({ name: "x", packIds: [pack.manifest.id], seed: 0 });
      const campaignSettings = unwrapOrFail(settings).payload.settings;
      let sheet: CharacterSheet;
      if (sub === "build") {
        const id = o.archetype?.includes(":") ? o.archetype : `${pack.manifest.id}:${o.archetype}`;
        const a = content.archetypes[id];
        if (!a)
          throw new CliError(
            `Unknown archetype ${o.archetype}; try one of ${Object.keys(content.archetypes).join(", ")}`,
          );
        const ancestry = o.ancestry
          ? o.ancestry.includes(":")
            ? o.ancestry
            : `${pack.manifest.id}:${o.ancestry}`
          : `${pack.manifest.id}:human`;
        sheet = buildSheet(
          {
            id: "pc",
            identity: { name: o.name ?? a.name, ancestry },
            bodyPlan: content.ancestries[ancestry]?.bodyPlan,
            archetypeId: a.id,
            attributes: a.suggestedAttributes,
            skills: Object.fromEntries(Object.entries(a.skills).map(([k, v]) => [k, { trained: v }])),
            talents: [a.talent],
          },
          campaignSettings,
          defaultTuning,
        );
      } else if (sub === "validate") {
        const file = rest[0];
        if (!file) throw new CliError("sheet validate needs a file");
        const raw = readStructured(file) as Record<string, unknown>;
        try {
          sheet = buildSheet(raw as Parameters<typeof buildSheet>[0], campaignSettings, defaultTuning);
          if (raw.derived) sheet = { ...sheet, derived: raw.derived as CharacterSheet["derived"] };
        } catch (e) {
          throw new CliError(`Sheet doesn't match the schema:\n${(e as Error).message}`);
        }
      } else {
        throw new CliError("Usage: sheet build | sheet validate");
      }
      const issues = validateCreation(sheet, content, campaignSettings, defaultTuning);
      for (const i of issues) err(`${i.severity} ${i.code} ${i.path ?? ""} — ${i.message}`);
      if (sub === "build") {
        const json = JSON.stringify(sheet, null, 2);
        if (o.out) writeFileSync(o.out, `${json}\n`);
        else out(json);
      } else if (!hasErrors(issues)) {
        out(`valid${issues.length ? ` (${issues.length} warning${issues.length === 1 ? "" : "s"})` : ""}`);
      }
      return hasErrors(issues) ? 1 : 0;
    }

    case "campaign": {
      if (sub !== "create") throw new CliError("Usage: campaign create <file.db> --name <name>");
      const file = rest[0];
      if (!file || !o.name) throw new CliError("campaign create needs a file and --name");
      if (existsSync(file)) throw new CliError(`${file} already exists`);
      const pack = loadPackOrFail(o.pack ?? "packs/fantasy-core");
      const settings: CampaignSettingsInput = {
        structural: { resolution: (o.dice ?? "d100") as "d100" | "d20", hardcore: o.hardcore ?? false },
      };
      const created = unwrapOrFail(
        createCampaign({
          name: o.name,
          packIds: [pack.manifest.id],
          packHash: pack.hash,
          settings,
          seed: o.seed ?? randomSeed(),
        }),
      );
      const store = CampaignStore.create<GameState>(file, created, {
        reduce: productionReduce,
        snapshotEvery: defaultTuning.snapshotEvery,
        pack: { hash: pack.hash, content: pack },
      });
      if (o.pc) {
        const raw = readStructured(o.pc) as Parameters<typeof buildSheet>[0];
        const sheet = buildSheet(raw, store.state().campaign.settings, defaultTuning);
        const issues = validateCreation(
          sheet,
          creationContent([pack]),
          store.state().campaign.settings,
          defaultTuning,
        );
        if (hasErrors(issues)) {
          for (const i of issues) err(`${i.severity} ${i.code} ${i.path ?? ""} — ${i.message}`);
          store.close();
          throw new CliError("The PC sheet has errors; the campaign was created without a PC");
        }
        store.append(unwrapOrFail(createActor(store.state(), sheet, "pc")));
      }
      if (o.world) {
        const packDir = resolve(o.pack ?? "packs/fantasy-core");
        const { world, issues } = loadWorld(packDir, o.world);
        if (!world) {
          for (const i of issues) err(`error ${i.code} ${i.path} — ${i.message}`);
          store.close();
          throw new CliError(
            `World ${o.world} has errors; available: ${listWorlds(packDir).join(", ") || "none"}`,
          );
        }
        const state = store.state();
        const party = [state.party.pcId, ...state.party.companionIds].filter((x): x is string => !!x);
        store.append([
          draft(
            "EntityCreated",
            {
              entity: Entity.parse({
                id: WORLD_BIBLE_ID,
                kind: "concept",
                name: world.name,
                detail: "full",
                summary: world.premise,
              }),
            },
            "system",
          ),
          ...worldEvents(world, party, state.campaign.gameTime),
        ]);
        out(`loaded world ${world.name}${party.length ? "" : " (no PC yet: pass --pc to place one)"}`);
      }
      out(`created ${file} (campaign ${store.campaignId})`);
      out(`hash ${store.stateHash()}`);
      store.close();
      return 0;
    }

    case "check":
    case "push":
    case "luck": {
      const store = openStore(sub ?? "");
      try {
        const ctx = rulesFor(store);
        const state = store.state();
        const actorId = o.actor ?? state.party.pcId ?? "";
        let outcome: Result<{ events: EventDraft[] }>;
        if (cmd === "check") {
          if (!o.skill) throw new CliError("check needs --skill (a skill ID or attr:<attribute>)");
          const skill = o.skill.startsWith("attr:")
            ? { attribute: o.skill.slice(5) as "str" }
            : o.skill.includes(":")
              ? o.skill
              : `core:${o.skill}`;
          outcome = resolveCheck(
            state,
            {
              actorId,
              skill,
              difficulty: parseDifficulty(o.difficulty),
              modifiers: parseMods(o.mod),
              boons: int(o.boons, "--boons", 0),
              banes: int(o.banes, "--banes", 0),
              tags: o.tag ?? [],
              purpose: o.purpose ?? "dev CLI check",
            },
            ctx,
          );
        } else if (cmd === "push") {
          outcome = pushCheck(state, actorId, ctx);
        } else {
          outcome = spendLuckReroll(state, actorId, ctx);
        }
        appendAndPrint(store, unwrapOrFail(outcome).events);
      } finally {
        store.close();
      }
      return 0;
    }

    case "events": {
      const file = rest[0];
      const store = openStore(file ?? "");
      try {
        if (sub === "list") {
          printEvents(store.events(o.branch ?? store.activeBranchId), o.json ?? false);
        } else if (sub === "export") {
          for (const e of store.events(o.branch ?? store.activeBranchId, int(o.from, "--from", 1))) {
            out(JSON.stringify({ type: e.type, payload: e.payload, source: e.source }));
          }
        } else if (sub === "append") {
          let drafts: EventDraft[];
          if (o.file) {
            drafts = readFileSync(o.file, "utf8")
              .split("\n")
              .filter((l) => l.trim())
              .map((l) => JSON.parse(l) as EventDraft);
          } else {
            const [type, json] = rest.slice(1);
            if (!type || !json) throw new CliError("events append needs <Type> <payload-json> or --file");
            if (!isEventType(type)) throw new CliError(`Unknown event type ${type}`);
            drafts = [{ type, payload: JSON.parse(json), source: "system" } as EventDraft];
          }
          // A fork already starts with its own BranchForked event; don't copy old ones across.
          appendAndPrint(
            store,
            drafts.filter((d) => d.type !== "BranchForked" && d.type !== "CampaignCreated"),
          );
        } else {
          throw new CliError("Usage: events list | export | append");
        }
      } finally {
        store.close();
      }
      return 0;
    }

    case "rewind": {
      const store = openStore(sub ?? "");
      try {
        const branch = store.rewind(int(rest[0], "seq", Number.NaN));
        out(`rewound to seq ${branch.forkSeq}; active branch is now ${branch.id}`);
        out(`hash ${store.stateHash()}`);
      } finally {
        store.close();
      }
      return 0;
    }

    case "branches": {
      const store = openStore(sub ?? "");
      try {
        for (const b of store.branches()) {
          const mark = b.id === store.activeBranchId ? "*" : " ";
          out(
            `${mark} ${b.id.padEnd(26)}  head ${String(b.head).padStart(5)}  parent ${b.parentBranchId ?? "-"} @ ${b.forkSeq}`,
          );
        }
      } finally {
        store.close();
      }
      return 0;
    }

    case "activate": {
      const store = openStore(sub ?? "");
      try {
        store.activateBranch(rest[0] ?? "");
        out(`active branch is now ${store.activeBranchId}`);
      } finally {
        store.close();
      }
      return 0;
    }

    case "hash": {
      const store = openStore(sub ?? "");
      try {
        out(
          store.stateHash(
            o.branch ?? store.activeBranchId,
            o.seq === undefined ? undefined : int(o.seq, "--seq", 0),
          ),
        );
      } finally {
        store.close();
      }
      return 0;
    }

    case "rebuild": {
      const store = openStore(sub ?? "");
      try {
        out(`hash ${store.rebuild()}`);
      } finally {
        store.close();
      }
      return 0;
    }

    case "play": {
      const store = openStore(sub ?? "");
      return playCommand(store, rulesFor(store), {
        offline: o.offline ?? false,
        inputs: o.input,
        ...(o.config ? { configPath: o.config } : {}),
      }).finally(() => store.close());
    }

    case "config": {
      if (sub === "init") {
        out(`wrote ${initConfig(o.config)}`);
        out(
          "Next: add keys with `wyrd secret set`, pick models with `wyrd models <provider>`, then edit the file.",
        );
        return 0;
      }
      if (sub === "path") {
        out(configPath(o.config));
        return 0;
      }
      throw new CliError("Usage: config init | config path");
    }

    case "secret": {
      const name = rest[0];
      if (sub !== "set" || !name)
        throw new CliError("Usage: printf %s 'KEY' | bun run wyrd secret set <name>");
      const value = (await Bun.stdin.text()).trim();
      if (!value) throw new CliError("No secret on stdin");
      secretStore().write(name, value);
      out(`saved ${name}`);
      return 0;
    }

    case "connect": {
      if (sub !== "chatgpt") throw new CliError("Usage: connect chatgpt");
      const auth = chatGptAuth();
      out("Continue with ChatGPT: a browser window will open on this PC.");
      out("(The sign-in must happen in a browser on the PC that runs Wyrd: the redirect goes to 127.0.0.1.)");
      const rec = await auth.connect({
        open: (url) => {
          out(`If it doesn't open, visit:\n${url}`);
          try {
            Bun.spawn(browserCommand(url), { stdout: "ignore", stderr: "ignore" });
          } catch {
            // no browser launcher; the URL is printed above
          }
        },
      });
      out(
        rec.plan_usage
          ? `Connected as ${rec.email ?? rec.subject}. Plan usage is on.`
          : "Signed in, but plan usage wasn't granted, so ChatGPT can't narrate. Connect again and allow it.",
      );
      return 0;
    }

    case "models": {
      const id = sub;
      if (!id) throw new CliError("Usage: models <provider id from config.json>");
      const providers = buildProviders(loadConfig(o.config, { allowPlaceholders: true }));
      const p = providers[id];
      if (!p) throw new CliError(`No provider ${id}; configured: ${Object.keys(providers).join(", ")}`);
      for (const m of await p.listModels()) out(m.id);
      return 0;
    }

    case "pack": {
      if (sub === "validate") {
        const dir = rest[0];
        if (!dir) throw new CliError("pack validate needs a directory");
        const { pack, issues } = loadPack(resolve(dir));
        for (const i of issues)
          err(`${i.severity} ${i.code} ${i.file}${i.path ? `:${i.path}` : ""} — ${i.message}`);
        if (!pack) {
          err(`${dir}: invalid`);
          return 1;
        }
        const warnings = issues.length;
        out(
          `${pack.manifest.id} ${pack.manifest.version}: valid${warnings ? ` with ${warnings} warning(s)` : ""} (hash ${pack.hash.slice(0, 12)})`,
        );
        return 0;
      }
      if (sub === "new") {
        const id = rest[0];
        if (!id) throw new CliError("pack new needs an id");
        const dir = o.dir ?? `packs/${id}`;
        scaffoldPack(dir, id);
        out(`created ${dir}`);
        return 0;
      }
      throw new CliError("Usage: pack validate <dir> | pack new <id>");
    }

    default:
      throw new CliError(`Unknown command "${cmd}". Run with --help.`);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof CliError || e instanceof StorageError) {
    err(`error: ${e.message}`);
    process.exitCode = 2;
  } else if (e instanceof TypeError && "code" in e && String(e.code).startsWith("ERR_PARSE_ARGS")) {
    err(`error: ${e.message}\nRun with --help for usage.`);
    process.exitCode = 2;
  } else {
    throw e;
  }
}

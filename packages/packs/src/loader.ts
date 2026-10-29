import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AncestryDef,
  ArchetypeDef,
  ArmorDef,
  BodyPlanDef,
  CalendarDef,
  ClassDef,
  type CompiledPack,
  CreatureDef,
  DiseaseDef,
  EconomyDef,
  GearDef,
  HUMANOID_BODY_PLAN,
  LootTableDef,
  localIdOf,
  NamingDef,
  PackManifest,
  PregenDef,
  RecipeDef,
  SkillDef,
  SpellcastingConfig,
  SpellDef,
  stableStringify,
  TalentDef,
  WeaponDef,
} from "@wyrd/core";
import { CORE_SKILL_CATALOG, PACK_API_VERSION } from "@wyrd/engine";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { lintPack } from "./lints.ts";
import { satisfies } from "./semver.ts";
import { listWorlds, loadWorld } from "./world.ts";

export type PackIssue = {
  severity: "error" | "warning";
  code: string;
  file: string;
  path?: string;
  message: string;
};

export type LoadResult = { pack: CompiledPack | null; issues: PackIssue[] };

/** Plugins that exist in this build, with the schema their pack config is validated against. */
export const PLUGIN_CONFIG_SCHEMAS = {
  spellcasting: SpellcastingConfig,
} as const;
export const KNOWN_PLUGINS: ReadonlySet<string> = new Set(Object.keys(PLUGIN_CONFIG_SCHEMAS));

const CONTENT_FILES = {
  skills: { file: "skills.yaml", schema: SkillDef },
  talents: { file: "talents.yaml", schema: TalentDef },
  ancestries: { file: "ancestries.yaml", schema: AncestryDef },
  bodyPlans: { file: "bodyplans.yaml", schema: BodyPlanDef },
  archetypes: { file: "archetypes.yaml", schema: ArchetypeDef },
  pregens: { file: "pregens.yaml", schema: PregenDef },
  weapons: { file: "items/weapons.yaml", schema: WeaponDef },
  armor: { file: "items/armor.yaml", schema: ArmorDef },
  gear: { file: "items/gear.yaml", schema: GearDef },
  creatures: { file: "creatures.yaml", schema: CreatureDef },
  classes: { file: "classes.yaml", schema: ClassDef },
  spells: { file: "spells.yaml", schema: SpellDef },
  lootTables: { file: "loot-tables.yaml", schema: LootTableDef },
  recipes: { file: "recipes.yaml", schema: RecipeDef },
  diseases: { file: "diseases.yaml", schema: DiseaseDef },
} as const;

/** Content that is one object per pack rather than a list. */
const SINGLETON_FILES = {
  economy: { file: "economy.yaml", schema: EconomyDef },
  calendar: { file: "calendar.yaml", schema: CalendarDef },
  naming: { file: "naming.yaml", schema: NamingDef },
} as const;

type Kind = keyof typeof CONTENT_FILES;
type Entry<K extends Kind> = z.infer<(typeof CONTENT_FILES)[K]["schema"]>;

/**
 * Returns why a body plan's d100 bands don't cover 1–100 exactly once, or null if they do.
 * Bands must not be inverted, overlap, leave a gap, or stop short of 100.
 */
function bodyPlanRangeProblem(plan: BodyPlanDef): string | null {
  for (const l of plan.locations) {
    if (l.from > l.to) return `Location "${l.id}" has from ${l.from} above to ${l.to}`;
  }
  const bands = [...plan.locations].sort((a, b) => a.from - b.from);
  let next = 1;
  for (const l of bands) {
    if (l.from < next) return `Location "${l.id}" overlaps rolls ${l.from}–${Math.min(l.to, next - 1)}`;
    if (l.from > next) return `Rolls ${next}–${l.from - 1} hit no location`;
    next = l.to + 1;
  }
  if (next <= 100) return `Rolls ${next}–100 hit no location`;
  return null;
}

/**
 * Loads a pack directory, validates every file with the core zod schemas, namespaces every ID
 * (`packId:localId`), resolves references and runs balance lints. Returns the compiled pack
 * (null if there are errors) and every issue found, so `pack validate` can report them all.
 */
export function loadPack(dir: string): LoadResult {
  const issues: PackIssue[] = [];
  const error = (code: string, file: string, message: string, path?: string) =>
    issues.push({ severity: "error", code, file, message, ...(path ? { path } : {}) });

  const readYaml = (file: string, required: boolean): unknown => {
    const full = join(dir, file);
    if (!existsSync(full)) {
      if (required) error("FILE_MISSING", file, `${file} is required`);
      return undefined;
    }
    try {
      return parseYaml(readFileSync(full, "utf8"));
    } catch (e) {
      error("YAML_SYNTAX", file, (e as Error).message);
      return undefined;
    }
  };

  // Manifest.
  const manifestParsed = PackManifest.safeParse(readYaml("pack.yaml", true));
  if (!manifestParsed.success) {
    if (existsSync(join(dir, "pack.yaml"))) {
      for (const i of manifestParsed.error.issues) error("SCHEMA", "pack.yaml", i.message, i.path.join("."));
    }
    return { pack: null, issues };
  }
  const manifest = manifestParsed.data;
  const ns = manifest.id;
  const compat = satisfies(PACK_API_VERSION, manifest.engine);
  if (compat === null)
    error("ENGINE_RANGE_INVALID", "pack.yaml", `Can't parse engine range "${manifest.engine}"`, "engine");
  else if (!compat) {
    error(
      "ENGINE_INCOMPATIBLE",
      "pack.yaml",
      `Pack needs engine ${manifest.engine}; this is ${PACK_API_VERSION}`,
      "engine",
    );
  }
  for (const [i, p] of manifest.plugins.entries()) {
    if (!KNOWN_PLUGINS.has(p.id))
      error("PLUGIN_UNKNOWN", "pack.yaml", `No plugin "${p.id}" in this build`, `plugins.${i}`);
  }

  const tonePath = join(dir, "tone.md");
  const tone = existsSync(tonePath) ? readFileSync(tonePath, "utf8") : "";
  if (!tone.trim())
    issues.push({
      severity: "warning",
      code: "TONE_MISSING",
      file: "tone.md",
      message: "No narrator style guide",
    });

  // Content files: parse, validate, check duplicate IDs.
  const content = {} as { [K in Kind]: Record<string, Entry<K> & { id: string }> };
  const origin = new Map<string, { file: string; path: string }>();
  for (const kind of Object.keys(CONTENT_FILES) as Kind[]) {
    const { file, schema } = CONTENT_FILES[kind];
    const raw = readYaml(file, false);
    const out: Record<string, { id: string }> = {};
    content[kind] = out as never;
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw)) {
      error("SCHEMA", file, "Expected a list of entries");
      continue;
    }
    raw.forEach((entry, index) => {
      const parsed = schema.safeParse(entry);
      if (!parsed.success) {
        for (const i of parsed.error.issues) error("SCHEMA", file, i.message, [index, ...i.path].join("."));
        return;
      }
      const id = `${ns}:${parsed.data.id}`;
      if (out[id]) {
        error("DUPLICATE_ID", file, `Duplicate id "${parsed.data.id}"`, `${index}.id`);
        return;
      }
      out[id] = { ...parsed.data, id };
      origin.set(id, { file, path: String(index) });
    });
  }

  // Singleton content (economy, calendar, naming) and plugin configs.
  const singletons: Record<string, { id: string } | null> = {};
  for (const kind of Object.keys(SINGLETON_FILES) as (keyof typeof SINGLETON_FILES)[]) {
    const { file, schema } = SINGLETON_FILES[kind];
    const raw = readYaml(file, false);
    if (raw === undefined || raw === null) {
      singletons[kind] = null;
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues) error("SCHEMA", file, i.message, i.path.join("."));
      singletons[kind] = null;
      continue;
    }
    const id = `${ns}:${parsed.data.id}`;
    singletons[kind] = { ...parsed.data, id };
    origin.set(id, { file, path: "0" });
  }
  const pluginConfigs: Record<string, unknown> = {};
  for (const [i, plugin] of manifest.plugins.entries()) {
    if (!KNOWN_PLUGINS.has(plugin.id)) continue;
    const schema = PLUGIN_CONFIG_SCHEMAS[plugin.id as keyof typeof PLUGIN_CONFIG_SCHEMAS];
    const file = plugin.config ?? `plugins/${plugin.id}.yaml`;
    const parsed = schema.safeParse(readYaml(file, false) ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        error("PLUGIN_CONFIG", file, issue.message, [i, ...issue.path].join("."));
      continue;
    }
    pluginConfigs[plugin.id] = parsed.data;
  }

  // Reference resolution. Skills resolve to this pack first, then the core skills.
  const skills = { ...CORE_SKILL_CATALOG, ...content.skills };
  const qualify = (ref: string) => (ref.includes(":") ? ref : `${ns}:${ref}`);
  const resolveSkill = (ref: string): string | null => {
    const [base, field] = ref.split("/") as [string, string | undefined];
    const candidates = base.includes(":") ? [base] : [`${ns}:${base}`, `core:${base}`];
    const found = candidates.find((c) => skills[c]);
    if (!found) return null;
    const def = skills[found]!;
    if (def.field !== (field !== undefined)) return null;
    return field ? `${found}/${field}` : found;
  };
  const where = (id: string) => origin.get(id) ?? { file: "?", path: "" };
  const badRef = (ownerId: string, path: string, what: string, ref: string) => {
    const o = where(ownerId);
    error(
      "REFERENCE_BROKEN",
      o.file,
      `${what} "${ref}" doesn't exist (or misses/has a field specialisation)`,
      `${o.path}.${path}`,
    );
  };
  const ref = <T>(table: Record<string, T>, r: string) => (table[qualify(r)] ? qualify(r) : null);
  const allItems = { ...content.weapons, ...content.armor, ...content.gear };

  for (const t of Object.values(content.talents)) {
    t.prerequisites.skills = Object.fromEntries(
      Object.entries(t.prerequisites.skills).map(([s, v]) => {
        const resolved = resolveSkill(s);
        if (!resolved) badRef(t.id, `prerequisites.skills.${s}`, "Skill", s);
        return [resolved ?? s, v];
      }),
    );
    t.prerequisites.talents = t.prerequisites.talents.map((r) => {
      const resolved = ref(content.talents, r);
      if (!resolved) badRef(t.id, "prerequisites.talents", "Talent", r);
      return resolved ?? r;
    });
  }
  for (const a of Object.values(content.ancestries)) {
    // A humanoid plan the pack doesn't declare resolves to the built-in one.
    const builtIn = localIdOf(a.bodyPlan) === localIdOf(HUMANOID_BODY_PLAN.id) ? HUMANOID_BODY_PLAN.id : null;
    const plan = ref(content.bodyPlans, a.bodyPlan) ?? builtIn;
    if (!plan) badRef(a.id, "bodyPlan", "Body plan", a.bodyPlan);
    a.bodyPlan = plan ?? a.bodyPlan;
  }
  for (const plan of Object.values(content.bodyPlans)) {
    const problem = bodyPlanRangeProblem(plan);
    if (problem) {
      const o = where(plan.id);
      error("BODYPLAN_RANGES", o.file, problem, o.path);
    }
  }
  for (const a of Object.values(content.archetypes)) {
    a.skills = Object.fromEntries(
      Object.entries(a.skills).map(([s, v]) => {
        const resolved = resolveSkill(s);
        if (!resolved) badRef(a.id, `skills.${s}`, "Skill", s);
        return [resolved ?? s, v];
      }),
    );
    const talent = ref(content.talents, a.talent);
    if (!talent) badRef(a.id, "talent", "Talent", a.talent);
    a.talent = talent ?? a.talent;
    if (a.class) {
      const cls = ref(content.classes, a.class);
      if (!cls) badRef(a.id, "class", "Class", a.class);
      a.class = cls ?? a.class;
    }
    a.spells = a.spells.map((spellRef, i) => {
      const spell = ref(content.spells, spellRef);
      if (!spell) badRef(a.id, `spells.${i}`, "Spell", spellRef);
      return spell ?? spellRef;
    });
    a.kit = a.kit.map((k, i) => {
      const item = ref(allItems, k.item);
      if (!item) badRef(a.id, `kit.${i}.item`, "Item", k.item);
      return { ...k, item: item ?? k.item };
    });
  }
  for (const p of Object.values(content.pregens)) {
    const ancestry = ref(content.ancestries, p.ancestry);
    if (!ancestry) badRef(p.id, "ancestry", "Ancestry", p.ancestry);
    p.ancestry = ancestry ?? p.ancestry;
    const archetype = ref(content.archetypes, p.archetype);
    if (!archetype) badRef(p.id, "archetype", "Archetype", p.archetype);
    p.archetype = archetype ?? p.archetype;
    if (p.freeTalent) {
      const talent = ref(content.talents, p.freeTalent);
      if (!talent) badRef(p.id, "freeTalent", "Talent", p.freeTalent);
      p.freeTalent = talent ?? p.freeTalent;
    }
  }
  for (const w of Object.values(content.weapons)) {
    const s = resolveSkill(w.skill);
    if (!s) badRef(w.id, "skill", "Skill", w.skill);
    w.skill = s ?? w.skill;
    w.strengthBonus ??= localIdOf(w.skill) !== "ranged";
  }
  for (const a of Object.values(content.armor)) {
    a.penalties = a.penalties.map((p, i) => {
      const s = resolveSkill(p.skill);
      if (!s) badRef(a.id, `penalties.${i}.skill`, "Skill", p.skill);
      return { ...p, skill: s ?? p.skill };
    });
  }

  for (const c of Object.values(content.creatures)) {
    c.skills = Object.fromEntries(
      Object.entries(c.skills).map(([sk, v]) => {
        const resolved = resolveSkill(sk);
        if (!resolved) badRef(c.id, `skills.${sk}`, "Skill", sk);
        return [resolved ?? sk, v];
      }),
    );
    const builtIn = localIdOf(c.bodyPlan) === localIdOf(HUMANOID_BODY_PLAN.id) ? HUMANOID_BODY_PLAN.id : null;
    const plan = ref(content.bodyPlans, c.bodyPlan) ?? builtIn;
    if (!plan) badRef(c.id, "bodyPlan", "Body plan", c.bodyPlan);
    c.bodyPlan = plan ?? c.bodyPlan;
    c.kit = c.kit.map((k, i) => {
      const item = ref(allItems, k.item);
      if (!item) badRef(c.id, `kit.${i}.item`, "Item", k.item);
      return { ...k, item: item ?? k.item };
    });
    // Natural weapons and hide become ordinary items the creature carries.
    for (const w of c.naturalWeapons) {
      const id = `${c.id}-${w.id}`;
      const s = resolveSkill(w.skill);
      if (!s) badRef(c.id, `naturalWeapons.${w.id}.skill`, "Skill", w.skill);
      content.weapons[id] = {
        ...w,
        id,
        skill: s ?? w.skill,
        strengthBonus: w.strengthBonus ?? true,
        tags: [...w.tags, "natural"],
      };
      c.kit.push({ item: id, qty: 1 });
    }
    if (c.naturalArmor) {
      const id = `${c.id}-hide`;
      content.armor[id] = {
        id,
        name: `${c.name} hide`,
        description: "",
        weightKg: 0,
        price: 0,
        tags: ["natural"],
        penalties: [],
        ...c.naturalArmor,
      };
      c.kit.push({ item: id, qty: 1 });
    }
  }

  for (const cls of Object.values(content.classes)) {
    cls.skills = cls.skills.map((s) => {
      const resolved = resolveSkill(s);
      if (!resolved) badRef(cls.id, `skills.${s}`, "Skill", s);
      return resolved ?? s;
    });
    cls.archetypes = cls.archetypes.map((a) => {
      const resolved = ref(content.archetypes, a);
      if (!resolved) badRef(cls.id, `archetypes.${a}`, "Archetype", a);
      return resolved ?? a;
    });
    cls.features = cls.features.map((f, i) => {
      if (!f.talent) return f;
      const resolved = ref(content.talents, f.talent);
      if (!resolved) badRef(cls.id, `features.${i}.talent`, "Talent", f.talent);
      return { ...f, talent: resolved ?? f.talent };
    });
  }
  if (manifest.supports.progression.includes("classes") && Object.keys(content.classes).length === 0) {
    error(
      "CLASSES_MISSING",
      "pack.yaml",
      "The pack claims class progression but has no classes.yaml",
      "supports.progression",
    );
  }
  for (const spell of Object.values(content.spells)) {
    const s = resolveSkill(spell.check);
    if (!s) badRef(spell.id, "check", "Skill", spell.check);
    spell.check = s ?? spell.check;
    spell.effects = spell.effects.map((effect, i) => {
      if (effect.kind === "summon") {
        const creature = ref(content.creatures, effect.creature);
        if (!creature) badRef(spell.id, `effects.${i}.creature`, "Creature", effect.creature);
        return { ...effect, creature: creature ?? effect.creature };
      }
      return effect;
    });
  }
  for (const table of Object.values(content.lootTables)) {
    table.entries = table.entries.map((entry, i) => {
      const item = ref(allItems, entry.item);
      if (!item) badRef(table.id, `entries.${i}.item`, "Item", entry.item);
      return { ...entry, item: item ?? entry.item };
    });
  }
  for (const recipe of Object.values(content.recipes)) {
    const s = resolveSkill(recipe.skill);
    if (!s) badRef(recipe.id, "skill", "Skill", recipe.skill);
    recipe.skill = s ?? recipe.skill;
    recipe.inputs = recipe.inputs.map((input, i) => {
      const item = ref(allItems, input.item);
      if (!item) badRef(recipe.id, `inputs.${i}.item`, "Item", input.item);
      return { ...input, item: item ?? input.item };
    });
    recipe.tools = recipe.tools.map((tool, i) => {
      const item = ref(allItems, tool);
      if (!item) badRef(recipe.id, `tools.${i}`, "Item", tool);
      return item ?? tool;
    });
    const output = ref(allItems, recipe.output.item);
    if (!output) badRef(recipe.id, "output.item", "Item", recipe.output.item);
    recipe.output = { ...recipe.output, item: output ?? recipe.output.item };
  }
  for (const [id, config] of Object.entries(pluginConfigs)) {
    const spellcasting = config as SpellcastingConfig;
    if (id === "spellcasting") {
      for (const [school, results] of Object.entries(spellcasting.miscasts)) {
        for (const [i, result] of (results ?? []).entries()) {
          if (result.condition && !/^[a-z0-9-]+:[a-z0-9-]+$/.test(result.condition))
            error(
              "PLUGIN_CONFIG",
              `plugins/${id}.yaml`,
              `Bad condition "${result.condition}"`,
              `miscasts.${school}.${i}`,
            );
        }
      }
    }
  }

  const body: Omit<CompiledPack, "hash"> = {
    manifest,
    tone,
    skills: content.skills,
    talents: content.talents,
    ancestries: content.ancestries,
    bodyPlans: content.bodyPlans,
    archetypes: content.archetypes,
    classes: content.classes,
    pregens: content.pregens,
    creatures: content.creatures,
    spells: content.spells,
    lootTables: content.lootTables,
    recipes: content.recipes,
    diseases: content.diseases,
    economy: (singletons.economy as (EconomyDef & { id: string }) | null) ?? null,
    calendar: (singletons.calendar as (CalendarDef & { id: string }) | null) ?? null,
    naming: (singletons.naming as (NamingDef & { id: string }) | null) ?? null,
    pluginConfigs,
    items: { weapons: content.weapons, armor: content.armor, gear: content.gear },
  };
  const hash = createHash("sha256").update(stableStringify(body)).digest("hex");
  const pack: CompiledPack = { ...body, hash };

  for (const worldId of listWorlds(dir)) {
    for (const i of loadWorld(dir, worldId).issues) {
      error(`WORLD_${i.code}`, `worlds/${worldId}/world.yaml`, i.message, i.path || undefined);
    }
  }

  if (!issues.some((i) => i.severity === "error")) issues.push(...lintPack(pack, where));
  return { pack: issues.some((i) => i.severity === "error") ? null : pack, issues };
}

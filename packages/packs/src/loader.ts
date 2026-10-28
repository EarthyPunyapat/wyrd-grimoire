import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AncestryDef,
  ArchetypeDef,
  ArmorDef,
  BodyPlanDef,
  type CompiledPack,
  CreatureDef,
  GearDef,
  HUMANOID_BODY_PLAN,
  localIdOf,
  PackManifest,
  SkillDef,
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

/** Plugins that exist in this build. Spellcasting lands in M7; until then packs may list none. */
export const KNOWN_PLUGINS: ReadonlySet<string> = new Set();

const CONTENT_FILES = {
  skills: { file: "skills.yaml", schema: SkillDef },
  talents: { file: "talents.yaml", schema: TalentDef },
  ancestries: { file: "ancestries.yaml", schema: AncestryDef },
  bodyPlans: { file: "bodyplans.yaml", schema: BodyPlanDef },
  archetypes: { file: "archetypes.yaml", schema: ArchetypeDef },
  weapons: { file: "items/weapons.yaml", schema: WeaponDef },
  armor: { file: "items/armor.yaml", schema: ArmorDef },
  gear: { file: "items/gear.yaml", schema: GearDef },
  creatures: { file: "creatures.yaml", schema: CreatureDef },
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
    a.kit = a.kit.map((k, i) => {
      const item = ref(allItems, k.item);
      if (!item) badRef(a.id, `kit.${i}.item`, "Item", k.item);
      return { ...k, item: item ?? k.item };
    });
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

  const body: Omit<CompiledPack, "hash"> = {
    manifest,
    tone,
    skills: content.skills,
    talents: content.talents,
    ancestries: content.ancestries,
    bodyPlans: content.bodyPlans,
    archetypes: content.archetypes,
    creatures: content.creatures,
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

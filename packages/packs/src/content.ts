import type { CompiledPack } from "@wyrd/core";
import { CORE_SKILL_CATALOG, type CreationContent, type SkillCatalog } from "@wyrd/engine";

/** The skill catalog for a campaign: core skills plus every pack's skills. */
export function skillCatalog(packs: readonly CompiledPack[]): SkillCatalog {
  return Object.assign({}, CORE_SKILL_CATALOG, ...packs.map((p) => p.skills));
}

/** Everything the creation validator needs, merged from the campaign's packs (load order wins). */
export function creationContent(packs: readonly CompiledPack[]): CreationContent {
  return {
    skills: skillCatalog(packs),
    talents: Object.assign({}, ...packs.map((p) => p.talents)),
    ancestries: Object.assign({}, ...packs.map((p) => p.ancestries)),
    archetypes: Object.assign({}, ...packs.map((p) => p.archetypes)),
  };
}

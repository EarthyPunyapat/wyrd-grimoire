import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PACK_API_VERSION } from "@wyrd/engine";

/** `wyrd pack new <id>`: an empty pack that passes `pack validate` (with warnings). */
export function scaffoldPack(dir: string, id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error(`Pack id "${id}" must be lowercase letters, digits and dashes`);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  const major = Number(PACK_API_VERSION.split(".")[0]);
  mkdirSync(join(dir, "items"), { recursive: true });
  writeFileSync(
    join(dir, "pack.yaml"),
    [
      `id: ${id}`,
      `name: "${id}"`,
      "version: 0.1.0",
      `engine: ">=${major}.0.0 <${major + 1}.0.0"`,
      'description: ""',
      "tags: []",
      "kind: genre",
      "requires: []",
      "plugins: []",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "tone.md"), `# ${id} — narrator style guide\n\n`);
  for (const f of ["skills.yaml", "talents.yaml", "ancestries.yaml", "archetypes.yaml"]) {
    writeFileSync(join(dir, f), "[]\n");
  }
  for (const f of ["weapons.yaml", "armor.yaml", "gear.yaml"]) writeFileSync(join(dir, "items", f), "[]\n");
}

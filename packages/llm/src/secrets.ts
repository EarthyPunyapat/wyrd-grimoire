import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Secrets in `WYRD_HOME/secrets/` (spec 09): API keys and OAuth tokens, one file each, owner-only
 * permissions, written atomically (temp file, then rename) so a crash mid-refresh never leaves a
 * half-written token. Values are never logged; `redact` scrubs them from error text.
 */
export class SecretStore {
  private readonly known = new Set<string>();

  constructor(readonly dir: string) {}

  private path(name: string): string {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error(`Bad secret name: ${name}`);
    return join(this.dir, name);
  }

  read(name: string): string | null {
    const p = this.path(name);
    if (!existsSync(p)) return null;
    const v = readFileSync(p, "utf8").trim();
    if (v) this.known.add(v);
    return v || null;
  }

  readJson<T>(name: string): T | null {
    const v = this.read(name);
    return v ? (JSON.parse(v) as T) : null;
  }

  write(name: string, value: string): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const p = this.path(name);
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, value, { mode: 0o600 });
    // Windows ignores POSIX modes; the secrets folder lives under the user's profile there.
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // best effort on platforms without chmod
    }
    renameSync(tmp, p);
    this.known.add(value);
  }

  writeJson(name: string, value: unknown): void {
    this.write(name, JSON.stringify(value, null, 2));
    // Token records hold several secrets; remember each string field for redaction.
    if (value && typeof value === "object") {
      for (const v of Object.values(value)) if (typeof v === "string" && v.length >= 16) this.known.add(v);
    }
  }

  delete(name: string): void {
    rmSync(this.path(name), { force: true });
  }

  /** Replaces any secret this store has seen with [REDACTED]. */
  redact(text: string): string {
    let out = text;
    for (const s of this.known) if (s.length >= 8) out = out.split(s).join("[REDACTED]");
    return out;
  }
}

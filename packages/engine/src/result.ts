/** A rule violation the player or caller can act on. `code` is stable and tested; `message` is for people. */
export type RuleError = { code: string; message: string; path?: string };

export type Result<T> = { ok: true; value: T } | { ok: false; errors: RuleError[] };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(code: string, message: string, path?: string): Result<T> => ({
  ok: false,
  errors: [{ code, message, ...(path ? { path } : {}) }],
});

/** Unwraps a result, throwing on failure. For tests, CLIs and code paths that already validated. */
export function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.value;
  throw new Error(r.errors.map((e) => `${e.code}: ${e.message}`).join("; "));
}

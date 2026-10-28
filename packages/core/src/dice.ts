import { z } from "zod";
import type { Rng } from "./rng.ts";

/** A parsed dice expression such as "2d6+1": count dice of `sides` faces, plus a flat `bonus`. */
export type DiceSpec = { count: number; sides: number; bonus: number };

const DICE_PATTERN = /^(\d+)d(\d+)([+-]\d+)?$/;

/** Parses "1d8", "2d6+1" or "1d4-3"; null for anything malformed or with zero dice or zero-sided dice. */
export function parseDice(expr: string): DiceSpec | null {
  const m = DICE_PATTERN.exec(expr);
  if (!m) return null;
  const count = Number(m[1]);
  const sides = Number(m[2]);
  if (count < 1 || sides < 1) return null;
  return { count, sides, bonus: Number(m[3] ?? 0) };
}

export const DiceExpr = z
  .string()
  .regex(/^\d+d\d+([+-]\d+)?$/, "expected dice like 1d8, 2d6+1")
  .refine((s) => parseDice(s) !== null, "expected at least one die with at least one side");

/**
 * Rolls a dice expression with the seeded rng. `maximise` takes every die at its top face and
 * leaves the rng untouched. The total is floored at 0.
 */
export function rollDice(
  expr: string,
  rng: Rng,
  opts: { maximise?: boolean } = {},
): { rolls: number[]; total: number } {
  const spec = parseDice(expr);
  if (!spec) throw new Error(`invalid dice expression: ${expr}`);
  const rolls = Array.from({ length: spec.count }, () => (opts.maximise ? spec.sides : rng.die(spec.sides)));
  const sum = rolls.reduce((s, r) => s + r, 0);
  return { rolls, total: Math.max(0, sum + spec.bonus) };
}

/** Expected value of a dice expression, or 0 when it doesn't parse. */
export function averageDice(expr: string): number {
  const spec = parseDice(expr);
  if (!spec) return 0;
  return (spec.count * (spec.sides + 1)) / 2 + spec.bonus;
}

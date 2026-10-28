import type { UsageRecord } from "@wyrd/core";
import type { Usage } from "./types.ts";

/** Prices per million tokens, keyed by `provider/model` or `provider/*`. "plan" = included in a subscription. */
export type Price = { inputPerM: number; cachedInputPerM?: number; outputPerM: number } | "plan";
export type PriceTable = Record<string, Price>;

export function priceFor(table: PriceTable, provider: string, model: string): Price | undefined {
  return table[`${provider}/${model}`] ?? table[`${provider}/*`];
}

/** Estimated cost in USD; unknown prices count as 0 so the meter under-reports rather than lies. */
export function estimateCost(price: Price | undefined, usage: Usage): number | "plan" {
  if (price === "plan") return "plan";
  if (!price) return 0;
  const fresh = Math.max(0, usage.input - usage.cachedInput);
  const cached = usage.cachedInput * (price.cachedInputPerM ?? price.inputPerM);
  return (fresh * price.inputPerM + cached + usage.output * price.outputPerM) / 1_000_000;
}

/** Where usage records go: app.db in the server, memory in tests. */
export interface UsageSink {
  record(r: UsageRecord): void;
}

export class MemoryUsageSink implements UsageSink {
  readonly records: UsageRecord[] = [];
  record(r: UsageRecord): void {
    this.records.push(r);
  }
}

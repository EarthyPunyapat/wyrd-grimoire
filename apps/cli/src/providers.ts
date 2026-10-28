import type { FallbackNotice, RoleRouter } from "@wyrd/llm";
import { CliError } from "./errors.ts";

/** Builds the role router from WYRD_HOME/config.json and WYRD_HOME/secrets. Filled in with the real adapters. */
export function loadRouterFromConfig(_opts: {
  path?: string;
  onFallback?: (n: FallbackNotice) => void;
}): RoleRouter {
  throw new CliError("Real providers aren't wired up yet; use --offline for now.");
}

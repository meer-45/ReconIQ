// getMatchRateByMethod.ts — delegates entirely to computeMetrics().
// DOES NOT reimplement any logic — single source of truth.

import { computeMetrics } from "../../metrics/computeMetrics";
import type { MethodMetrics } from "../../metrics/metricsSchema";

export type MatchMethod = "EXACT" | "SUBSET_SUM" | "FEE_INFERENCE" | "AI_FUZZY" | "AI_CLASSIFIED";

// Module-level cache — computeMetrics() reads ~170MB of JSON; only run once.
let _cache: MethodMetrics[] | null = null;

function getMethodRows(): MethodMetrics[] {
  if (!_cache) _cache = computeMetrics().methods;
  return _cache;
}

export function getMatchRateByMethod(method: MatchMethod): MethodMetrics | null {
  return getMethodRows().find(m => m.method === method) ?? null;
}

/** Returns all method rows — useful for the agent to compare across methods. */
export function getAllMethodMetrics(): MethodMetrics[] {
  return getMethodRows();
}

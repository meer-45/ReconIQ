// responseCache.ts — disk-backed LLM response cache
// Key = sha256(promptText + modelId + temperature) so model/temp changes invalidate cleanly.
// Storage: logs/llm-cache/<sha256>.json
// Cache write failures are non-fatal (logged, not thrown).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { GeminiCallResult } from "./geminiClient";
import type { FuzzyTracer } from "../matching/fuzzyTracer";

const CACHE_DIR = join(process.cwd(), "logs", "llm-cache");

function ensureCacheDir(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
}

export function buildCacheKey(promptText: string, modelId: string, temperature: number): string {
  return createHash("sha256")
    .update(`${promptText}::${modelId}::${temperature}`, "utf8")
    .digest("hex");
}

export function getCached(cacheKey: string): GeminiCallResult | null {
  const filePath = join(CACHE_DIR, `${cacheKey}.json`);
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8")) as GeminiCallResult;
    }
  } catch { /* corrupt file — treat as miss */ }
  return null;
}

export function putCached(cacheKey: string, result: GeminiCallResult): void {
  try {
    ensureCacheDir();
    writeFileSync(join(CACHE_DIR, `${cacheKey}.json`), JSON.stringify(result, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[responseCache] Cache write failed (non-fatal): ${String((err as any)?.message ?? err)}`);
  }
}

/**
 * Cache-through helper.
 * - Hit  → returns instantly, no rate-limiter acquisition, no API call.
 * - Miss → calls fn (which calls rate-limited Gemini), stores result on success.
 */
export async function withCache(
  promptText:  string,
  modelId:     string,
  temperature: number,
  fn:          () => Promise<GeminiCallResult>,
  tracer?:     FuzzyTracer
): Promise<{ result: GeminiCallResult; cacheHit: boolean }> {
  const cacheKey = buildCacheKey(promptText, modelId, temperature);
  const cached   = getCached(cacheKey);

  if (cached !== null) {
    if (tracer) {
      try {
        tracer.logLlm({
          batchLabel:        "cache-hit",
          wallClockMs:       0,
          modelId,
          promptTokens:      cached.promptTokens,
          completionTokens:  cached.completionTokens,
          costRupees:        0,
          cacheHit:          true,
        });
      } catch { /* non-fatal */ }
    }
    return { result: cached, cacheHit: true };
  }

  // Cache miss — call Gemini (rate-limited inside fn)
  const result = await fn();
  putCached(cacheKey, result);
  return { result, cacheHit: false };
}

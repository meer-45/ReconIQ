// geminiClient.ts — thin fetch wrapper for Gemini 2.5 Flash REST API
// No @google/genai or @google/generative-ai SDK — direct fetch only.
// GEMINI_API_KEY is read from process.env at call time (never cached in module scope).

import { acquire } from "./rateLimiter";
import type { FuzzyTracer } from "../matching/fuzzyTracer";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GeminiCallResult {
  text:             string;
  promptTokens:     number;
  completionTokens: number;
  latencyMs:        number;
  modelId:          string;
  costRupees:       0; // always 0 — free tier
}

export interface GeminiCallOpts {
  temperature?:     number;
  maxOutputTokens?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const MODEL_ID        = "gemini-3.5-flash-lite";
const BASE_URL        = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`;
const DEFAULT_TEMP    = 0.0;
const DEFAULT_MAX_OUT = 2048;
const RETRY_WAIT_MS   = 60_000; // 60s on 429

// ── Key redaction helper ──────────────────────────────────────────────────────
function redactKey(s: string): string {
  return s.replace(/[?&]key=[^&\s"']*/g, "?key=REDACTED")
          .replace(/"x-goog-api-key"\s*:\s*"[^"]*"/g, '"x-goog-api-key":"REDACTED"');
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function callGemini(
  promptText:   string,
  opts:         GeminiCallOpts = {},
  tracer?:      FuzzyTracer
): Promise<GeminiCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in environment");

  const temperature     = opts.temperature     ?? DEFAULT_TEMP;
  const maxOutputTokens = opts.maxOutputTokens ?? DEFAULT_MAX_OUT;

  // Acquire rate-limiter slot (blocks if needed)
  await acquire();

  const url  = `${BASE_URL}?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: { temperature, maxOutputTokens },
  };

  const t0 = Date.now();
  let response: Response;

  try {
    response = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
  } catch (err: any) {
    throw new Error(`Gemini network error: ${redactKey(String(err.message ?? err))}`);
  }

  const latencyMs = Date.now() - t0;

  if (response.status === 429) {
    // Rate-limited despite our limiter — wait 60s and retry once
    console.warn(`[geminiClient] 429 received despite rate limiter. Waiting ${RETRY_WAIT_MS / 1000}s…`);
    await new Promise(res => setTimeout(res, RETRY_WAIT_MS));

    await acquire();
    const t1 = Date.now();
    response  = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    if (!response.ok) {
      const errText = redactKey(await response.text().catch(() => ""));
      throw new Error(`Gemini API error after 429 retry: HTTP ${response.status} — ${errText}`);
    }
    // Fall through to parse
  } else if (!response.ok) {
    const errText = redactKey(await response.text().catch(() => ""));
    throw new Error(`Gemini API error: HTTP ${response.status} — ${errText}`);
  }

  let json: any;
  try {
    json = await response.json();
  } catch (err: any) {
    throw new Error(`Gemini response JSON parse error: ${String(err.message ?? err)}`);
  }

  const text             = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const usage            = json?.usageMetadata ?? {};
  const promptTokens     = usage.promptTokenCount      ?? 0;
  const completionTokens = usage.candidatesTokenCount  ?? 0;

  const result: GeminiCallResult = {
    text,
    promptTokens,
    completionTokens,
    latencyMs,
    modelId: MODEL_ID,
    costRupees: 0,
  };

  // Log to tracer if provided (best-effort)
  if (tracer) {
    try {
      tracer.logLlm({
        batchLabel:        "gemini-call",
        wallClockMs:       latencyMs,
        modelId:           MODEL_ID,
        promptTokens,
        completionTokens,
        costRupees:        0,
        cacheHit:          false,
      });
    } catch { /* non-fatal */ }
  }

  return result;
}

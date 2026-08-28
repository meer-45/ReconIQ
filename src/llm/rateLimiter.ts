// rateLimiter.ts — token-bucket rate limiter for Gemini free-tier compliance
// Free tier: 15 req/min, 1500 req/day. We leave margin for retries.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";

// ── Named constants (no magic numbers below) ──────────────────────────────────
const REQUESTS_PER_MINUTE = 12;  // ceiling 15, leave 3 margin
const REQUESTS_PER_DAY    = 1400; // ceiling 1500, leave 100 margin
const WINDOW_MS           = 60_000; // 1 minute in ms

const STATE_PATH = resolve(__dirname, "../../logs/rate-limiter-state.json");

interface RateLimiterState {
  dayCount:      number;
  minuteWindow:  Array<number>; // timestamps (ms) of requests in the sliding window
  dayResetIso:   string;        // ISO date string for the day boundary (IST midnight)
}

function todayIstDateStr(): string {
  // Use IST (Asia/Kolkata, UTC+5:30) — conservative reset point
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function loadState(): RateLimiterState {
  try {
    if (existsSync(STATE_PATH)) {
      const raw  = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
      const today = todayIstDateStr();
      if (raw.dayResetIso !== today) {
        // New IST day — reset day counter
        return { dayCount: 0, minuteWindow: [], dayResetIso: today };
      }
      return { dayCount: raw.dayCount ?? 0, minuteWindow: raw.minuteWindow ?? [], dayResetIso: today };
    }
  } catch { /* corrupt state — start fresh */ }
  return { dayCount: 0, minuteWindow: [], dayResetIso: todayIstDateStr() };
}

function saveState(state: RateLimiterState): void {
  try {
    mkdirSync(resolve(__dirname, "../../logs"), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch { /* non-fatal — state persistence is best-effort */ }
}

// Module-level state (loaded once, mutated in-process)
let _state: RateLimiterState = loadState();

// ── Exports ───────────────────────────────────────────────────────────────────

export interface RateLimiterStateSnapshot {
  minuteCount:      number;
  dayCount:         number;
  msUntilNextSlot:  number;
}

export function getState(): RateLimiterStateSnapshot {
  const now  = Date.now();
  const active = _state.minuteWindow.filter(t => now - t < WINDOW_MS);
  const msUntil = active.length >= REQUESTS_PER_MINUTE
    ? WINDOW_MS - (now - active[0])
    : 0;
  return { minuteCount: active.length, dayCount: _state.dayCount, msUntilNextSlot: Math.max(0, msUntil) };
}

export async function acquire(): Promise<void> {
  // Check day quota first (no sleep — throw immediately)
  if (_state.dayCount >= REQUESTS_PER_DAY) {
    throw new Error(
      `Rate limit: day quota exhausted (${_state.dayCount}/${REQUESTS_PER_DAY}). ` +
      `Quota resets at IST midnight. Next reset date: ${_state.dayResetIso} → tomorrow.`
    );
  }

  // Slide the minute window and wait if full
  while (true) {
    const now    = Date.now();
    _state.minuteWindow = _state.minuteWindow.filter(t => now - t < WINDOW_MS);

    if (_state.minuteWindow.length < REQUESTS_PER_MINUTE) {
      // Slot available — claim it
      _state.minuteWindow.push(now);
      _state.dayCount++;
      saveState(_state);
      return;
    }

    // Window full — wait until the oldest request expires
    const oldestTs  = _state.minuteWindow[0];
    const waitMs    = WINDOW_MS - (now - oldestTs) + 50; // +50ms buffer
    await new Promise(res => setTimeout(res, waitMs));
  }
}
